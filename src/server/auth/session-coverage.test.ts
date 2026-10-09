import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A handler that reads the token directly would trust a deactivated account's
 * old cookie. Every route file must resolve its caller through
 * src/server/auth/session, so a new handler cannot quietly bypass the lookup.
 */
const API_ROOT = "src/app/api";
// Auth.js's own endpoints: they issue sessions rather than consume them.
const EXEMPT = new Set([join(API_ROOT, "auth")]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (EXEMPT.has(path)) {
      return [];
    }
    if (entry.isDirectory()) {
      return routeFiles(path);
    }
    return entry.name === "route.ts" ? [path] : [];
  });
}

const files = routeFiles(API_ROOT);

describe("every API route resolves its caller from the database", () => {
  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source, "must not read the raw token").not.toMatch(/from "@\/\.\.\/auth"/);
    expect(source, "must not call requireUser/requireAdmin on a raw session").not.toMatch(
      /require(User|Admin|Role)\(\s*await auth\(/,
    );
    expect(source).toMatch(/from "@\/server\/auth\/session"/);
  });
});
