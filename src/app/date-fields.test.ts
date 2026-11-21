import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

/*
 * Safari on iOS draws a native date control content-box with a 30px
 * min-height, whatever the page sets. On All records the From and To inputs
 * ran 27px out of their cells, To past the screen's edge, and stood 32px
 * tall beside 51px selects; the follow-up sheet's ran 28px out too (#245).
 * The field utility takes the appearance away. No engine the E2E suite runs
 * draws iOS's control and jsdom lays nothing out, so the cause is checked:
 * every date input is a field, and the field rule drops a date's appearance.
 */

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

type DateInput = { file: string; id: string; classes: string[] };

/* Every <input type="date"> in the app's source, with its literal classes. */
function dateInputs(): DateInput[] {
  return ["src/components", "src/app"].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".tsx") && !path.endsWith(".test.tsx"))
      .flatMap((path) =>
        [...readFileSync(join(ROOT, dir, path), "utf8").matchAll(/<input\b(?:(?!\/>)[\s\S])*\/>/g)]
          .map(([element]) => element)
          .filter((element) => /\btype="date"/.test(element))
          .map((element) => ({
            file: join(dir, path),
            id: /\bid="([^"]*)"/.exec(element)?.[1] ?? "",
            classes: (/\bclassName="([^"]*)"/.exec(element)?.[1] ?? "").split(/\s+/),
          })),
      ),
  );
}

/* The stylesheet Tailwind builds from globals.css for the given classes. */
async function built(classes: string[]): Promise<string> {
  const compiler = await compile(readFileSync(join(ROOT, "src/app/globals.css"), "utf8"), {
    base: join(ROOT, "src/app"),
    loadStylesheet: (id: string, base: string) => {
      const path = require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id, {
        paths: [base],
      });
      return Promise.resolve({ path, base, content: readFileSync(path, "utf8") });
    },
  });
  return compiler.build(classes);
}

describe("date inputs", () => {
  it("finds the date inputs it is meant to be guarding", () => {
    // A pattern that matches nothing would pass every assertion below.
    expect(dateInputs().map(({ id }) => id)).toEqual(
      expect.arrayContaining(["history-from", "history-to", "follow-up-due"]),
    );
  });

  it("styles every date input as a field", () => {
    const unstyled = dateInputs()
      .filter(({ classes }) => !classes.includes("field"))
      .map(({ file, id }) => `${file}: #${id}`);
    expect(unstyled).toEqual([]);
  });

  it("drops a date field's native appearance", async () => {
    // The field rule and the rules nested in it, one level deep.
    const field = /\.field \{(?:[^{}]|\{[^{}]*\})*\}/.exec(await built(["field"]))?.[0];
    expect(field).toMatch(/&\[type="date"\] \{\s*appearance: none;\s*\}/);
  });
});
