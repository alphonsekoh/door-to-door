import type { Block, RevisitEntry } from "@/generated/types.gen";
import type { QueuedVisit } from "@/lib/sync/types";
import { normaliseUnitNumber } from "@/lib/units/unit-number";

/*
 * A follow-up session's list of households, shaped for the session screen
 * and for the recording form's check of where a member may record.
 */

export type BlockGroup<T = RevisitEntry> = { block: Block; entries: T[] };

/* Relies on the server's order, by block then unit, which keeps a block's
   entries together. */
export function groupByBlock<T extends { block: Block }>(entries: readonly T[]): BlockGroup<T>[] {
  const groups: BlockGroup<T>[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.block.id === entry.block.id) last.entries.push(entry);
    else groups.push({ block: entry.block, entries: [entry] });
  }
  return groups;
}

export type RevisitState = "to_visit" | "visited" | "done";

export function revisitState(
  entry: Pick<RevisitEntry, "notes" | "visitedInSession">,
): RevisitState {
  if (entry.notes.every((note) => note.doneAt !== null)) return "done";
  return entry.visitedInSession ? "visited" : "to_visit";
}

/*
 * On the offline shell, a household this phone holds a record for in this
 * session, sent or not, reads visited: the list was read before it was.
 */
export function stateOnPhone(
  entry: RevisitEntry,
  records: readonly QueuedVisit[],
  sessionId: string,
): RevisitState {
  const state = revisitState(entry);
  if (state !== "to_visit") return state;
  const recorded = records.some(
    (record) =>
      record.item.sessionId === sessionId &&
      record.item.blockId === entry.block.id &&
      normaliseUnitNumber(record.item.unitNumber) === entry.household.unitNumber,
  );
  return recorded ? "visited" : "to_visit";
}

/* Counted as the rows are labelled: a household marked done without a
   knock reads Done, not Visited, and counts as dealt with. */
export function progress(
  entries: readonly RevisitEntry[],
  stateOf: (entry: RevisitEntry) => RevisitState = revisitState,
): string {
  const dealt = entries.filter((entry) => stateOf(entry) !== "to_visit").length;
  return `${String(dealt)} of ${String(entries.length)} visited or done`;
}

export type ListedUnit = { householdId: string; unitNumber: string; state: RevisitState };

export function listedUnitsIn(entries: readonly RevisitEntry[], blockId: string): ListedUnit[] {
  return entries
    .filter((entry) => entry.block.id === blockId)
    .map((entry) => ({
      householdId: entry.household.id,
      unitNumber: entry.household.unitNumber,
      state: revisitState(entry),
    }));
}

/*
 * Whether the typed unit is on a follow-up session's list as last read. Any
 * unit in the session's blocks may be recorded, so `off_list` only says it
 * will be a one-off visit that marks nothing. An unread or failed list says
 * `ok`: there is nothing to warn about yet.
 */
export type UnitGate = "ok" | "off_list";

export function unitGate(
  unit: string,
  blockId: string,
  revisits: readonly RevisitEntry[] | null | undefined,
): UnitGate {
  const typed = normaliseUnitNumber(unit);
  if (typed === "" || revisits == null) return "ok";
  const listed = revisits.some(
    (entry) => entry.block.id === blockId && entry.household.unitNumber === typed,
  );
  return listed ? "ok" : "off_list";
}

const OFF_LIST = "not_on_follow_up_list";

/*
 * Changes whenever the server holds one of this phone's records because its
 * unit is not on the follow-up list, and when one leaves that state. The
 * server knew something the list on screen did not, so it is read again.
 */
export function heldOffListKey(records: readonly QueuedVisit[]): string {
  return records
    .filter((record) => record.state === "held" && record.lastError?.code === OFF_LIST)
    .map((record) => record.id)
    .join(" ");
}
