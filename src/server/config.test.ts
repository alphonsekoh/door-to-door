import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigInvalidError,
  ConfigNotFoundError,
  ConfigSourceError,
  ConfigUnreadableError,
} from "@/lib/config";
import {
  getConfig,
  loadAppConfig,
  loadConfig,
  loadDatabaseUrl,
  resetConfig,
  resolveConfigPath,
  verifyConfigOrExit,
  warnIfDotEnv,
} from "@/server/config";

const FILE =
  "database:\n  url: postgresql://db:5432/door_to_door\nrateLimit:\n  signInAttempts: 4\n";
const SECRET = "k3Jx9Qw2LmZp0Rt7Vb5Nc8Hd1Fg4Ys6A";
const env = {
  DATABASE_USER: "app",
  DATABASE_PASSWORD: "pw",
  AUTH_SECRET: SECRET,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2d-config-"));
  resetConfig();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const write = (text: string, name = "config.yaml"): string => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe("resolveConfigPath", () => {
  it("defaults to config.yaml in the working directory", () => {
    expect(resolveConfigPath({}, "/srv/app")).toBe("/srv/app/config.yaml");
  });

  it("uses CONFIG_PATH, resolved against the working directory", () => {
    expect(resolveConfigPath({ CONFIG_PATH: "/etc/d2d.yaml" }, "/srv/app")).toBe("/etc/d2d.yaml");
    expect(resolveConfigPath({ CONFIG_PATH: "conf/x.yaml" }, "/srv/app")).toBe(
      "/srv/app/conf/x.yaml",
    );
  });

  it("treats an empty CONFIG_PATH as unset", () => {
    expect(resolveConfigPath({ CONFIG_PATH: "" }, "/srv/app")).toBe("/srv/app/config.yaml");
  });
});

describe("loadAppConfig", () => {
  it("reads and parses the file from disk", () => {
    const path = write(FILE);
    expect(loadAppConfig({ env: { CONFIG_PATH: path } }).rateLimit.signInAttempts).toBe(4);
  });

  it("finds config.yaml in cwd by default", () => {
    write(FILE);
    expect(loadAppConfig({ env: {}, cwd: dir }).database.url).toBe(
      "postgresql://db:5432/door_to_door",
    );
  });

  it("reads process.env and process.cwd() when given nothing", () => {
    vi.stubEnv("CONFIG_PATH", write(FILE));
    expect(loadAppConfig().database.url).toContain("door_to_door");
  });

  it("throws ConfigNotFoundError naming the path and the fix", () => {
    const path = join(dir, "absent.yaml");
    const attempt = () => loadAppConfig({ env: { CONFIG_PATH: path } });
    expect(attempt).toThrow(ConfigNotFoundError);
    expect(attempt).toThrow(path);
    expect(attempt).toThrow(/config\.example\.yaml/);
  });

  it("distinguishes a file that exists but cannot be read", () => {
    const path = write(FILE);
    const readFile = () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    expect(() => loadAppConfig({ env: { CONFIG_PATH: path }, readFile })).toThrow(
      ConfigUnreadableError,
    );
    expect(() => loadAppConfig({ env: { CONFIG_PATH: path }, readFile })).toThrow(/EACCES/);
  });

  it("reports an unreadable file even when the error carries no code", () => {
    const readFile = () => {
      throw new Error("boom");
    };
    expect(() => loadAppConfig({ env: {}, cwd: dir, readFile })).toThrow(/unknown error/);
  });

  it("reads the settings from CONFIG_YAML, with no file anywhere", () => {
    const readFile = () => {
      throw new Error("no file may be read");
    };
    const config = loadAppConfig({ env: { CONFIG_YAML: FILE }, cwd: dir, readFile });
    expect(config.database.url).toBe("postgresql://db:5432/door_to_door");
    expect(config.rateLimit.signInAttempts).toBe(4);
  });

  it("treats an empty CONFIG_YAML as unset", () => {
    write(FILE);
    expect(loadAppConfig({ env: { CONFIG_YAML: "" }, cwd: dir }).rateLimit.signInAttempts).toBe(4);
  });

  it("refuses CONFIG_YAML together with CONFIG_PATH, and says to set one", () => {
    const both = { CONFIG_YAML: FILE, CONFIG_PATH: write(FILE) };
    expect(() => loadAppConfig({ env: both })).toThrow(ConfigSourceError);
    expect(() => loadAppConfig({ env: both })).toThrow(/either CONFIG_YAML or CONFIG_PATH/);
  });

  it("lets an empty CONFIG_PATH sit beside CONFIG_YAML", () => {
    expect(loadAppConfig({ env: { CONFIG_YAML: FILE, CONFIG_PATH: "" } }).database.url).toContain(
      "door_to_door",
    );
  });

  it("holds CONFIG_YAML to the same schema, naming it, and still refuses credentials", () => {
    const attempt = () => loadAppConfig({ env: { CONFIG_YAML: "database: {}\n" } });
    expect(attempt).toThrow(ConfigInvalidError);
    expect(attempt).toThrow(/CONFIG_YAML/);
    const withCredentials = "database:\n  url: postgresql://user:secret@db:5432/door_to_door\n";
    const refused = () => loadAppConfig({ env: { CONFIG_YAML: withCredentials } });
    expect(refused).toThrow(ConfigInvalidError);
    expect(refused).not.toThrow(/secret/);
  });

  it("lets a parse error through, naming the file", () => {
    const path = write("database: {}\n");
    expect(() => loadAppConfig({ env: { CONFIG_PATH: path } })).toThrow(ConfigInvalidError);
    expect(() => loadAppConfig({ env: { CONFIG_PATH: path } })).toThrow(path);
  });
});

describe("loadDatabaseUrl", () => {
  it("composes the URL from the file and the credential variables", () => {
    const url = loadDatabaseUrl({ env: { ...env, CONFIG_PATH: write(FILE) } });
    expect(url).toBe("postgresql://app:pw@db:5432/door_to_door");
  });

  it("composes the URL from CONFIG_YAML too, so migrate needs no file", () => {
    const url = loadDatabaseUrl({ env: { ...env, CONFIG_YAML: FILE } });
    expect(url).toBe("postgresql://app:pw@db:5432/door_to_door");
  });

  it("does not need the auth secret, so migrate runs without it", () => {
    const url = loadDatabaseUrl({
      env: { DATABASE_USER: "a", DATABASE_PASSWORD: "b", CONFIG_PATH: write(FILE) },
    });
    expect(url).toContain("a:b@");
  });

  it("reads credentials from files", () => {
    const readFile = (path: string) =>
      path === "/run/u" ? "fileuser\n" : path === "/run/p" ? "filepw\n" : FILE;
    const url = loadDatabaseUrl({
      env: { DATABASE_USER_FILE: "/run/u", DATABASE_PASSWORD_FILE: "/run/p" },
      cwd: "/x",
      readFile,
    });
    expect(url).toBe("postgresql://fileuser:filepw@db:5432/door_to_door");
  });

  it("falls back to process.env and the real filesystem", () => {
    vi.stubEnv("CONFIG_PATH", write(FILE));
    vi.stubEnv("DATABASE_USER", "envuser");
    vi.stubEnv("DATABASE_PASSWORD", "envpw");
    expect(loadDatabaseUrl()).toBe("postgresql://envuser:envpw@db:5432/door_to_door");
  });

  it("refuses a file that carries credentials", () => {
    const path = write("database:\n  url: postgresql://u:p@db/x\n");
    expect(() => loadDatabaseUrl({ env: { ...env, CONFIG_PATH: path } })).toThrow(/database\.url/);
  });
});

describe("loadConfig", () => {
  it("merges the file, the secrets and the composed URL", () => {
    const config = loadConfig({ env: { ...env, CONFIG_PATH: write(FILE) } });
    expect(config).toMatchObject({
      databaseUrl: "postgresql://app:pw@db:5432/door_to_door",
      authSecret: SECRET,
      rateLimit: { signInAttempts: 4, signInWindowSeconds: 300 },
      auth: { trustHost: true, secureCookies: true },
    });
  });

  it("refuses a missing AUTH_SECRET", () => {
    const { AUTH_SECRET: _omitted, ...rest } = env;
    expect(() => loadConfig({ env: { ...rest, CONFIG_PATH: write(FILE) } })).toThrow(/AUTH_SECRET/);
  });

  it("uses process.env and the real filesystem by default", () => {
    vi.stubEnv("CONFIG_PATH", write(FILE));
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    expect(loadConfig().authSecret).toBe(SECRET);
  });
});

describe("getConfig", () => {
  const stubAll = (path: string) => {
    vi.stubEnv("CONFIG_PATH", path);
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
  };

  it("loads once and returns the same object, so an edit needs a restart", () => {
    const path = write(FILE);
    stubAll(path);
    const first = getConfig();
    writeFileSync(path, FILE.replace("signInAttempts: 4", "signInAttempts: 9"));
    expect(getConfig()).toBe(first);
    expect(getConfig().rateLimit.signInAttempts).toBe(4);
  });

  it("picks up a changed file after the cache is reset", () => {
    const path = write(FILE);
    stubAll(path);
    getConfig();
    writeFileSync(path, FILE.replace("signInAttempts: 4", "signInAttempts: 9"));
    resetConfig();
    expect(getConfig().rateLimit.signInAttempts).toBe(9);
  });

  it("does not cache a failure", () => {
    const path = join(dir, "config.yaml");
    stubAll(path);
    expect(() => getConfig()).toThrow(ConfigNotFoundError);
    write(FILE);
    expect(getConfig().rateLimit.signInAttempts).toBe(4);
  });

  it("warns once about a .env file on first load", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubAll(write(FILE));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    write("DATABASE_URL=x\n", ".env");
    getConfig();
    getConfig();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once per process even when another module copy loads the config", async () => {
    // Next gives instrumentation, the proxy and handlers a copy each.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubAll(write(FILE));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    write("X=1\n", ".env");
    getConfig();
    vi.resetModules();
    const other = await import("@/server/config");
    other.getConfig();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("warnIfDotEnv", () => {
  it("warns and says where settings live when .env exists", () => {
    const warn = vi.fn();
    expect(warnIfDotEnv({ cwd: "/srv/app", exists: (p) => p === "/srv/app/.env", warn })).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("/srv/app"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("config.yaml"));
  });

  it("is silent when there is none", () => {
    const warn = vi.fn();
    expect(warnIfDotEnv({ cwd: "/srv/app", exists: () => false, warn })).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("checks the real filesystem and console by default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnIfDotEnv({ cwd: dir })).toBe(false);
    write("X=1\n", ".env");
    expect(warnIfDotEnv({ cwd: dir })).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("verifyConfigOrExit", () => {
  const stubAll = (path: string) => {
    vi.stubEnv("CONFIG_PATH", path);
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
  };

  it("does nothing when the config is good", () => {
    stubAll(write(FILE));
    const exit = vi.fn() as unknown as (code: number) => never;
    const report = vi.fn();
    verifyConfigOrExit(exit, report);
    expect(exit).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports the problem and exits non-zero when it is not", () => {
    stubAll(join(dir, "absent.yaml"));
    const exit = vi.fn() as unknown as (code: number) => never;
    const report = vi.fn();
    verifyConfigOrExit(exit, report);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("absent.yaml"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits on a secret problem too, without echoing the secret", () => {
    stubAll(write(FILE));
    vi.stubEnv("AUTH_SECRET", "short-secret-value");
    const exit = vi.fn() as unknown as (code: number) => never;
    const report = vi.fn();
    verifyConfigOrExit(exit, report);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("AUTH_SECRET"));
    expect(report).not.toHaveBeenCalledWith(expect.stringContaining("short-secret-value"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports whatever was thrown, even when it is not an Error", () => {
    const exit = vi.fn() as unknown as (code: number) => never;
    const report = vi.fn();
    verifyConfigOrExit(exit, report, () => {
      // JSON.parse returns any, which the lint rule permits throwing.
      throw JSON.parse('"plain string"');
    });
    expect(report).toHaveBeenCalledWith("Cannot start: plain string");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("uses process.exit and console.error by default", () => {
    stubAll(join(dir, "absent.yaml"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    verifyConfigOrExit();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Cannot start"));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
