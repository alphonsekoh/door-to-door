import { z } from "zod";
import type {
  ActiveSession,
  Block,
  HouseholdHistory,
  HouseholdSummary,
  OutingSession,
  RevisitEntry,
} from "@/generated/types.gen";
import {
  zBlock,
  zHouseholdHistory,
  zHouseholdSummary,
  zOutingSession,
  zRevisitEntry,
} from "@/generated/zod.gen";
import { groupByBlock } from "@/lib/follow-ups/revisits";
import type { QueuedVisit } from "@/lib/sync/types";
import { type UnitRow, overlayQueued } from "@/lib/sync/unit-overlay";

/*
 * What the offline shell (#77) records with when a reload finds no signal:
 * the last signed-in member, their outing, and the blocks they opened, as
 * the online screens received them. A cache, not a record: anything that
 * fails to read is thrown away, unlike a queued visit (D-33-8).
 */

/* An evening's outing, and inside the 24 h a sent record is kept (D-33-9),
   so a unit sent from the shell is still there to list. */
export const LOCAL_COPY_TTL_MS = 12 * 60 * 60 * 1000;

export type LocalMember = { id: string; name: string };

export type LocalBlock = { block: Block; households: HouseholdSummary[]; savedAt: number };

/* A listed unit's history as last read with signal (#275). Each expires 12 h
   after its own read, not the copy's last write: reading the list again
   must not keep a stale thread, and a person's notes, alive. */
export type LocalThread = { history: HouseholdHistory; savedAt: number };

/*
 * v2 adds a follow-up session's list, so the shell can tell a member which
 * units they may record; v3 the histories of the households on it. An older
 * copy is read as a v3 one with no list or no threads, so a member offline
 * when this ships can still open the session they saved.
 */
export type LocalCopy = {
  v: 3;
  member: LocalMember;
  /* The last write, which is what the copy's age is measured from. */
  savedAt: number;
  outing: OutingSession | null;
  blocks: LocalBlock[];
  /* The outing's follow-up list as last read; null when none was read. */
  revisits: RevisitEntry[] | null;
  /* Only for households on `revisits`. */
  threads: LocalThread[];
};

export type UsableCopy = LocalCopy & { outing: OutingSession };

const zLocalCopy = z.object({
  v: z.literal(3),
  member: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  savedAt: z.number(),
  outing: zOutingSession.nullable(),
  blocks: z.array(
    z.object({ block: zBlock, households: z.array(zHouseholdSummary), savedAt: z.number() }),
  ),
  revisits: z.array(zRevisitEntry).nullable(),
  threads: z.array(z.object({ history: zHouseholdHistory, savedAt: z.number() })),
});

/* As the build before threads wrote it. */
const zLocalCopyV2 = zLocalCopy.omit({ threads: true }).extend({ v: z.literal(2) });

type LocalCopyV2 = Omit<LocalCopy, "v" | "threads"> & { v: 2 };

/* As the build before session kinds wrote it. Its outing has a kind only
   when the server it read was already newer than it. */
const zLocalCopyV1 = zLocalCopyV2.omit({ v: true, revisits: true, outing: true }).extend({
  v: z.literal(1),
  outing: zOutingSession.partial({ kind: true }).nullable(),
});

type LocalCopyV1 = Omit<LocalCopy, "v" | "revisits" | "outing" | "threads"> & {
  v: 1;
  outing: (Omit<OutingSession, "kind"> & Partial<Pick<OutingSession, "kind">>) | null;
};

export function readCopy(raw: unknown): LocalCopy | null {
  /* The value as stored, not zod's copy, whose optional fields do not fit
     the contract's types under exactOptionalPropertyTypes. */
  if (zLocalCopy.safeParse(raw).success) return raw as LocalCopy;
  if (zLocalCopyV2.safeParse(raw).success) return { ...(raw as LocalCopyV2), v: 3, threads: [] };
  if (!zLocalCopyV1.safeParse(raw).success) return null;
  const old = raw as LocalCopyV1;
  /* Every session before kinds existed was door-to-door. */
  const outing = old.outing === null ? null : { ...old.outing, kind: old.outing.kind ?? "regular" };
  return { ...old, v: 3, outing, revisits: null, threads: [] };
}

