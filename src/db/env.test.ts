import { afterEach, describe, expect, it, vi } from "vitest";
import { MissingDatabaseUrlError, loadEnvFile, requireDatabaseUrl } from "@/db/env";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requireDatabaseUrl", () => {
  it("returns the configured connection string", () => {
    const url = "postgresql://postgres:postgres@localhost:5432/door_to_door";
    expect(requireDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });

  it("trims surrounding whitespace", () => {
    // A trailing newline from a Docker secret or shell heredoc is easy to miss.
    expect(requireDatabaseUrl({ DATABASE_URL: "  postgresql://db  " })).toBe("postgresql://db");
  });

  it("throws a named error when unset", () => {
    expect(() => requireDatabaseUrl({})).toThrow(MissingDatabaseUrlError);
  });

  it("throws when set but empty, rather than returning an empty string", () => {
    expect(() => requireDatabaseUrl({ DATABASE_URL: "   " })).toThrow(MissingDatabaseUrlError);
  });

  it("tells the reader how to fix it", () => {
    expect(() => requireDatabaseUrl({})).toThrow(/\.env\.example/);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://from-process-env");
    expect(requireDatabaseUrl()).toBe("postgresql://from-process-env");
  });
});

describe("loadEnvFile", () => {
  it("reports success when the file loads", () => {
    const spy = vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined);
    expect(loadEnvFile(".env")).toBe(true);
    expect(spy).toHaveBeenCalledWith(".env");
  });

  it("reports failure instead of throwing when absent", () => {
    // Normal in Docker and CI, where the environment is supplied directly.
    vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(loadEnvFile(".env")).toBe(false);
  });

  it("defaults to .env", () => {
    const spy = vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined);
    loadEnvFile();
    expect(spy).toHaveBeenCalledWith(".env");
  });
});
