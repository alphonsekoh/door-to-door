import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * CI's snapshot check never reads the .sql files, so an edited applied
 * migration passed it (#131). db:generate records each new migration's SHA-256
 * here and never rewrites a line, so a later edit stops matching. The format is
 * sha256sum's, and each hash equals the one drizzle's migrator stores for it.
 */
export const CHECKSUM_FILE = "checksums.sha256";

const sha256 = (dir: string, name: string): string =>
  createHash("sha256")
    .update(readFileSync(join(dir, name)))
    .digest("hex");

const migrationFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

/* File name to hash. sha256sum's lines are 64 hex digits, two spaces, the name. */
function readChecksums(dir: string): Map<string, string> {
  const path = join(dir, CHECKSUM_FILE);
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  return new Map(lines.filter(Boolean).map((line) => [line.slice(66), line.slice(0, 64)]));
}

/* Appends a line for each migration without one, and returns their names. */
export function recordMigrationChecksums(dir: string): string[] {
  const recorded = readChecksums(dir);
  const added = migrationFiles(dir).filter((name) => !recorded.has(name));
  const lines = added.map((name) => `${sha256(dir, name)}  ${name}\n`);
  appendFileSync(join(dir, CHECKSUM_FILE), lines.join(""));
  return added;
}

/* One message per problem; empty when every migration is as it was generated. */
export function checkMigrationChecksums(dir: string): string[] {
  const recorded = readChecksums(dir);
  const files = migrationFiles(dir);
  const altered = [...recorded].flatMap(([name, hash]) => {
    if (!files.includes(name)) {
      return [
        `${name} is gone. An applied migration is never deleted; if this one was never merged, delete its line from ${CHECKSUM_FILE}.`,
      ];
    }
    return sha256(dir, name) === hash
      ? []
      : [
          `${name} changed after it was generated. Add a new migration instead of editing this one.`,
        ];
  });
  const unrecorded = files
    .filter((name) => !recorded.has(name))
    .map((name) => `${name} has no checksum. Generate migrations with npm run db:generate.`);
  return [...altered, ...unrecorded];
}
