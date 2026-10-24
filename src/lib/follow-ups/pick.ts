import type { FollowUp, SessionKind } from "@/generated/types.gen";

/*
 * Picking which households on the follow-up list a follow-up session goes
 * back to: grouped as members will meet them, by block and then unit.
 */

export type PickHousehold = {
  householdId: string;
  unitNumber: string;
  /* Its first note on the list, soonest due, as the server orders them. */
  first: FollowUp;
  notes: number;
};

export type PickGroup = { blockId: string; blockName: string; households: PickHousehold[] };

export function groupForPicking(notes: readonly FollowUp[]): PickGroup[] {
  const groups = new Map<string, PickGroup>();
  for (const note of notes) {
    const group = groups.get(note.blockId) ?? {
      blockId: note.blockId,
      blockName: note.blockName,
      households: [],
    };
    const household = group.households.find((entry) => entry.householdId === note.householdId);
    if (household === undefined) {
      group.households.push({
        householdId: note.householdId,
        unitNumber: note.unitNumber,
        first: note,
        notes: 1,
      });
    } else {
      household.notes += 1;
    }
    groups.set(note.blockId, group);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      households: group.households.sort((a, b) => byName(a.unitNumber, b.unitNumber)),
    }))
    .sort((a, b) => byName(a.blockName, b.blockName));
}

export function householdIdsOf(groups: readonly PickGroup[]): string[] {
  return groups.flatMap((group) => group.households.map((household) => household.householdId));
}

export function pickSummary(ticked: number, total: number): string {
  return `${String(ticked)} of ${String(total)} ${total === 1 ? "household" : "households"} ticked`;
}

/* The first note says what the visit is for; the rest are counted. */
export function moreNotes(household: PickHousehold): string | null {
  const more = household.notes - 1;
  return more > 0 ? `+${String(more)} more` : null;
}

export type ListLoad = "loading" | "error" | "ready";

/*
 * Why Create draft cannot be pressed yet, said beside it, or null when it
 * can. A door-to-door session needs no households.
 */
export function createBlocker(
  kind: SessionKind,
  load: ListLoad,
  available: number,
  ticked: number,
): string | null {
  if (kind === "regular") return null;
  if (load === "loading") return "Loading the follow-up list…";
  if (load === "error") return "Could not load the follow-up list.";
  if (available === 0) return "Add households to the follow-up list first.";
  if (ticked === 0) return "Tick at least one household to visit.";
  return null;
}
