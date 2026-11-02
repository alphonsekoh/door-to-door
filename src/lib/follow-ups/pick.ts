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

/* The contract's cap on the households one request may pick. */
export const MAX_PICK = 200;

/*
 * Why Create draft cannot be pressed yet, said beside it, or null when it
 * can. A door-to-door session needs no households. Everything on the list
 * starts ticked, so a long list can start over the cap.
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
  // The Follow-up card above already says to add households first.
  if (available === 0) return "Nothing on the follow-up list yet.";
  if (ticked === 0) return "Tick at least one household to visit.";
  if (ticked > MAX_PICK) {
    return `Tick ${String(MAX_PICK)} households or fewer. You can add more once it is created.`;
  }
  return null;
}

/* Why Add households cannot be pressed yet, or null when it can. */
export function addBlocker(ticked: number): string | null {
  if (ticked === 0) return "Tick the households to add.";
  if (ticked > MAX_PICK) return `Tick ${String(MAX_PICK)} households or fewer at a time.`;
  return null;
}
