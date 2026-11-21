import { describe, expect, it } from "vitest";
import type { FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";
import { zGetHouseholdHistoryQuery } from "@/generated/zod.gen";
import {
  HISTORY_PAGE_SIZE,
  addEarlier,
  historyPath,
  holdVisits,
  keepFirstPage,
  timelineNotes,
} from "@/lib/households/history-pages";
import { MAX_OFFSET } from "@/lib/households/pages";

/* Visit n was stored on day n of March, so a higher n is newer. */
const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const visit = (n: number, over: Partial<Visit> = {}): Visit => ({
  id: `v${String(n).padStart(2, "0")}`,
  householdId: "h1",
  sessionId: "s1",
  member: { id: "u1", name: "Alice", image: null },
  team: null,
  interestLevel: "low",
  description: "",
  clientCreatedAt: day(n),
  createdAt: day(n),
  updatedAt: day(n),
  ...over,
});
/* Newest first, as the server answers. */
const run = (from: number, to: number) => {
  const visits: Visit[] = [];
  for (let n = from; n >= to; n -= 1) visits.push(visit(n));
  return visits;
};

/*
 * run's visits as one batch stores them: a microsecond apart, so in one
 * millisecond on the wire (D-251-7), with ids that rise as they get older.
 * Only the order the server sent them in tells them apart.
 */
const batched = (from: number, to: number) => {
  const visits: Visit[] = [];
  for (let n = from; n >= to; n -= 1) {
    visits.push(visit(n, { id: `b${String(100 - n)}`, createdAt: day(9) }));
  }
  return visits;
};

const page = (
  visits: Visit[],
  offset: number,
  total: number,
  household = "h1",
): HouseholdHistory => ({
  household: {
    id: household,
    blockId: "b1",
    unitNumber: "#05-123",
    name: null,
    contact: null,
    religion: null,
    createdAt: day(1),
    updatedAt: day(1),
  },
  block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: day(1) },
  visits,
  answered: true,
  pagination: { limit: 5, offset, total, hasMore: offset + visits.length < total },
  followUps: [],
});

const note = (id: string, createdAt: string): FollowUp => ({
  id,
  householdId: "h1",
  blockId: "b1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  status: "listed",
  author: { id: "u1", name: "Alice", image: null },
  note: id,
  dueDate: null,
  doneAt: createdAt,
  doneBy: null,
  listedAt: null,
  listedBy: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  waitingSuggestionBy: null,
  createdAt,
});

const ids = (visits: readonly Visit[]) => visits.map((v) => v.id);

describe("historyPath", () => {
  it("asks for a page of twenty from the newest unless told where", () => {
    expect(HISTORY_PAGE_SIZE).toBe(20);
    expect(historyPath("h1")).toBe("/households/h1?limit=20&offset=0");
    expect(historyPath("h1", 40)).toBe("/households/h1?limit=20&offset=40");
  });

  it("asks for a page the contract takes, as deep as the offset cap", () => {
    expect(
      zGetHouseholdHistoryQuery.safeParse({ limit: HISTORY_PAGE_SIZE, offset: MAX_OFFSET }).success,
    ).toBe(true);
  });
});

describe("addEarlier", () => {
  it("starts from the first older page, the next offset being what it received", () => {
    const earlier = addEarlier(null, page(run(5, 1), 5, 10));
    expect(earlier).toEqual({
      householdId: "h1",
      visits: run(5, 1),
      next: 10,
      total: 10,
      ended: false,
    });
  });

  it("adds each older page after the last", () => {
    const first = addEarlier(null, page(run(15, 11), 5, 20));
    const second = addEarlier(first, page(run(10, 6), 10, 20));
    expect(ids(second.visits)).toEqual(ids(run(15, 6)));
    expect(second.next).toBe(15);
  });

  it("starts afresh on a page of another unit, so two doors never mix", () => {
    const mine = addEarlier(null, page(run(10, 6), 5, 10));
    const theirs = addEarlier(mine, page([visit(3, { householdId: "h2" })], 5, 6, "h2"));
    expect(theirs).toEqual({
      householdId: "h2",
      visits: [visit(3, { householdId: "h2" })],
      next: 6,
      total: 6,
      ended: false,
    });
  });

  it("never moves the next offset or the total back", () => {
    // An answer to a tap from before the last one landed arrives last.
    const ahead = addEarlier(null, page(run(10, 6), 10, 30));
    const behind = addEarlier(ahead, page(run(15, 11), 5, 25));
    expect(behind).toMatchObject({ next: 15, total: 30 });
  });

  it("ends on an empty read", () => {
    const earlier = addEarlier(null, page([], 5, 9));
    expect(earlier).toMatchObject({ next: 5, ended: true });
  });
});

