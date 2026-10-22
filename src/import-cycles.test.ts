import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * No module imports itself back, however far round. Sheet and ConfirmDialog
 * once imported each other, which worked only because each used the other
 * inside render: a module that reached for the other at load time would have
 * found it undefined, depending on which the bundler happened to evaluate
 * first (#111).
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/* Every value import or re-export: `import type` loads nothing. */
const STATIC = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolveLocal(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : resolve(dirname(from), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((path) => /\.tsx?$/.test(path) && existsSync(path)) ?? null;
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function localImports(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(STATIC)]
    .map(([, specifier = ""]) => specifier)
    .filter((specifier) => specifier.startsWith("@/") || specifier.startsWith("."))
    .map((specifier) => resolveLocal(specifier, file))
    .filter((path) => path !== null);
}

/* Each cycle as the chain of files round it. */
function cycles(files: string[]): string[] {
  const graph = new Map(files.map((file) => [file, localImports(file)]));
  const found: string[] = [];
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (file: string): void => {
    path.push(file);
    for (const next of graph.get(file) ?? []) {
      const at = path.indexOf(next);
      if (at !== -1) {
        found.push([...path.slice(at), next].map((step) => relative(ROOT, step)).join(" -> "));
      } else if (!done.has(next)) {
        visit(next);
      }
    }
    path.pop();
    done.add(file);
  };
  for (const file of files) if (!done.has(file)) visit(file);
  return found;
}

describe("the import graph", () => {
  it("reads the imports it is meant to be checking", () => {
    // A walk that found nothing would pass the check below.
    expect(localImports(join(SRC, "components/follow-ups/follow-up-sheet.tsx"))).toContain(
      join(SRC, "components/ui/sheet.tsx"),
    );
  });

  it("has no cycles", () => {
    expect(cycles(sources(SRC))).toEqual([]);
  });
});
