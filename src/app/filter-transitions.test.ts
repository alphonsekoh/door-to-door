import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Nothing eases a filter. In CI, WPE WebKit, the Linux WebKit the E2E suite
 * runs, crashed its compositor thread (SIGSEGV) in nearly every run while a
 * pressed control's brightness eased back. A crash there does not look like
 * one: the page stops answering for as long as the core dump takes, and the
 * test times out somewhere unrelated (#111). Tailwind's plain `transition`
 * and `transition-all` both include filter.
 */

const ROOT = process.cwd();

function declarations(css: string): string[] {
  return [...css.matchAll(/(?:^|[;{\s])transition(?:-property)?\s*:\s*([^;}]+)/g)].map(
    ([, value = ""]) => value.trim(),
  );
}

const easesFilter = (value: string) => /\b(?:filter|all)\b/.test(value);

/* Class names in every string of a source file, variants stripped. */
function classNames(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)]
    .flatMap(([, quoted = "", templated = ""]) => `${quoted} ${templated}`.split(/\s+/))
    .map((token) => token.slice(token.lastIndexOf(":") + 1));
}

const easesFilterClass = (name: string) =>
  name === "transition" || name === "transition-all" || /^transition-\[.*filter/.test(name);

function sourceFiles(): string[] {
  return ["src/components", "src/app"].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
      .map((path) => join(ROOT, dir, path)),
  );
}

describe("transitions", () => {
  it("reads the press transition, so the checks below are not passing on nothing", () => {
    const found = declarations(readFileSync(join(ROOT, "src/app/globals.css"), "utf8"));
    expect(found).toContain("opacity, transform");
    expect(easesFilter("opacity, filter")).toBe(true);
    expect(classNames('className="hover:transition-all p-2"').some(easesFilterClass)).toBe(true);
  });

  it("never ease a filter in the stylesheet", () => {
    const found = declarations(readFileSync(join(ROOT, "src/app/globals.css"), "utf8"));
    expect(found.filter(easesFilter)).toEqual([]);
  });

  it("never ease a filter in a component's classes", () => {
    const offending = sourceFiles().flatMap((file) =>
      classNames(readFileSync(file, "utf8"))
        .filter(easesFilterClass)
        .map((name) => `${file.slice(ROOT.length + 1)}: ${name}`),
    );
    expect(offending).toEqual([]);
  });
});