describe("keepFirstPage", () => {
  it("keeps a first page read again past, so a visit stored in between leaves no gap", () => {
    // v1..v30 shown 30..11; older is asked for from 20; v31 is stored and the
    // parent reads the first page again (31..12) before the older page lands.
    const first = page(run(30, 11), 0, 30);
    const kept = keepFirstPage(null, first);
    expect(kept).toEqual({
      householdId: "h1",
      visits: run(30, 11),
      next: 20,
      total: 30,
      ended: false,
    });

    const landed = addEarlier(kept, page(run(10, 1), 20, 30));
    const held = holdVisits(page(run(31, 12), 0, 31), landed);
    expect(ids(held.visits)).toEqual(ids(run(31, 1)));
    // Reading on from 30 repeats v1 rather than skipping one.
    expect(held).toMatchObject({ next: 30, total: 31, more: true });
  });

  it("holds a first page read again above the older pages, which it is newer than", () => {
    // The older page lands first; then v31 is stored and the first page read again.
    const landed = addEarlier(null, page(batched(10, 1), 20, 30));
    const kept = keepFirstPage(landed, page(batched(30, 11), 0, 30));
    expect(ids(kept.visits)).toEqual(ids(batched(30, 1)));

    const held = holdVisits(page(batched(31, 12), 0, 31), kept);
    expect(ids(held.visits)).toEqual(ids(batched(31, 1)));
  });

  it("leaves whether older pages ended as it was, whatever the first page held", () => {
    // A visit stored between the page and its count: none read, one counted.
    expect(keepFirstPage(null, page([], 0, 1)).ended).toBe(false);
    const ended = addEarlier(null, page([], 5, 5));
    expect(keepFirstPage(ended, page(run(5, 1), 0, 5)).ended).toBe(true);
  });

  it("starts afresh from a first page of another unit", () => {
    const theirs = addEarlier(null, page([visit(1, { householdId: "h2" })], 5, 6, "h2"));
    expect(keepFirstPage(theirs, page(run(3, 1), 0, 3))).toEqual({
      householdId: "h1",
      visits: run(3, 1),
      next: 3,
      total: 3,
      ended: false,
    });
  });
});

