import type { Block, RevisitEntry } from "@/generated/types.gen";
import { normaliseUnitNumber } from "@/lib/units/unit-number";

/*
 * A follow-up session's list of households, shaped for the session screen
 * and for the recording form's check of where a member may record.
 */

export type BlockGroup = { block: Block; entries: RevisitEntry[] };

/* In the server's order: by block, then unit. */
export function groupByBlock(entries: readonly RevisitEntry[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.block.id === entry.block.id) last.entries.push(entry);
    else groups.push({ block: entry.block, entries: [entry] });
  }
  return groups;
}

export type RevisitState = "to_visit" | "visited" | "done";

/* Done once every note that put it on the list is resolved. */
export function revisitState(
  entry: Pick<RevisitEntry, "notes" | "visitedInSession">,
): RevisitState {
  if (entry.notes.every((note) => note.doneAt !== null)) return "done";
  return entry.visitedInSession ? "visited" : "to_visit";
}

export function progress(entries: readonly RevisitEntry[]): string {
  const visited = entries.filter((entry) => revisitState(entry) !== "to_visit").length;
  return `${String(visited)} of ${String(entries.length)} visited`;
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
 * Whether the typed unit may be recorded in a follow-up session. `unknown`
 * when the list could not be read (offline with no copy): the record is then
 * queued, and held by the server if the unit is not listed. An admin is
 * never refused, but is told the unit is off the list.
 */
export type UnitGate = "ok" | "unlisted" | "admin_override" | "unknown";

export function unitGate(
  unit: string,
  blockId: string,
  revisits: readonly RevisitEntry[] | null,
  isAdmin: boolean,
): UnitGate {
  const typed = normaliseUnitNumber(unit);
  if (typed === "") return "ok";
  if (revisits === null) return isAdmin ? "ok" : "unknown";
  const listed = revisits.some(
    (entry) => entry.block.id === blockId && entry.household.unitNumber === typed,
  );
  if (listed) return "ok";
  return isAdmin ? "admin_override" : "unlisted";
}
