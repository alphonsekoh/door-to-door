import { describe, expect, it } from "vitest";
import type {
  ActiveSession,
  HouseholdHistory,
  HouseholdSummary,
  RevisitEntry,
} from "@/generated/types.gen";
import {
  LOCAL_COPY_TTL_MS,
  copyExpired,
  liveThreads,
  noteThreads,
  withThreads,
  type LocalCopy,
  noteBlock,
  noteOuting,
  noteRevisits,
  offlineRows,
  readCopy,
  replaceRevisits,
  shellBlocks,
  usableCopy,
} from "@/lib/offline/local-copy";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const ALICE = { id: "0190a000-0000-7000-8000-00000000000a", name: "Alice" };
const BEN = { id: "0190a000-0000-7000-8000-00000000000b", name: "Ben" };
const BLK_123 = "0190a000-0000-7000-8000-000000000123";
const BLK_456 = "0190a000-0000-7000-8000-000000000456";
const TONIGHT = "0190a000-0000-7000-8000-0000000000cc";
const LAST_WEEK = "0190a000-0000-7000-8000-0000000000dd";
const STAMP = "2026-10-15T09:00:00.000Z";

const block = (id: string, name: string) => ({
  id,
  name,
  street: "Ang Mo Kio Ave 3",
  postalCode: null,
  createdAt: STAMP,
});

function active(sessionId = TONIGHT, blockIds = [BLK_123, BLK_456]): ActiveSession {
  return {
    session: {
      id: sessionId,
      title: "Thursday evening",
      kind: "regular",
      status: "active",
      startedAt: STAMP,
      endedAt: null,
      createdBy: { id: ALICE.id, name: "Admin" },
      createdAt: STAMP,
    },
    blocks: blockIds.map((id) => ({
      block: block(id, id === BLK_123 ? "123" : "456"),
      visitCount: 0,
      householdCount: 0,
      activeMembers: [],
    })),
    picks: [],
  };
}