describe("holdVisits", () => {
  it("holds the first page alone, with more to read while its total says so", () => {
    expect(holdVisits(page(run(10, 6), 0, 10), null)).toEqual({
      visits: run(10, 6),
      next: 5,
      total: 10,
      more: true,
    });
  });

  it("has no more once the first page is the whole unit", () => {
    expect(holdVisits(page(run(3, 1), 0, 3), null).more).toBe(false);
  });

  it("puts the older pages under the first, newest first", () => {
    const earlier = addEarlier(null, page(run(5, 1), 5, 10));
    const held = holdVisits(page(run(10, 6), 0, 10), earlier);
    expect(ids(held.visits)).toEqual(ids(run(10, 1)));
    expect(held).toMatchObject({ next: 10, total: 10, more: false });
  });

  it("keeps the server's order for visits in one millisecond, across pages", () => {
    const earlier = addEarlier(null, page(batched(5, 1), 5, 10));
    const held = holdVisits(page(batched(10, 6), 0, 10), earlier);
    expect(ids(held.visits)).toEqual(ids(batched(10, 1)));
  });

  it("repeats rather than skips a visit stored between two reads, and keeps it once", () => {
    // Page 1 read v10..v6; v11 is stored; offset 5 then answers v6..v2.
    const first = page(run(10, 6), 0, 10);
    const earlier = addEarlier(null, page(run(6, 2), 5, 11));
    const held = holdVisits(first, earlier);
    expect(ids(held.visits)).toEqual(ids(run(10, 2)));
    expect(held).toMatchObject({ next: 10, total: 11, more: true });

    // v11 arrives with the next read of the first page, and v1 is still to come.
    const reread = holdVisits(page(run(11, 7), 0, 11), earlier);
    expect(ids(reread.visits)).toEqual(ids(run(11, 2)));
    expect(reread).toMatchObject({ next: 10, total: 11, more: true });
  });

  it("keeps the copy amended last, and the first page's on a tie", () => {
    const amended = visit(6, { description: "Amended", updatedAt: day(20) });
    const stale = visit(6, { description: "Stale" });
    const fromEarlier = holdVisits(
      page([visit(7), stale], 0, 4),
      addEarlier(null, page([amended, visit(5)], 1, 4)),
    );
    expect(fromEarlier.visits.find((v) => v.id === "v06")?.description).toBe("Amended");

    const fromFirst = holdVisits(
      page([visit(7), amended], 0, 4),
      addEarlier(null, page([stale, visit(5)], 1, 4)),
    );
    expect(fromFirst.visits.find((v) => v.id === "v06")?.description).toBe("Amended");

    const tie = holdVisits(
      page([visit(7), visit(6, { description: "First page's" })], 0, 4),
      addEarlier(null, page([visit(6, { description: "Older page's" }), visit(5)], 1, 4)),
    );
    expect(tie.visits.find((v) => v.id === "v06")?.description).toBe("First page's");
  });

  it("keeps the next offset where the older pages reached after the first is read again", () => {
    const earlier = addEarlier(null, page(run(10, 6), 5, 20));
    const held = holdVisits(page(run(20, 16), 0, 20), earlier);
    expect(held.next).toBe(10);
  });

  it("ignores older pages of another unit", () => {
    const theirs = addEarlier(null, page([visit(1, { householdId: "h2" })], 5, 6, "h2"));
    const held = holdVisits(page(run(10, 6), 0, 10), theirs);
    expect(held).toEqual({ visits: run(10, 6), next: 5, total: 10, more: true });
  });

  it("has no more after an empty read, whatever the total says", () => {
    const earlier = addEarlier(null, page([], 5, 10));
    expect(holdVisits(page(run(10, 6), 0, 10), earlier).more).toBe(false);
  });

  it("stops where the contract's offset cap does", () => {
    const at = (offset: number) => ({
      householdId: "h1",
      visits: [],
      next: offset,
      total: MAX_OFFSET + 500,
      ended: false,
    });
    const first = page(run(10, 6), 0, MAX_OFFSET + 500);
    expect(holdVisits(first, at(MAX_OFFSET)).more).toBe(true);
    expect(holdVisits(first, at(MAX_OFFSET + 20)).more).toBe(false);
  });
});

describe("timelineNotes", () => {
  const notes = [note("ancient", day(1)), note("on the day", day(6)), note("recent", day(9))];

  it("gives every note once every visit is held", () => {
    expect(timelineNotes(notes, holdVisits(page(run(10, 6), 0, 5), null))).toEqual(notes);
  });

  it("holds back notes older than every visit shown while older visits remain", () => {
    const held = holdVisits(page(run(10, 6), 0, 10), null);
    expect(timelineNotes(notes, held).map((n) => n.id)).toEqual(["on the day", "recent"]);
  });

  it("gives every note when no visit is held to measure from", () => {
    // A visit stored between the page and its count: none shown, one counted.
    const held = holdVisits(page([], 0, 1), null);
    expect(held.more).toBe(true);
    expect(timelineNotes(notes, held)).toEqual(notes);
  });
});
