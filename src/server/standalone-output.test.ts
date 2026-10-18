import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkStandaloneOutput,
  findForbiddenFiles,
  isForbiddenFile,
  pruneDotEnv,
} from "@/server/standalone-output";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2d-standalone-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const touch = (relative: string): void => {
  const path = join(dir, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "x");
};

/* What a clean `next build` leaves behind. */
const buildOutput = (): void => {
  touch("server.js");
  touch("package.json");
  touch(".next/server/instrumentation.js");
  touch(".next/server/app/api/visits/route.js");
};

describe("isForbiddenFile", () => {
  it.each([".env", ".env.local", ".env.production", "config.yaml", "config.prod.yaml"])(
    "refuses %s",
    (name) => {
      expect(isForbiddenFile(name)).toBe(true);
    },
  );

  it.each(["server.js", "package.json", "my.env", "config.yml", "app-config.yaml", "config.ts"])(
    "allows %s",
    (name) => {
      expect(isForbiddenFile(name)).toBe(false);
    },
  );
});

describe("pruneDotEnv", () => {
  it("deletes the .env files Next copies to the output root and leaves the rest", () => {
    buildOutput();
    touch(".env");
    touch(".env.production");

    expect(pruneDotEnv(dir).sort()).toEqual([".env", ".env.production"]);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(existsSync(join(dir, ".env.production"))).toBe(false);
    expect(existsSync(join(dir, "server.js"))).toBe(true);
  });

  it("leaves a directory alone even when its name matches the .env pattern", () => {
    touch(".env.d/keep.txt");

    expect(pruneDotEnv(dir)).toEqual([]);
    expect(existsSync(join(dir, ".env.d/keep.txt"))).toBe(true);
  });
});

describe("findForbiddenFiles", () => {
  it("finds nothing in a clean build", () => {
    buildOutput();

    expect(findForbiddenFiles(dir)).toEqual([]);
  });

  it("reports a traced config.yaml or .env wherever it lands", () => {
    buildOutput();
    touch("config.yaml");
    touch(".next/server/.env.local");

    expect(findForbiddenFiles(dir).sort()).toEqual([".next/server/.env.local", "config.yaml"]);
  });

  it("does not look inside node_modules", () => {
    touch("node_modules/some-package/.env.example");

    expect(findForbiddenFiles(dir)).toEqual([]);
  });
});

describe("checkStandaloneOutput", () => {
  it("prunes the copied .env and still reports a traced config.yaml", () => {
    buildOutput();
    touch(".env");
    touch("config.yaml");

    expect(checkStandaloneOutput(dir)).toEqual({ removed: [".env"], forbidden: ["config.yaml"] });
  });

  it("passes a build whose only problem was the copied .env", () => {
    buildOutput();
    touch(".env");

    expect(checkStandaloneOutput(dir)).toEqual({ removed: [".env"], forbidden: [] });
  });

  it("fails loudly when there is no standalone output to check", () => {
    expect(() => checkStandaloneOutput(join(dir, "missing"))).toThrow(/ENOENT/);
  });
});
