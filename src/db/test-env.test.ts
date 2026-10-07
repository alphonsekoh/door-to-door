import { describe, expect, it, vi } from "vitest";
import { MissingTestDatabaseUrlError, requireTestDatabaseUrl } from "@/db/test-env";

describe("requireTestDatabaseUrl", () => {
  it("returns the configured URL, trimmed", () => {
    expect(requireTestDatabaseUrl({ TEST_DATABASE_URL: "  postgresql://u:p@h/db\n" })).toBe(
      "postgresql://u:p@h/db",
    );
  });

  it.each([undefined, "", "   "])("refuses %j rather than guessing a database", (value) => {
    expect(() => requireTestDatabaseUrl({ TEST_DATABASE_URL: value })).toThrow(
      MissingTestDatabaseUrlError,
    );
  });

  it("does not fall back to the old DATABASE_URL", () => {
    // A leftover DATABASE_URL could point at a real database that truncateAll would empty.
    expect(() => requireTestDatabaseUrl({ DATABASE_URL: "postgresql://real/db" })).toThrow(
      /TEST_DATABASE_URL/,
    );
  });

  it("reads process.env by default", () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://from-env/db");
    expect(requireTestDatabaseUrl()).toBe("postgresql://from-env/db");
    vi.unstubAllEnvs();
  });
});