/* Past its 12 hours from its own read; exactly 12 h is still kept (D-77-5). */
export function liveThreads(threads: readonly LocalThread[], now: number): LocalThread[] {
  return threads.filter((thread) => now - thread.savedAt <= LOCAL_COPY_TTL_MS);
}

/* Households no longer on the list have no thread to keep. */
function threadsOnList(
  threads: readonly LocalThread[],
  revisits: readonly RevisitEntry[],
  now: number,
): LocalThread[] {
  const listed = new Set(revisits.map((entry) => entry.household.id));
  return liveThreads(threads, now).filter((thread) => listed.has(thread.history.household.id));
}

/* Histories as threads read at `now`, each replacing the older one for its household. */
export function withThreads(
  threads: readonly LocalThread[],
  histories: readonly HouseholdHistory[],
  now: number,
): LocalThread[] {
  const replaced = new Set(histories.map((history) => history.household.id));
  return [
    ...threads.filter((thread) => !replaced.has(thread.history.household.id)),
    ...histories.map((history) => ({ history, savedAt: now })),
  ];
}

/* Another member's copy is never built on: theirs is replaced, not merged. */
function ownedBy(copy: LocalCopy | null, member: LocalMember): LocalCopy | null {
  return copy !== null && copy.member.id === member.id ? copy : null;
}

/* The outing screen's answer. Null is the server's 404: nothing is running,
   so there is nothing to record into. */
export function noteOuting(
  copy: LocalCopy | null,
  member: LocalMember,
  active: ActiveSession | null,
  now: number,
): LocalCopy {
  const base = ownedBy(copy, member);
  const outing = active?.session ?? null;
  /* Blocks opened tonight means this outing's: another outing starts empty,
     and a block detached since it was opened is dropped, or the shell would
     record units the server refuses. */
  const same = active !== null && base !== null && base.outing?.id === active.session.id;
  const blocks = same
    ? base.blocks.filter((b) => active.blocks.some((e) => e.block.id === b.block.id))
    : [];
  /* Another outing's list, and the threads on it, say nothing about this one's. */
  return {
    v: 3,
    member,
    savedAt: now,
    outing,
    blocks,
    revisits: same ? base.revisits : null,
    threads: same ? base.threads : [],
  };
}

/* A follow-up session's list, as the session or block screen read it. */
export function noteRevisits(
  copy: LocalCopy | null,
  member: LocalMember,
  active: ActiveSession,
  revisits: RevisitEntry[],
  now: number,
): LocalCopy {
  const base = noteOuting(copy, member, active, now);
  return { ...base, revisits, threads: threadsOnList(base.threads, revisits, now) };
}

/*
 * The list as the offline shell read it again once the server answered. Only
 * onto the copy it was read for: the shell knows no other outing.
 */
export function replaceRevisits(
  copy: LocalCopy | null,
  outingId: string,
  revisits: RevisitEntry[],
  now: number,
): LocalCopy | null {
  if (copy?.outing?.id !== outingId) return copy;
  return { ...copy, revisits, threads: threadsOnList(copy.threads, revisits, now) };
}

/*
 * Units' histories read with signal. Only onto the copy of the outing they
 * were read for, and only for households on its list: it never makes a copy,
 * and never moves the copy's own age, which is the member's session, not the
 * threads'. The same copy back when nothing changes, so nothing is written.
 */
export function noteThreads(
  copy: LocalCopy | null,
  outingId: string,
  histories: readonly HouseholdHistory[],
  now: number,
): LocalCopy | null {
  if (copy?.outing?.id !== outingId || copy.revisits === null) return copy;
  const listed = new Set(copy.revisits.map((entry) => entry.household.id));
  const fresh = histories.filter((history) => listed.has(history.household.id));
  const live = liveThreads(copy.threads, now);
  if (fresh.length === 0 && live.length === copy.threads.length) return copy;
  return { ...copy, threads: withThreads(live, fresh, now) };
}

