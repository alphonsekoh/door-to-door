import { z } from "zod";
import type { ActiveSession, Block, HouseholdSummary, OutingSession } from "@/generated/types.gen";
import { zBlock, zHouseholdSummary, zOutingSession } from "@/generated/zod.gen";
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

export type LocalCopy = {
  v: 1;
  member: LocalMember;
  /* The last write, which is what the copy's age is measured from. */
  savedAt: number;
  outing: OutingSession | null;
  blocks: LocalBlock[];
};

export type UsableCopy = LocalCopy & { outing: OutingSession };

const zLocalCopy = z.object({
  v: z.literal(1),
  member: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  savedAt: z.number(),
  outing: zOutingSession.nullable(),
  blocks: z.array(
    z.object({ block: zBlock, households: z.array(zHouseholdSummary), savedAt: z.number() }),
  ),
});

export function readCopy(raw: unknown): LocalCopy | null {
  /* The value as stored, not zod's copy, whose optional fields do not fit
     the contract's types under exactOptionalPropertyTypes. */
  return zLocalCopy.safeParse(raw).success ? (raw as LocalCopy) : null;
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
  /* Blocks opened tonight means this outing's: another outing starts empty. */
  const blocks =
    base !== null && outing !== null && base.outing?.id === outing.id ? base.blocks : [];
  return { v: 1, member, savedAt: now, outing, blocks };
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

/* Null when there is nothing the shell can record with. */
export function usableCopy(copy: LocalCopy | null, now: number): UsableCopy | null {
  if (copy === null) return null;
  const { outing } = copy;
  if (outing === null || copy.blocks.length === 0) return null;
  return now - copy.savedAt > LOCAL_COPY_TTL_MS ? null : { ...copy, outing };
}

/*
 * The shell's unit list. The copy cannot be refetched offline, so a unit
 * saved from the shell would vanish from the list once sent, the overlay
 * only laying unsent records over the server's rows. Records sent after
 * the copy was taken stay listed, and say so (D-77-13). Sent, not queued:
 * a record queued before a re-read but sent after it is not in that copy.
 */
export function offlineRows(
  block: LocalBlock,
  records: readonly QueuedVisit[],
  sessionId: string | null,
): UnitRow[] {
  return overlayQueued(
    block.households,
    records,
    block.block.id,
    sessionId,
    (record) => record.state !== "synced" || (record.syncedAt ?? 0) > block.savedAt,
  );
}
