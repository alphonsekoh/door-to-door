import type { Household } from "@/generated/types.gen";

/*
 * The one search an admin meets on All records, Records and Needs a return
 * visit. It runs over rows already loaded and is never sent (D-30-6,
 * D-129-7): the term is a name or a phone number. The unit is matched as
 * typed and without its punctuation, so "0512" finds "#05-12".
 */
export function matchesHouseholdSearch(
  household: Pick<Household, "unitNumber" | "name" | "contact">,
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  const { unitNumber, name, contact } = household;
  return [unitNumber, unitNumber.replace(/[#-]/g, ""), name ?? "", contact ?? ""].some((value) =>
    value.toLowerCase().includes(needle),
  );
}
