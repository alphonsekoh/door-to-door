import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHECKSUM_FILE,
  checkMigrationChecksums,
  recordMigrationChecksums,
} from "@/server/integrity/migration-checksums";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2d-migrations-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, content: string): void => {
  writeFileSync(join(dir, name), content);
};
const checksums = (): string => readFileSync(join(dir, CHECKSUM_FILE), "utf8");

const CREATE_A = 'CREATE TABLE "a" ("id" integer);\n';
const CREATE_A_SHA256 = "ac1b8d3aa037fc7e4d0a8894ef3457001392bffb34bc923b472faeeef5e01305";

describe("recordMigrationChecksums", () => {
  it("records each new migration in sha256sum's format, and nothing else in the folder", () => {
    write("0000_a.sql", CREATE_A);
    write("notes.txt", "not a migration");

    expect(recordMigrationChecksums(dir)).toEqual(["0000_a.sql"]);
    expect(checksums()).toBe(`${CREATE_A_SHA256}  0000_a.sql\n`);
  });

  it("only appends, so a migration edited after it was recorded keeps its first hash", () => {
    write("0000_a.sql", CREATE_A);
    recordMigrationChecksums(dir);
    write("0000_a.sql", 'CREATE TABLE "b" ("id" integer);\n');
    write("0001_c.sql", 'CREATE TABLE "c" ("id" integer);\n');

    expect(recordMigrationChecksums(dir)).toEqual(["0001_c.sql"]);
    expect(checksums().startsWith(`${CREATE_A_SHA256}  0000_a.sql\n`)).toBe(true);
    // 0001_c is recorded and unchanged, so only the edited one is refused.
    expect(checkMigrationChecksums(dir)).toEqual([
      "0000_a.sql changed after it was generated. Add a new migration instead of editing this one.",
    ]);
  });
});

describe("checkMigrationChecksums", () => {
  it("refuses a recorded migration that was deleted", () => {
    write("0000_a.sql", CREATE_A);
    recordMigrationChecksums(dir);
    unlinkSync(join(dir, "0000_a.sql"));

    expect(checkMigrationChecksums(dir)).toEqual([
      `0000_a.sql is gone. An applied migration is never deleted; if this one was never merged, delete its line from ${CHECKSUM_FILE}.`,
    ]);
  });

  it("refuses a migration that db:generate never recorded, even with no list at all", () => {
    write("0000_a.sql", CREATE_A);

    expect(checkMigrationChecksums(dir)).toEqual([
      "0000_a.sql has no checksum. Generate migrations with npm run db:generate.",
    ]);
  });
});

describe("the committed migrations", () => {
  it("are byte for byte what db:generate recorded", () => {
    expect(checkMigrationChecksums("drizzle")).toEqual([]);
  });
});
