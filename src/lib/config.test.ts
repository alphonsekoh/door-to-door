import { describe, expect, it } from "vitest";
import {
  ConfigInvalidError,
  ConfigNotFoundError,
  ConfigUnreadableError,
  SecretError,
  composeDatabaseUrl,
  parseConfig,
  readSecret,
  resolveAuthSecrets,
  resolveDatabaseCredentials,
  type AppConfig,
} from "@/lib/config";

const SOURCE = "/srv/app/config.yaml";
const MINIMAL = "database:\n  url: postgresql://localhost:5432/door_to_door\n";

const problemsOf = (text: string): string[] => {
  try {
    parseConfig(text, SOURCE);
  } catch (error) {
    if (error instanceof ConfigInvalidError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error("expected the config to be rejected");
};

describe("parseConfig defaults", () => {
  it("accepts a file with only the database and fills in the rest", () => {
    expect(parseConfig(MINIMAL, SOURCE)).toEqual({
      database: { url: "postgresql://localhost:5432/door_to_door" },
      auth: { trustHost: true, secureCookies: true },
      rateLimit: {
        signInAttempts: 10,
        signInAttemptsPerClient: 30,
        signInWindowSeconds: 300,
        trustedProxyHops: 0,
      },
      sync: { clockSkewToleranceSeconds: 300 },
    });
  });

  it("leaves the app-wide sign-in budget unset unless it is given", () => {
    // An incident switch: set, anyone can spend it and lock every sign-in out.
    expect(parseConfig(MINIMAL, SOURCE).rateLimit).not.toHaveProperty("signInAttemptsGlobal");
  });

  it("reads every key it is given", () => {
    const config = parseConfig(
      `${MINIMAL}auth:
  trustHost: false
  secureCookies: false
  google:
    clientId: abc.apps.googleusercontent.com
rateLimit:
  signInAttempts: 3
  signInAttemptsPerClient: 20
  signInAttemptsGlobal: 100
  signInWindowSeconds: 60
  trustedProxyHops: 2
sync:
  clockSkewToleranceSeconds: 120
`,
      SOURCE,
    );
    expect(config.auth).toEqual({
      trustHost: false,
      secureCookies: false,
      google: { clientId: "abc.apps.googleusercontent.com" },
    });
    expect(config.rateLimit).toEqual({
      signInAttempts: 3,
      signInAttemptsPerClient: 20,
      signInAttemptsGlobal: 100,
      signInWindowSeconds: 60,
      trustedProxyHops: 2,
    });
    expect(config.sync.clockSkewToleranceSeconds).toBe(120);
  });

  it("accepts the postgres:// scheme as well", () => {
    expect(parseConfig("database:\n  url: postgres://db/x\n", SOURCE).database.url).toBe(
      "postgres://db/x",
    );
  });
});

describe("strictness", () => {
  it("names an unknown key at the top level", () => {
    expect(problemsOf(`${MINIMAL}rateLimt:\n  signInAttempts: 3\n`)).toEqual([
      "rateLimt: unknown key",
    ]);
  });

  it("names a typo'd key with its parent path", () => {
    expect(problemsOf(`${MINIMAL}rateLimit:\n  signInAttemps: 3\n`)).toEqual([
      "rateLimit.signInAttemps: unknown key",
    ]);
  });

  it("rejects a password key under database, naming the key not the value", () => {
    expect(problemsOf("database:\n  url: postgresql://db/x\n  password: hunter2\n")).toEqual([
      "database.password: unknown key",
    ]);
  });

  it("rejects a missing database section", () => {
    expect(problemsOf("auth:\n  trustHost: true\n")).toEqual([
      expect.stringMatching(/^database: /),
    ]);
  });

  it("rejects an empty file", () => {
    expect(problemsOf("")).toEqual([expect.stringMatching(/^\(top level\): /)]);
  });

  it("reports every problem at once", () => {
    expect(problemsOf("rateLimit:\n  signInAttempts: 0\nbogus: 1\n")).toHaveLength(3);
  });
});

describe.each([
  ["rateLimit.signInAttempts", "rateLimit:\n  signInAttempts: %\n"],
  ["rateLimit.signInAttemptsPerClient", "rateLimit:\n  signInAttemptsPerClient: %\n"],
  ["rateLimit.signInAttemptsGlobal", "rateLimit:\n  signInAttemptsGlobal: %\n"],
  ["rateLimit.signInWindowSeconds", "rateLimit:\n  signInWindowSeconds: %\n"],
  ["sync.clockSkewToleranceSeconds", "sync:\n  clockSkewToleranceSeconds: %\n"],
])("%s", (key, template) => {
  it.each(["0", "-1", "1.5", '"300"', "true", "null"])("rejects %s", (value) => {
    expect(problemsOf(MINIMAL + template.replace("%", value))).toEqual([
      expect.stringMatching(new RegExp(`^${key.replace(".", "\\.")}: `)),
    ]);
  });
});

describe("rateLimit.trustedProxyHops", () => {
  it("accepts 0, which leaves the per-client budget off", () => {
    expect(
      parseConfig(`${MINIMAL}rateLimit:\n  trustedProxyHops: 0\n`, SOURCE).rateLimit
        .trustedProxyHops,
    ).toBe(0);
  });

  it.each(["-1", "1.5", '"1"', "true", "null"])("rejects %s", (value) => {
    expect(problemsOf(`${MINIMAL}rateLimit:\n  trustedProxyHops: ${value}\n`)).toEqual([
      expect.stringMatching(/^rateLimit\.trustedProxyHops: /),
    ]);
  });
});

describe("auth.secureCookies", () => {
  it("defaults to true, so a deployment's cookies are Secure without saying so", () => {
    // The scheme Auth.js sees behind a TLS proxy may be http.
    expect(parseConfig(MINIMAL, SOURCE).auth.secureCookies).toBe(true);
  });

  it("can be turned off for a plain-http run", () => {
    expect(
      parseConfig(`${MINIMAL}auth:\n  secureCookies: false\n`, SOURCE).auth.secureCookies,
    ).toBe(false);
  });

  it.each(['"false"', "0", "no-thanks", "null"])("refuses %s, naming the key", (value) => {
    expect(problemsOf(`${MINIMAL}auth:\n  secureCookies: ${value}\n`)).toEqual([
      expect.stringMatching(/^auth\.secureCookies: /),
    ]);
  });
});

describe("database.url", () => {
  it("refuses credentials in the file and names the key, not the value", () => {
    const problems = problemsOf("database:\n  url: postgresql://admin:hunter2@db:5432/x\n");
    expect(problems).toEqual([expect.stringMatching(/^database\.url: .*DATABASE_USER/)]);
    expect(problems.join()).not.toMatch(/hunter2|admin/);
  });

  it("refuses a username on its own", () => {
    expect(problemsOf("database:\n  url: postgresql://admin@db/x\n")).toEqual([
      expect.stringMatching(/^database\.url: must not contain a username or password/),
    ]);
  });

  it("refuses a password on its own", () => {
    expect(problemsOf("database:\n  url: postgresql://:hunter2@db/x\n")).toEqual([
      expect.stringMatching(/^database\.url: must not contain/),
    ]);
  });

  it.each(["user", "password", "sslpassword", "sslkey", "sslcert", "options"])(
    "refuses the query parameter %s without echoing its value",
    (key) => {
      const sentinel = "SENTINEL-query-value";
      const problems = problemsOf(`database:\n  url: "postgresql://db/x?${key}=${sentinel}"\n`);
      expect(problems).toEqual([
        expect.stringContaining(`query parameter "${key}" is not allowed`),
      ]);
      expect(problems.join()).not.toContain(sentinel);
    },
  );

  it("names each offending parameter once, even when repeated", () => {
    expect(problemsOf("database:\n  url: postgresql://db/x?password=a&password=b\n")).toHaveLength(
      1,
    );
  });

  it("still allows sslmode and application_name", () => {
    expect(
      parseConfig(
        "database:\n  url: postgresql://db/x?sslmode=require&application_name=d2d\n",
        SOURCE,
      ).database.url,
    ).toContain("sslmode=require");
  });

  it("refuses something that is not a URL", () => {
    expect(problemsOf("database:\n  url: not a url\n")).toEqual([
      "database.url: must be a valid URL",
    ]);
  });

  it("refuses another database scheme", () => {
    expect(problemsOf("database:\n  url: mysql://db/x\n")).toEqual([
      "database.url: must start with postgresql://",
    ]);
  });
});

describe("never echoing a value", () => {
  it("keeps a sentinel out of every kind of message", () => {
    const sentinel = "SENTINEL-s3cr3t-value";
    const texts = [
      `database:\n  url: postgresql://u:${sentinel}@db/x\n`,
      `${MINIMAL}rateLimit:\n  signInAttempts: ${sentinel}\n`,
      `${MINIMAL}auth:\n  google:\n    clientId: 5\n    password: ${sentinel}\n`,
      `${MINIMAL}sync: ${sentinel}\n`,
      `database:\n  url: ${sentinel}\n`,
      `database: {url: ${sentinel}\n  oops: [${sentinel}\n`,
      `${MINIMAL}secret: "${sentinel}\n`,
    ];
    for (const text of texts) {
      let message = "";
      try {
        parseConfig(text, SOURCE);
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message, text).toContain(SOURCE);
      expect(message, text).not.toContain(sentinel);
    }
  });
});

describe("bad YAML", () => {
  it("reports the position and code, not the source line", () => {
    const problems = problemsOf("database:\n  url: [unclosed\n");
    expect(problems[0]).toMatch(/^invalid YAML at line \d+, column \d+ \([A-Z_]+\)$/);
  });

  it("reports a duplicate key", () => {
    expect(problemsOf(`${MINIMAL}database:\n  url: x\n`).join()).toMatch(/DUPLICATE_KEY/);
  });

  it("counts lines and columns from one", () => {
    expect(problemsOf("a: 1\na: 2\n")).toEqual([
      "invalid YAML at line 2, column 1 (DUPLICATE_KEY)",
    ]);
  });

  it("reports an error on the first line", () => {
    expect(problemsOf("\ta: 1")).toEqual(["invalid YAML at line 1, column 1 (TAB_AS_INDENT)"]);
  });

  it("names the file in the message", () => {
    expect(() => parseConfig("a: [", SOURCE)).toThrow(`Invalid configuration in ${SOURCE}`);
  });
});

describe("errors", () => {
  it("tells the reader how to create the missing file", () => {
    const error = new ConfigNotFoundError("/x/config.yaml");
    expect(error.message).toContain("/x/config.yaml");
    expect(error.message).toContain("Copy config.example.yaml to config.yaml");
  });

  it("names the path and code for an unreadable file", () => {
    expect(new ConfigUnreadableError("/x/config.yaml", "EACCES").message).toMatch(
      /\/x\/config\.yaml.*EACCES/,
    );
  });
});

describe("readSecret", () => {
  const never = () => {
    throw new Error("should not read a file");
  };

  it("returns the variable when set", () => {
    expect(readSecret("X", { X: "value" }, never)).toBe("value");
  });

  it("returns undefined when neither is set, or both are empty", () => {
    expect(readSecret("X", {}, never)).toBeUndefined();
    expect(readSecret("X", { X: "", X_FILE: "" }, never)).toBeUndefined();
  });

  it("reads the file named by NAME_FILE and drops the trailing newline", () => {
    const read = (path: string) => (path === "/run/secrets/x" ? "from-file\n" : never());
    expect(readSecret("X", { X_FILE: "/run/secrets/x" }, read)).toBe("from-file");
  });

  it("drops a Windows line ending and repeated newlines, but not inner whitespace", () => {
    expect(readSecret("X", { X_FILE: "f" }, () => " a b \r\n\n")).toBe(" a b ");
  });

  it("treats an empty file as unset", () => {
    expect(readSecret("X", { X_FILE: "f" }, () => "\n")).toBeUndefined();
  });

  it("refuses both being set rather than picking a winner", () => {
    const attempt = () => readSecret("X", { X: "a", X_FILE: "/f" }, never);
    expect(attempt).toThrow(SecretError);
    expect(attempt).toThrow("Set either X or X_FILE, not both.");
  });

  it("names the variable and path, not the content, when the file is unreadable", () => {
    const read = () => {
      throw new Error("ENOENT contents-leak");
    };
    expect(() => readSecret("X", { X_FILE: "/run/secrets/x" }, read)).toThrow(
      "X_FILE points at /run/secrets/x, which could not be read.",
    );
  });
});

describe("resolveDatabaseCredentials", () => {
  it("returns both, from either source", () => {
    const read = () => "pw-from-file\n";
    expect(
      resolveDatabaseCredentials({ DATABASE_USER: "app", DATABASE_PASSWORD_FILE: "/p" }, read),
    ).toEqual({ user: "app", password: "pw-from-file" });
  });

  it.each([
    [{ DATABASE_PASSWORD: "p" }, "DATABASE_USER"],
    [{ DATABASE_USER: "u" }, "DATABASE_PASSWORD"],
  ])("names the missing variable (%#)", (env, name) => {
    expect(() => resolveDatabaseCredentials(env, () => "")).toThrow(
      new RegExp(`^${name} is not set.*${name}_FILE`),
    );
  });
});

describe("resolveAuthSecrets", () => {
  const good = "k3Jx9Qw2LmZp0Rt7Vb5Nc8Hd1Fg4Ys6A";
  const config = parseConfig(MINIMAL, SOURCE);
  const withGoogle: AppConfig = {
    ...config,
    auth: { trustHost: true, secureCookies: true, google: { clientId: "id" } },
  };
  const noFile = () => "";

  it("accepts a long random secret", () => {
    expect(resolveAuthSecrets(config, { AUTH_SECRET: good }, noFile)).toEqual({
      authSecret: good,
      googleClientSecret: undefined,
    });
  });

  it("accepts exactly 32 characters", () => {
    expect(() => resolveAuthSecrets(config, { AUTH_SECRET: "a".repeat(32) }, noFile)).not.toThrow();
  });

  it("refuses 31 characters, and says how to generate one", () => {
    expect(() => resolveAuthSecrets(config, { AUTH_SECRET: "a".repeat(31) }, noFile)).toThrow(
      /AUTH_SECRET.*32.*openssl rand -base64 32/,
    );
  });

  it.each([
    "change-me-change-me-change-me-change-me",
    "ReplaceMeReplaceMeReplaceMeReplaceMe!!",
    "your-secret-goes-here-your-secret-goes",
    "placeholder-placeholder-placeholder-xx",
    "example-secret-example-secret-example",
  ])("refuses the placeholder %s even when long enough", (value) => {
    expect(() => resolveAuthSecrets(config, { AUTH_SECRET: value }, noFile)).toThrow(
      /not a placeholder/,
    );
  });

  it("does not put the secret in the error", () => {
    expect(() => resolveAuthSecrets(config, { AUTH_SECRET: "short-but-secret" }, noFile)).toThrow(
      expect.not.objectContaining({
        message: expect.stringContaining("short-but-secret") as string,
      }),
    );
  });

  it("requires AUTH_SECRET", () => {
    expect(() => resolveAuthSecrets(config, {}, noFile)).toThrow(/^AUTH_SECRET is not set/);
  });

  it("reads AUTH_SECRET_FILE", () => {
    expect(
      resolveAuthSecrets(config, { AUTH_SECRET_FILE: "/s" }, () => `${good}\n`).authSecret,
    ).toBe(good);
  });

  it("requires AUTH_GOOGLE_SECRET once a clientId is configured", () => {
    expect(() => resolveAuthSecrets(withGoogle, { AUTH_SECRET: good }, noFile)).toThrow(
      /^AUTH_GOOGLE_SECRET is not set/,
    );
    expect(
      resolveAuthSecrets(withGoogle, { AUTH_SECRET: good, AUTH_GOOGLE_SECRET: "g" }, noFile)
        .googleClientSecret,
    ).toBe("g");
  });
});

describe("composeDatabaseUrl", () => {
  it("adds credentials to a credential-free URL", () => {
    expect(
      composeDatabaseUrl("postgresql://db:5432/door_to_door", { user: "app", password: "pw" }),
    ).toBe("postgresql://app:pw@db:5432/door_to_door");
  });

  it("round-trips awkward credentials through a URL parser", () => {
    const password = "p@ss:w/rd#?%41 &=+";
    const user = "us er@x";
    const url = new URL(composeDatabaseUrl("postgresql://db/x", { user, password }));
    expect(decodeURIComponent(url.username)).toBe(user);
    expect(decodeURIComponent(url.password)).toBe(password);
    expect(url.host).toBe("db");
    expect(url.pathname).toBe("/x");
  });
});
