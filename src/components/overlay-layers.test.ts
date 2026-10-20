import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The bottom nav is fixed and painted at z-40. A sheet that opens over it must
 * sit above it, or its primary action ends up under the nav and cannot be
 * tapped at all - which is exactly what shipped in #26, #28 and #29 and was
 * only found by looking at a phone-sized screenshot.
 *
 * jsdom does not compute stacking, so no rendering test can catch this. The
 * source is checked directly instead. E2E in a real browser (#37) is the
 * proper long-term guard; this stops the next sheet being pasted in at z-20.
 */

const DIR = join(process.cwd(), "src/components");
const NAV_LAYER = 40;

/* A full-screen overlay: the shape every sheet and dialog in the app uses.
   The shared Sheet keeps one literal per layer in a lookup, not a className
   attribute, so the opening quote is all the pattern anchors on. */
const OVERLAY = /"fixed inset-0 z-(\d+)/g;

function sources(): { file: string; text: string }[] {
  return readdirSync(DIR)
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
    .map((file) => ({ file, text: readFileSync(join(DIR, file), "utf8") }));
}

describe("overlay stacking", () => {
  it("finds the overlays it is meant to be guarding", () => {
    // A pattern that matches nothing would pass every assertion below.
    const found = sources().filter(({ text }) => new RegExp(OVERLAY.source).test(text));
    expect(found.map(({ file }) => file).sort()).toEqual(["auth-failure-screen.tsx", "sheet.tsx"]);
  });

  it("builds every sheet and dialog on the shared Sheet, so none sets its own layer", () => {
    // A hand-rolled overlay would escape both this test and the motion and
    // portal rules the Sheet carries (#111).
    const dialogs = sources().filter(
      ({ file, text }) =>
        /role="(alert)?dialog"/.test(text) &&
        !/<Sheet\b/.test(text) &&
        !["sheet.tsx", "auth-failure-screen.tsx"].includes(file),
    );
    expect(dialogs.map(({ file }) => file)).toEqual([]);
    for (const file of [
      "admin-team-sheet.tsx",
      "amend-visit-sheet.tsx",
      "block-attach-sheet.tsx",
      "confirm-dialog.tsx",
      "follow-up-sheet.tsx",
      "record-on-behalf-form.tsx",
      "sync-queue-sheet.tsx",
      "team-sheet.tsx",
    ]) {
      expect(readFileSync(join(DIR, file), "utf8"), file).toMatch(/<Sheet\b/);
    }
  });

  it("puts every overlay above the bottom nav", () => {
    const offenders: string[] = [];
    for (const { file, text } of sources()) {
      for (const match of text.matchAll(OVERLAY)) {
        const layer = Number(match[1]);
        if (layer <= NAV_LAYER) offenders.push(`${file}: z-${String(layer)}`);
      }
    }
    expect(offenders, "an overlay at or below the nav's layer is untappable").toEqual([]);
  });

  it("keeps the nav itself at the layer this is measured against", () => {
    const nav = readFileSync(join(DIR, "bottom-nav.tsx"), "utf8");
    expect(nav).toContain(`z-${String(NAV_LAYER)}`);
  });

  it("opens a confirmation above the sheet that raised it", () => {
    // Ending an outing confirms from inside the detail screen; detaching a
    // block confirms over the sheet listing them.
    const sheet = readFileSync(join(DIR, "sheet.tsx"), "utf8");
    const layerOf = (name: string) =>
      Number(new RegExp(`${name}: "fixed inset-0 z-(\\d+)`).exec(sheet)?.[1]);
    expect(layerOf("dialog")).toBeGreaterThan(layerOf("sheet"));
    expect(readFileSync(join(DIR, "confirm-dialog.tsx"), "utf8")).toContain('layer="dialog"');
  });

  it("keeps the install and update banners beneath the nav and every sheet", () => {
    // A banner above a sheet would cover its Save button; above the nav it
    // would hide the tabs. Neither is a full-screen overlay, so the pattern
    // above does not see them.
    // The class itself, wherever it is written: the install banner picks
    // between floating and sitting in the page.
    const banner = /"fixed [^"]*\bz-(\d+)/;
    const sheetLayers = sources()
      .flatMap(({ text }) => [...text.matchAll(OVERLAY)].map((match) => Number(match[1])))
      .sort((a, b) => a - b);
    const lowestSheet = sheetLayers[0] ?? Infinity;

    for (const file of ["install-prompt.tsx", "update-prompt.tsx"]) {
      const layer = Number(banner.exec(readFileSync(join(DIR, file), "utf8"))?.[1]);
      expect(layer, `${file} has no fixed layer`).toBeLessThan(NAV_LAYER);
      expect(layer).toBeLessThan(lowestSheet);
    }
  });

  it("puts the account message above every sheet and dialog", () => {
    // Once the session is refused nothing underneath can succeed, so nothing
    // underneath may show through or take a tap - not even a confirmation.
    const layerOf = (text: string) => Number(new RegExp(OVERLAY.source).exec(text)?.[1]);
    const screenLayer = layerOf(readFileSync(join(DIR, "auth-failure-screen.tsx"), "utf8"));
    const others = sources()
      .filter(({ file }) => file !== "auth-failure-screen.tsx")
      .flatMap(({ text }) => [...text.matchAll(OVERLAY)].map((match) => Number(match[1])));
    expect(others.length).toBeGreaterThan(0);
    expect(screenLayer).toBeGreaterThan(Math.max(...others));
  });
});
