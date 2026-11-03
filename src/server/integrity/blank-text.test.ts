import { describe, expect, it } from "vitest";
import {
  CLEAN_MESSAGE,
  HOUSEHOLD_CAUTION,
  formatBlankReport,
  type BlankBlock,
  type BlankFollowUp,
  type BlankHousehold,
} from "@/server/integrity/blank-text";

const MARCH = new Date("2026-03-14T10:00:00.000Z");
const APRIL = new Date("2026-04-02T09:30:00.000Z");

const household: BlankHousehold = {
  id: "h-empty",
  blockId: "b-123",
  blockName: "123",
  street: "Test Ave",
  unitNumber: "",
  createdAt: MARCH,
  visitCount: 2,
  firstVisit: { id: "v-first", memberEmail: "alice@t.local", at: APRIL },
};

const followUp: BlankFollowUp = {
  id: "f-spaces",
  householdId: "h-good",
  blockName: "123",
  street: "Test Ave",
  unitNumber: "#05-123",
  note: "   ",
  status: "suggested",
  authorEmail: "ben@t.local",
  createdAt: APRIL,
  removed: false,
};

const block: BlankBlock = { id: "b-nameless", name: "", street: "Nameless Rd", createdAt: MARCH };

const none = { households: [], followUps: [], blocks: [] };

describe("formatBlankReport", () => {
  it("passes a clean database with one line and exit code 0", () => {
    expect(formatBlankReport(none)).toEqual({ lines: [CLEAN_MESSAGE], exitCode: 0 });
  });

  it("prints a household with its block, its unit quoted, and its first knock", () => {
    const { lines, exitCode } = formatBlankReport({ ...none, households: [household] });
    expect(exitCode).toBe(1);
    expect(lines).toEqual([
      "Households with a blank unit number (1):",
      '  household h-empty: unit "" in Blk "123", "Test Ave" (block b-123), created 2026-03-14T10:00:00.000Z; ' +
        "2 visits, the first v-first by alice@t.local at 2026-04-02T09:30:00.000Z",
      "1 row holds blank text. Nothing was changed. The not-blank migration (0005_not_blank_text) " +
        "fails until each is corrected or removed by hand.",
      HOUSEHOLD_CAUTION,
    ]);
    expect(HOUSEHOLD_CAUTION).toMatch(
      /^Deleting a household also deletes its visits and follow-up notes/,
    );
  });

  it("says when a blank household has no visits, and counts one visit as one", () => {
    const { lines } = formatBlankReport({
      ...none,
      households: [
        { ...household, id: "h-alone", visitCount: 0, firstVisit: null },
        { ...household, id: "h-once", visitCount: 1 },
      ],
    });
    expect(lines[1]).toMatch(/^ {2}household h-alone: .*; no visits$/);
    expect(lines[2]).toContain("; 1 visit, the first v-first");
  });

  it("prints a note with where it is, who wrote it, and whether it was removed", () => {
    const { lines } = formatBlankReport({
      ...none,
      followUps: [
        followUp,
        { ...followUp, id: "f-removed", note: "", status: "listed", removed: true },
      ],
    });
    expect(lines.slice(0, 3)).toEqual([
      "Follow-up notes that are blank (2):",
      '  follow-up f-spaces: note "   ", suggested, by ben@t.local, created 2026-04-02T09:30:00.000Z; ' +
        'at unit "#05-123" in Blk "123", "Test Ave" (household h-good)',
      '  follow-up f-removed: note "", listed, removed, by ben@t.local, created 2026-04-02T09:30:00.000Z; ' +
        'at unit "#05-123" in Blk "123", "Test Ave" (household h-good)',
    ]);
    expect(lines[3]).toMatch(/^2 rows hold blank text\./);
    // Deleting a note loses only the note, so no warning about cascades.
    expect(lines).toHaveLength(4);
  });

  it("prints a block with both fields quoted", () => {
    const { lines } = formatBlankReport({ ...none, blocks: [block] });
    expect(lines.slice(0, 2)).toEqual([
      "Blocks with a blank name or street (1):",
      '  block b-nameless: name "", street "Nameless Rd", created 2026-03-14T10:00:00.000Z',
    ]);
    expect(lines).not.toContain(HOUSEHOLD_CAUTION);
  });

  it("heads only the kinds that have rows, in one order, and counts them all", () => {
    const { lines, exitCode } = formatBlankReport({
      households: [household],
      followUps: [],
      blocks: [block, { ...block, id: "b-streetless", name: "456", street: " " }],
    });
    expect(exitCode).toBe(1);
    expect(lines.filter((line) => !line.startsWith("  "))).toEqual([
      "Households with a blank unit number (1):",
      "Blocks with a blank name or street (2):",
      expect.stringMatching(/^3 rows hold blank text\. Nothing was changed\./),
      HOUSEHOLD_CAUTION,
    ]);
  });
});