/*
 * A block screen's units. Notes the outing as well, so a block opened
 * straight from a link (a sign-in's callback, say) is kept even when the
 * outing screen was never opened. A block that is not on the outing is
 * ignored: it is not one the member can record on tonight.
 */
export function noteBlock(
  copy: LocalCopy | null,
  member: LocalMember,
  active: ActiveSession,
  blockId: string,
  households: HouseholdSummary[],
  now: number,
): LocalCopy | null {
  const entry = active.blocks.find((candidate) => candidate.block.id === blockId);
  if (entry === undefined) return copy;
  const base = noteOuting(copy, member, active, now);
  const saved: LocalBlock = { block: entry.block, households, savedAt: now };
  const known = base.blocks.some((b) => b.block.id === blockId);
  return {
    ...base,
    blocks: known
      ? base.blocks.map((b) => (b.block.id === blockId ? saved : b))
      : [...base.blocks, saved],
  };
}

/*
 * A block the shell can open: as a block screen saved it, or, for a block
 * on a follow-up session's list that was never opened with signal, only its
 * households on the list, taken from the list (`savedAt` null, as its units
 * were never read). Those are the only units a member may record there.
 */
export type ShellBlock = { block: Block; households: HouseholdSummary[]; savedAt: number | null };

export type ShellGroup = { block: ShellBlock; entries: RevisitEntry[] };

/*
 * A follow-up session's list as the shell offers it: each of its blocks, in
 * its order, with its households, whether or not the block was opened. The
 * list is what a member taps to get to one.
 */
export function shellList(blocks: readonly LocalBlock[], revisits: RevisitEntry[]): ShellGroup[] {
  return groupByBlock(revisits).map((group) => ({
    block: blocks.find((saved) => saved.block.id === group.block.id) ?? {
      block: group.block,
      households: group.entries.map(listedSummary),
      savedAt: null,
    },
    entries: group.entries,
  }));
}

/*
 * The blocks the shell offers: those opened, or, with a follow-up session's
 * list saved, the list's alone, since a block saved but no longer on the
 * list would refuse every unit.
 */
export function shellBlocks(copy: Pick<LocalCopy, "blocks" | "revisits">): ShellBlock[] {
  if (copy.revisits === null) return copy.blocks;
  return shellList(copy.blocks, copy.revisits).map((group) => group.block);
}

/* A household on the list, shaped as a block's units are. The list has no
   visit count, and nothing on the shell reads one: at least one once a
   visit is known. */
function listedSummary(entry: RevisitEntry): HouseholdSummary {
  return {
    household: entry.household,
    visitCount: entry.latestVisit === null ? 0 : 1,
    latestVisit: entry.latestVisit,
    outstandingFollowUps: entry.notes.filter((note) => note.doneAt === null).length,
  };
}

/* Past its 12 hours from the last write; exactly 12 h is still usable (D-77-5). */
export function copyExpired(copy: Pick<LocalCopy, "savedAt">, now: number): boolean {
  return now - copy.savedAt > LOCAL_COPY_TTL_MS;
}

/* Null when there is nothing the shell can record with. */
export function usableCopy(copy: LocalCopy | null, now: number): UsableCopy | null {
  if (copy === null) return null;
  const { outing } = copy;
  if (outing === null || shellBlocks(copy).length === 0) return null;
  return copyExpired(copy, now) ? null : { ...copy, outing };
}

/*
 * The shell's unit list. The copy cannot be refetched offline, so a unit
 * saved from the shell would vanish from the list once sent, the overlay
 * only laying unsent records over the server's rows. Records sent after
 * the copy was taken stay listed, and say so (D-77-13). Sent, not queued:
 * a record queued before a re-read but sent after it is not in that copy.
 * A block known only from the list was never read whole, so every record
 * this phone sent in this session stays laid over it.
 */
export function offlineRows(
  block: ShellBlock,
  records: readonly QueuedVisit[],
  sessionId: string | null,
): UnitRow[] {
  const { savedAt } = block;
  return overlayQueued(
    block.households,
    records,
    block.block.id,
    sessionId,
    (record) =>
      record.state !== "synced" ||
      (savedAt === null ? record.item.sessionId === sessionId : (record.syncedAt ?? 0) > savedAt),
  );
}
