import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyTestConfig, createTestConfigDir, TEST_CONFIG_DIR_ENV } from "@/db/testing";

type Env = Record<string, string | undefined>;

const TEST_URL = "postgresql://tester:p%40ss@localhost:5433/door_to_door_test";

describe("integration test config", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function runDir(env: Env): string {
    cleanups.push(createTestConfigDir(env));
    const dir = env[TEST_CONFIG_DIR_ENV];
    if (!dir) throw new Error("createTestConfigDir did not set the folder");
    return dir;
  }

  // Two runs on one machine sharing a folder made one run talk to the other's database.
  it("gives each run its own folder", () => {
    const first = runDir({});
    const second = runDir({});

    expect(first).not.toBe(second);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
  });

  it("writes a credential-free config into the run's folder and moves credentials to env", () => {
    const env: Env = { TEST_DATABASE_URL: TEST_URL };
    const dir = runDir(env);

    applyTestConfig(env);

    expect(env["CONFIG_PATH"]).toBeDefined();
    expect(dirname(env["CONFIG_PATH"] ?? "")).toBe(dir);
    expect(readFileSync(env["CONFIG_PATH"] ?? "", "utf8")).toBe(
      'database:\n  url: "postgresql://localhost:5433/door_to_door_test"\n' +
        "privacy:\n  organisation: Test Operator\n  dpoEmail: dpo@example.com\n",
    );
    expect(env["DATABASE_USER"]).toBe("tester");
    expect(env["DATABASE_PASSWORD"]).toBe("p@ss");
    expect(env["AUTH_SECRET"]).toBeTruthy();
  });

  it("keeps two runs' configs apart", () => {
    const envA: Env = { TEST_DATABASE_URL: TEST_URL };
    const envB: Env = { TEST_DATABASE_URL: `${TEST_URL}_b` };
    runDir(envA);
    runDir(envB);

    applyTestConfig(envA);
    applyTestConfig(envB);

    expect(readFileSync(envA["CONFIG_PATH"] ?? "", "utf8")).toContain('door_to_door_test"');
    expect(readFileSync(envB["CONFIG_PATH"] ?? "", "utf8")).toContain('door_to_door_test_b"');
  });

  it("removes the folder and its config on cleanup", () => {
    const env: Env = { TEST_DATABASE_URL: TEST_URL };
    const cleanup = createTestConfigDir(env);
    applyTestConfig(env);
    const dir = env[TEST_CONFIG_DIR_ENV] ?? "";

    cleanup();

    expect(existsSync(dir)).toBe(false);
  });

  it("refuses to write a config outside a run rather than fall back to a shared path", () => {
    const env: Env = { TEST_DATABASE_URL: TEST_URL };

    expect(() => {
      applyTestConfig(env);
    }).toThrow(TEST_CONFIG_DIR_ENV);
    expect(env["CONFIG_PATH"]).toBeUndefined();
  });
});
