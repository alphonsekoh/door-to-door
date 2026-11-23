import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Motion is about a tenth of the app's client JavaScript. The screens that
 * open no sheet must not download it: sign-in is the first load on a new
 * phone, often in poor signal. The root layout is on every page, so one
 * static import anywhere under it puts Motion on all of them, as the sync
 * bar's sheet once did (#111).
 *
 * The bundler follows static imports and splits at `import()`, so the same
 * walk over the source says what each entry loads.
 */

const ROOT = process.cwd();

/* Every value import of a module: `import type` loads nothing, and neither
   does `import()` until it runs. */
const STATIC = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolveLocal(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(ROOT, "src", specifier.slice(2))
    : resolve(dirname(from), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((path) => /\.tsx?$/.test(path) && existsSync(path)) ?? null;
}

/* The packages an entry loads, through every local module it reaches. */
function packagesLoadedBy(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const pending = [join(ROOT, entry)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier = ""] of readFileSync(file, "utf8").matchAll(STATIC)) {
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const local = resolveLocal(specifier, file);
        if (local !== null) pending.push(local);
      } else {
        packages.add(specifier);
      }
    }
  }
  return packages;
}

const usesMotion = (packages: Set<string>) =>
  [...packages].filter((name) => name === "motion" || name.startsWith("motion/"));

describe("what the first load downloads", () => {
  it("finds Motion where a sheet is drawn, so the walk is not missing it", () => {
    // A walk that found nothing would pass every assertion below.
    expect(usesMotion(packagesLoadedBy("src/components/ui/sheet.tsx"))).not.toEqual([]);
    expect(usesMotion(packagesLoadedBy("src/app/history/page.tsx"))).not.toEqual([]);
  });

  it.each([
    "src/app/layout.tsx",
    "src/app/sign-in/page.tsx",
    "src/app/privacy/page.tsx",
    "src/app/not-found.tsx",
  ])("keeps Motion out of %s", (entry) => {
    expect(usesMotion(packagesLoadedBy(entry))).toEqual([]);
  });
});
