import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The raw Auth.js session is the JWT, whose role and deactivated claims go
 * stale (#83). Only session.ts may read it - and resolve it against the
 * database - so a handler cannot trust the token by importing it directly.
 * The Auth.js route handler only issues sessions, it does not consume them.
 */
const ROOT = process.cwd();
const ALLOWED = new Set(["src/server/auth/session.ts", "src/app/api/auth/[...nextauth]/route.ts"]);
const AUTH_MODULE = resolve(ROOT, "auth");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    const isSource = /\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.includes(".test.");
    return isSource ? [path] : [];
  });
}

/* Static, dynamic, re-export and require forms; any quote style. */
const SPECIFIER = /(?:\bfrom|\bimport\s*\(?|\brequire\s*\()\s*["'`]([^"'`]+)["'`]/g;

function importsAuthModule(file: string, text: string): boolean {
  return [...text.matchAll(SPECIFIER)].some((match) => {
    const specifier = match[1] ?? "";
    const target = specifier.startsWith("@/")
      ? resolve(ROOT, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : undefined;
    return target === AUTH_MODULE;
  });
}

const files = sources(join(ROOT, "src"));
const rel = (file: string) => relative(ROOT, file);

describe("the raw Auth.js session", () => {
  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("is imported only by the resolver and the Auth.js route", () => {
    const offenders = files
      .filter((file) => !ALLOWED.has(rel(file)))
      .filter((file) => importsAuthModule(file, readFileSync(file, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("is imported by the resolver and the Auth.js route, so the list stays honest", () => {
    for (const allowed of ALLOWED) {
      expect(
        importsAuthModule(resolve(ROOT, allowed), readFileSync(allowed, "utf8")),
        allowed,
      ).toBe(true);
    }
  });

  it("is caught in every import form", () => {
    const file = join(ROOT, "src/app/api/x/route.ts");
    for (const text of [
      `import { auth } from "@/../auth";`,
      `import { auth } from '../../../../auth';`,
      `export { auth } from "../../../../auth";`,
      "const { auth } = await import(`@/../auth`);",
      `const { auth } = require("../../../../auth");`,
    ]) {
      expect(importsAuthModule(file, text), text).toBe(true);
    }
    expect(importsAuthModule(file, `import { x } from "@/server/auth/session";`)).toBe(false);
    expect(importsAuthModule(file, `import { y } from "next-auth/react";`)).toBe(false);
  });
});

describe("every API route resolves its caller through the database", () => {
  const routes = files.filter(
    (file) => /^src\/app\/api\/.*\/route\.[a-z]+$/.test(rel(file)) && !ALLOWED.has(rel(file)),
  );

  it("finds the route files", () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it.each(routes.map(rel))("%s", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/from "@\/server\/auth\/session"/);
  });
});
