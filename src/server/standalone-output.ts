import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/*
 * Settings and secrets are supplied at runtime, never baked into a build
 * (D-75-19). `next build` breaks that twice in the standalone output: it copies
 * `.env` and `.env.production` unconditionally, with no option to stop it, and
 * the output file tracing copies any file the bundler thinks the server reads.
 * The build therefore prunes the first and refuses to finish on the second.
 */

export const STANDALONE_DIR = join(".next", "standalone");

const isDotEnv = (name: string): boolean => name === ".env" || name.startsWith(".env.");

/* Mirrors .dockerignore: any .env, and config.yaml or any config.*.yaml. */
export function isForbiddenFile(name: string): boolean {
  return isDotEnv(name) || (name.startsWith("config.") && name.endsWith(".yaml"));
}

/* The .env files Next copies land at the output root; nothing else is touched. */
export function pruneDotEnv(dir: string): string[] {
  const removed = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isDotEnv(entry.name))
    .map((entry) => entry.name);
  for (const name of removed) {
    rmSync(join(dir, name));
  }
  return removed;
}

/*
 * node_modules is skipped: a package may ship its own `.env.example`, and the
 * project's files are never traced into it.
 */
export function findForbiddenFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === "node_modules"
        ? []
        : findForbiddenFiles(join(dir, entry.name), relative);
    }
    return isForbiddenFile(entry.name) ? [relative] : [];
  });
}

export type StandaloneCheck = { removed: string[]; forbidden: string[] };

export function checkStandaloneOutput(dir: string): StandaloneCheck {
  const removed = pruneDotEnv(dir);
  return { removed, forbidden: findForbiddenFiles(dir) };
}