function household(unitNumber: string, blockId = BLK_123): HouseholdSummary {
  return {
    household: {
      id: `0190a000-0000-7000-8000-${unitNumber.replace(/\D/g, "").padStart(12, "0")}`,
      blockId,
      unitNumber,
      name: "Mrs Tan",
      contact: "9123 4567",
      religion: "buddhist",
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    visitCount: 1,
    latestVisit: {
      id: "0190a000-0000-7000-8000-0000000000ee",
      householdId: "0190a000-0000-7000-8000-0000000000ff",
      sessionId: LAST_WEEK,
      member: { id: BEN.id, name: "Ben" },
      team: null,
      interestLevel: "medium",
      description: "Come back on Sunday",
      clientCreatedAt: STAMP,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    outstandingFollowUps: 1,
  };
}

/* Tonight's follow-up list: #05-01 in Blk 123. */
function revisits(): RevisitEntry[] {
  const { household: unit, latestVisit } = household("#05-01");
  return [
    {
      household: unit,
      block: block(BLK_123, "123"),
      notes: [
        {
          id: "0190a000-0000-7000-8000-0000000000f1",
          householdId: unit.id,
          blockId: BLK_123,
          blockName: "123",
          unitNumber: "#05-01",
          visitId: null,
          status: "listed",
          author: { id: ALICE.id, name: "Admin", image: null },
          note: "Bring the booklet",
          dueDate: null,
          doneAt: null,
          doneBy: null,
          listedAt: STAMP,
          listedBy: { id: ALICE.id, name: "Admin", image: null },
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
          waitingSuggestionBy: null,
          createdAt: STAMP,
        },
      ],
      latestVisit,
      visitedInSession: false,
    },
  ];
}

/* Alice, tonight's outing, Blk 123 opened at NOW. */
function copyWithBlock(at = NOW): LocalCopy {
  const copy = noteBlock(null, ALICE, active(), BLK_123, [household("#05-01")], at);
  if (copy === null) throw new Error("expected a copy");
  return copy;
}

function queued(unitNumber: string, at: number, overrides: Partial<QueuedVisit> = {}) {
  return {
    ...buildQueuedVisit(
      {
        blockId: BLK_123,
        unitNumber,
        interestLevel: "high",
        description: "",
        name: "",
        contact: "",
        religion: "",
        sessionId: TONIGHT,
      },
      ALICE.id,
      at,
    ),
    ...overrides,
  };
}

describe("noteOuting", () => {
  it("starts a copy for the member with the outing and no blocks", () => {
    expect(noteOuting(null, ALICE, active(), NOW)).toEqual({
      v: 3,
      member: ALICE,
      savedAt: NOW,
      outing: active().session,
      blocks: [],
      revisits: null,
      threads: [],
    });
  });

  it("keeps the blocks opened on the same outing, and moves the age on", () => {
    const later = noteOuting(copyWithBlock(), ALICE, active(), NOW + 1_000);
    expect(later.blocks.map((b) => b.block.id)).toEqual([BLK_123]);
    expect(later.savedAt).toBe(NOW + 1_000);
  });

  it("drops a block opened earlier that is no longer on the outing", () => {
    const both = noteBlock(copyWithBlock(), ALICE, active(), BLK_456, [], NOW);
    const detached = noteOuting(both, ALICE, active(TONIGHT, [BLK_123]), NOW + 1_000);
    expect(detached.blocks.map((b) => b.block.id)).toEqual([BLK_123]);
  });

  it("forgets the blocks when another outing is running", () => {
    expect(noteOuting(copyWithBlock(), ALICE, active(LAST_WEEK), NOW).blocks).toEqual([]);
  });

  it("forgets the outing and its blocks when none is running", () => {
    const none = noteOuting(copyWithBlock(), ALICE, null, NOW);
    expect(none.outing).toBeNull();
    expect(none.blocks).toEqual([]);
  });

  it("never builds on another member's copy", () => {
    const ben = noteOuting(copyWithBlock(), BEN, active(), NOW);
    expect(ben.member).toEqual(BEN);
    expect(ben.blocks).toEqual([]);
  });

  it("takes the member's latest name", () => {
    const renamed = noteOuting(copyWithBlock(), { ...ALICE, name: "Alice Ng" }, active(), NOW);
    expect(renamed.member.name).toBe("Alice Ng");
    expect(renamed.blocks).toHaveLength(1);
  });
});

describe("noteRevisits", () => {
  it("keeps the follow-up list with the outing", () => {
    const copy = noteRevisits(copyWithBlock(), ALICE, active(), revisits(), NOW + 1);
    expect(copy.revisits).toEqual(revisits());
    expect(copy.blocks.map((b) => b.block.id)).toEqual([BLK_123]);
    expect(copy.savedAt).toBe(NOW + 1);
  });

  it("is kept while the same outing runs, and dropped for another", () => {
    const listed = noteRevisits(null, ALICE, active(), revisits(), NOW);
    expect(noteOuting(listed, ALICE, active(), NOW + 1).revisits).toEqual(revisits());
    expect(noteBlock(listed, ALICE, active(), BLK_456, [], NOW + 1)?.revisits).toEqual(revisits());
    expect(noteOuting(listed, ALICE, active(LAST_WEEK), NOW + 1).revisits).toBeNull();
    expect(noteOuting(listed, ALICE, null, NOW + 1).revisits).toBeNull();
  });

  it("is never taken from another member's copy", () => {
    const alices = noteRevisits(null, ALICE, active(), revisits(), NOW);
    expect(noteOuting(alices, BEN, active(), NOW).revisits).toBeNull();
  });
});

describe("noteBlock", () => {
  it("keeps the block and its units as the block screen got them", () => {
    const copy = copyWithBlock();
    expect(copy.outing?.id).toBe(TONIGHT);
    expect(copy.blocks).toEqual([
      { block: block(BLK_123, "123"), households: [household("#05-01")], savedAt: NOW },
    ]);
  });

  it("replaces a block opened again, in place, and adds a new one after it", () => {
    const again = noteBlock(copyWithBlock(), ALICE, active(), BLK_123, [], NOW + 1);
    const both = noteBlock(again, ALICE, active(), BLK_456, [], NOW + 2);
    expect(both?.blocks.map((b) => [b.block.name, b.households.length, b.savedAt])).toEqual([
      ["123", 0, NOW + 1],
      ["456", 0, NOW + 2],
    ]);
    const later = noteBlock(
      both,
      ALICE,
      active(),
      BLK_456,
      [household("#01-01", BLK_456)],
      NOW + 3,
    );
    expect(later?.blocks.map((b) => [b.block.name, b.households.length, b.savedAt])).toEqual([
      ["123", 0, NOW + 1],
      ["456", 1, NOW + 3],
    ]);
  });

  it("ignores a block that is not on the outing", () => {
    const copy = copyWithBlock();
    expect(noteBlock(copy, ALICE, active(TONIGHT, [BLK_456]), BLK_123, [], NOW + 1)).toBe(copy);
    expect(noteBlock(null, ALICE, active(TONIGHT, []), BLK_123, [], NOW)).toBeNull();
  });

  it("starts over when the block belongs to another outing", () => {
    const next = noteBlock(copyWithBlock(), ALICE, active(LAST_WEEK), BLK_456, [], NOW);
    expect(next?.outing?.id).toBe(LAST_WEEK);
    expect(next?.blocks.map((b) => b.block.id)).toEqual([BLK_456]);
  });
});

describe("readCopy", () => {
  it("reads back what was written", () => {
    const copy = noteRevisits(copyWithBlock(), ALICE, active(), revisits(), NOW);
    expect(readCopy(structuredClone(copy))).toEqual(copy);
  });

  it.each([
    ["nothing", undefined],
    ["a string", "Alice"],
    ["a copy of an unknown version", { ...copyWithBlock(), v: 4 }],
    ["no threads field", { ...copyWithBlock(), threads: undefined }],
    ["a bad thread", { ...copyWithBlock(), threads: [{ history: null, savedAt: NOW }] }],
    ["no follow-up list field", { ...copyWithBlock(), revisits: undefined }],
    ["a bad follow-up list", { ...copyWithBlock(), revisits: [{ household: null }] }],
    ["no member", { ...copyWithBlock(), member: null }],
    ["a blank name", { ...copyWithBlock(), member: { id: ALICE.id, name: "" } }],
    ["a bad outing", { ...copyWithBlock(), outing: { id: TONIGHT } }],
    [
      "a bad household",
      {
        ...copyWithBlock(),
        blocks: [{ block: block(BLK_123, "123"), households: [{ x: 1 }], savedAt: NOW }],
      },
    ],
  ])("rejects %s", (_, raw) => {
    expect(readCopy(raw)).toBeNull();
  });
});

/* As the build before follow-up sessions wrote it. */
function v1Copy(): unknown {
  const { revisits: _list, threads: _threads, outing, ...rest } = copyWithBlock();
  if (outing === null) throw new Error("expected an outing");
  const { kind: _kind, ...before } = outing;
  return { ...rest, v: 1, outing: before };
}

describe("readCopy, for a copy written before follow-up sessions", () => {
  it("reads it as a door-to-door session with no list, so the shell still opens", () => {
    expect(readCopy(v1Copy())).toEqual({ ...copyWithBlock(), revisits: null });
  });

  it("keeps a kind the server had already sent it", () => {
    const raw = { ...(v1Copy() as LocalCopy), outing: { ...active().session, kind: "follow_up" } };
    expect(readCopy(raw)?.outing?.kind).toBe("follow_up");
  });

  it("keeps a copy with no outing", () => {
    expect(readCopy({ ...(v1Copy() as LocalCopy), outing: null })).toMatchObject({
      v: 3,
      outing: null,
      revisits: null,
    });
  });

  it.each([
    ["a bad outing", { ...(v1Copy() as LocalCopy), outing: { id: TONIGHT } }],
    ["a blank name", { ...(v1Copy() as LocalCopy), member: { id: ALICE.id, name: "" } }],
  ])("still rejects %s", (_, raw) => {
    expect(readCopy(raw)).toBeNull();
  });
});

describe("replaceRevisits", () => {
  it("puts the list read again onto the copy of that outing, keeping its age", () => {
    const copy = copyWithBlock();
    expect(replaceRevisits(copy, TONIGHT, revisits(), NOW)).toEqual({
      ...copy,
      revisits: revisits(),
    });
  });

  it("leaves another outing's copy, or none, as it was", () => {
    const copy = copyWithBlock();
    expect(replaceRevisits(copy, LAST_WEEK, revisits(), NOW)).toBe(copy);
    expect(replaceRevisits(null, TONIGHT, revisits(), NOW)).toBeNull();
    const none = noteOuting(null, ALICE, null, NOW);
    expect(replaceRevisits(none, TONIGHT, revisits(), NOW)).toBe(none);
  });
});

describe("shellBlocks", () => {
  it("is the blocks opened, with no list read", () => {
    expect(shellBlocks(copyWithBlock())).toEqual(copyWithBlock().blocks);
  });

  it("is the list's blocks, a block never opened carrying its listed households alone", () => {
    // The list was read on the session screen; no block was opened.
    const [only] = shellBlocks(noteRevisits(null, ALICE, active(), revisits(), NOW));
    const [listed] = revisits();
    expect(only).toEqual({
      block: block(BLK_123, "123"),
      households: [
        {
          household: listed?.household,
          visitCount: 1,
          latestVisit: listed?.latestVisit,
          outstandingFollowUps: 1,
        },
      ],
      savedAt: null,
    });
  });

  it("counts no visit for a listed household never visited, and only its owed notes", () => {
    const [listed] = revisits();
    if (listed === undefined) throw new Error("expected an entry");
    const note = listed.notes[0];
    if (note === undefined) throw new Error("expected a note");
    const fresh = { ...listed, latestVisit: null, notes: [note, { ...note, doneAt: STAMP }] };
    const [only] = shellBlocks({ blocks: [], revisits: [fresh] });
    expect(only?.households.map((h) => [h.visitCount, h.outstandingFollowUps])).toEqual([[0, 1]]);
  });

  it("uses a block opened with signal whole, and leaves out one no longer on the list", () => {
    const opened = noteBlock(
      noteRevisits(null, ALICE, active(), revisits(), NOW),
      ALICE,
      active(),
      BLK_123,
      [household("#05-01"), household("#05-02")],
      NOW,
    );
    const both = noteBlock(opened, ALICE, active(), BLK_456, [household("#01-01", BLK_456)], NOW);
    if (both === null) throw new Error("expected a copy");
    expect(shellBlocks(both)).toEqual([both.blocks[0]]);
  });

  it("offers nothing for an empty list", () => {
    expect(shellBlocks({ ...copyWithBlock(), revisits: [] })).toEqual([]);
  });
});

describe("copyExpired", () => {
  it("counts twelve hours from the last write, exactly twelve still in date", () => {
    expect(copyExpired({ savedAt: NOW }, NOW)).toBe(false);
    expect(copyExpired({ savedAt: NOW }, NOW + LOCAL_COPY_TTL_MS)).toBe(false);
    expect(copyExpired({ savedAt: NOW }, NOW + LOCAL_COPY_TTL_MS + 1)).toBe(true);
  });
});

describe("usableCopy", () => {
  it("is the copy while it has an outing and a block", () => {
    const copy = copyWithBlock();
    expect(usableCopy(copy, NOW)).toEqual(copy);
  });

  it("is the copy with a follow-up list read and no block opened", () => {
    // The stairwell: the list was read on the session screen, then the signal went.
    const copy = noteRevisits(null, ALICE, active(), revisits(), NOW);
    expect(usableCopy(copy, NOW)).toEqual(copy);
  });

  it.each([
    ["no copy", null],
    ["no outing", noteOuting(copyWithBlock(), ALICE, null, NOW)],
    ["no block opened", noteOuting(null, ALICE, active(), NOW)],
    ["an empty follow-up list", noteRevisits(copyWithBlock(), ALICE, active(), [], NOW)],
  ])("is null with %s", (_, copy) => {
    expect(usableCopy(copy, NOW)).toBeNull();
  });

  it("lasts exactly twelve hours from the last write", () => {
    const copy = copyWithBlock();
    expect(usableCopy(copy, NOW + LOCAL_COPY_TTL_MS)).not.toBeNull();
    expect(usableCopy(copy, NOW + LOCAL_COPY_TTL_MS + 1)).toBeNull();
    expect(LOCAL_COPY_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe("offlineRows", () => {
  const [saved] = copyWithBlock().blocks;
  if (saved === undefined) throw new Error("expected a block");

  it("lays this phone's unsent records over the copied units", () => {
    const rows = offlineRows(
      saved,
      [queued("#05-01", NOW + 1), queued("#05-02", NOW + 2)],
      TONIGHT,
    );
    expect(rows.map((r) => [r.household.unitNumber, r.pending?.state, r.tonight])).toEqual([
      ["#05-01", "queued", true],
      ["#05-02", "queued", true],
    ]);
  });

  it("keeps a unit queued before the copy but sent after it, so it does not vanish", () => {
    const late = queued("#05-02", NOW - 1, { state: "synced", syncedAt: NOW + 1 });
    const rows = offlineRows(saved, [late], TONIGHT);
    expect(rows.map((r) => [r.household.unitNumber, r.pending?.state])).toEqual([
      ["#05-01", undefined],
      ["#05-02", "synced"],
    ]);
  });

  it("keeps a unit saved after the copy once it is sent, so it does not vanish", () => {
    const sent = queued("#05-02", NOW + 1, { state: "synced", syncedAt: NOW + 2 });
    const rows = offlineRows(saved, [sent], TONIGHT);
    expect(rows.map((r) => [r.household.unitNumber, r.pending?.state])).toEqual([
      ["#05-01", undefined],
      ["#05-02", "synced"],
    ]);
  });

  it("does not lay a record sent before the copy over it: the copy has it already", () => {
    const before = queued("#05-01", NOW - 1, { state: "synced", syncedAt: NOW - 1 });
    const rows = offlineRows(saved, [before], TONIGHT);
    expect(rows.map((r) => r.pending)).toEqual([null]);
  });

  it("does not lay a sent record with no send time over the copy", () => {
    const unknown = queued("#05-02", NOW + 1, { state: "synced", syncedAt: null });
    const rows = offlineRows(saved, [unknown], TONIGHT);
    expect(rows.map((r) => r.household.unitNumber)).toEqual(["#05-01"]);
  });

  it("lays every record sent in this session over a block known only from the list", () => {
    const [listedOnly] = shellBlocks(noteRevisits(null, ALICE, active(), revisits(), NOW));
    if (listedOnly === undefined) throw new Error("expected a block");
    const rows = offlineRows(
      listedOnly,
      [
        // Sent long before the list was read: its units were never read to hold it.
        queued("#05-01", NOW - 9, { state: "synced", syncedAt: NOW - 8 }),
        queued("#05-03", NOW - 9, { state: "synced", syncedAt: null }),
        // Another session's, from last week.
        {
          ...queued("#05-04", NOW - 9, { state: "synced", syncedAt: NOW - 8 }),
          item: { ...queued("#05-04", NOW - 9).item, sessionId: LAST_WEEK },
        },
      ],
      TONIGHT,
    );
    expect(rows.map((r) => [r.household.unitNumber, r.pending?.state])).toEqual([
      ["#05-01", "synced"],
      ["#05-03", "synced"],
    ]);
  });
});

/* The list's household, read as a thread. */
function history(unit = household("#05-01")): HouseholdHistory {
  return {
    household: unit.household,
    block: block(unit.household.blockId, "123"),
    visits: unit.latestVisit === null ? [] : [unit.latestVisit],
    answered: true,
    pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
    followUps: [],
  };
}

function must<T>(value: T | null): T {
  if (value === null) throw new Error("expected a value");
  return value;
}

function listedCopy(): LocalCopy {
  return noteRevisits(copyWithBlock(), ALICE, active(), revisits(), NOW);
}

describe("readCopy, for a copy written before threads", () => {
  it("reads a v2 copy as one with no threads", () => {
    const { threads: _threads, ...rest } = listedCopy();
    const read = readCopy({ ...rest, v: 2 });
    expect(read).toEqual(listedCopy());
    expect(read?.threads).toEqual([]);
  });
});

describe("readCopy, with threads", () => {
  it("reads back a copy that holds a thread", () => {
    const copy = must(noteThreads(listedCopy(), TONIGHT, [history()], NOW));
    expect(readCopy(structuredClone(copy))).toEqual(copy);
  });
});

describe("liveThreads and withThreads", () => {
  it("keeps a thread through exactly 12 hours from its own read, not a moment more", () => {
    const thread = { history: history(), savedAt: NOW };
    expect(liveThreads([thread], NOW + LOCAL_COPY_TTL_MS)).toEqual([thread]);
    expect(liveThreads([thread], NOW + LOCAL_COPY_TTL_MS + 1)).toEqual([]);
  });

  it("replaces the older thread of a household and keeps the others", () => {
    const other = household("#05-02");
    const kept = { history: history(other), savedAt: NOW };
    const next = withThreads([{ history: history(), savedAt: NOW }, kept], [history()], NOW + 5);
    expect(next).toEqual([kept, { history: history(), savedAt: NOW + 5 }]);
  });
});

describe("noteThreads", () => {
  it("stores a listed household's thread without moving the copy's age", () => {
    const copy = listedCopy();
    const next = noteThreads(copy, TONIGHT, [history()], NOW + 1000);
    expect(next?.threads).toEqual([{ history: history(), savedAt: NOW + 1000 }]);
    expect(next?.savedAt).toBe(copy.savedAt);
  });

  it("ignores a household that is not on the list", () => {
    const copy = listedCopy();
    expect(noteThreads(copy, TONIGHT, [history(household("#09-09"))], NOW)).toBe(copy);
  });

  it("writes only onto the copy of that outing, and never makes one", () => {
    const copy = listedCopy();
    expect(noteThreads(copy, LAST_WEEK, [history()], NOW)).toBe(copy);
    expect(noteThreads(null, TONIGHT, [history()], NOW)).toBeNull();
    const unlisted = copyWithBlock();
    expect(noteThreads(unlisted, TONIGHT, [history()], NOW)).toBe(unlisted);
  });

  it("writes nothing when nothing changes", () => {
    const copy = listedCopy();
    expect(noteThreads(copy, TONIGHT, [], NOW)).toBe(copy);
  });

  it("drops a thread that has expired as it writes", () => {
    const copy = noteThreads(listedCopy(), TONIGHT, [history()], NOW);
    const later = NOW + LOCAL_COPY_TTL_MS + 1;
    expect(noteThreads(copy, TONIGHT, [], later)?.threads).toEqual([]);
  });
});

describe("threads follow the list", () => {
  const withThread = () => must(noteThreads(listedCopy(), TONIGHT, [history()], NOW));

  it("are dropped when a list read no longer names the household", () => {
    const next = noteRevisits(withThread(), ALICE, active(), [], NOW + 1);
    expect(next.threads).toEqual([]);
    expect(replaceRevisits(withThread(), TONIGHT, [], NOW + 1)?.threads).toEqual([]);
  });

  it("stay while the list names the household, and are dropped once expired", () => {
    expect(noteRevisits(withThread(), ALICE, active(), revisits(), NOW + 1).threads).toHaveLength(
      1,
    );
    const later = NOW + LOCAL_COPY_TTL_MS + 1;
    expect(replaceRevisits(withThread(), TONIGHT, revisits(), later)?.threads).toEqual([]);
  });

  it("stay for the same outing and are dropped for another, or another member", () => {
    expect(noteOuting(withThread(), ALICE, active(), NOW + 1).threads).toHaveLength(1);
    expect(noteOuting(withThread(), ALICE, active(LAST_WEEK), NOW + 1).threads).toEqual([]);
    expect(noteOuting(withThread(), BEN, active(), NOW + 1).threads).toEqual([]);
  });
});
