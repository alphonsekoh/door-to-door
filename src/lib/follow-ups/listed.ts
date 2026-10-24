import type { FollowUp } from "@/generated/types.gen";
import { loadAllFollowUps } from "@/lib/follow-ups/pages";

/*
 * Every note still owed on the follow-up list, so a block with listed
 * households is never missed because it fell on the second page.
 */
export async function loadAllListed(pageSize = 100): Promise<FollowUp[]> {
  return loadAllFollowUps({ status: "listed", outstanding: "true" }, pageSize);
}

export type ListedHousehold = {
  householdId: string;
  blockName: string;
  unitNumber: string;
  notes: FollowUp[];
};

/*
 * The follow-up list by household, as a session picks it and counts it: a
 * household with two listed notes is one entry. Households keep the order
 * of their first note, soonest due; notes keep the server's order within.
 */
export function groupListedByHousehold(notes: readonly FollowUp[]): ListedHousehold[] {
  const households = new Map<string, ListedHousehold>();
  for (const note of notes) {
    const household = households.get(note.householdId);
    if (household === undefined) {
      households.set(note.householdId, {
        householdId: note.householdId,
        blockName: note.blockName,
        unitNumber: note.unitNumber,
        notes: [note],
      });
    } else {
      household.notes.push(note);
    }
  }
  return [...households.values()];
}
