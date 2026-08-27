import type { HouseholdSummary } from "@/generated/types.gen";
import { parseUnitNumber } from "@/lib/unit-number";

/*
 * Shaping a block's units for the corridor.
 *
 * A member standing on floor 5 wants floor 5, in order, and wants to find
 * #05-123 by typing part of it. All of that is arithmetic over a list, so it
 * lives here where it is cheap to test rather than inside the component.
 */

/* Units whose numbering this app does not recognise - "Penthouse", "05/123".
   The leading space keeps the key out of the numeric floor namespace. */
const UNPARSED = " other";

export type Floor = { key: string; label: string; units: HouseholdSummary[] };

export type Progress = { units: number; floors: number; answered: number };

/*
 * Numeric, not lexical: #05-9 comes before #05-10, which string ordering gets
 * backwards. Only ever called within a floor group, so the two sides either
 * both parse or both do not.
 */
export function compareUnits(a: string, b: string): number {
  const left = parseUnitNumber(a);
  const right = parseUnitNumber(b);
  if (!left || !right) {
    return a.localeCompare(b);
  }
  return Number(left.floor) - Number(right.floor) || Number(left.unit) - Number(right.unit);
}

function floorOrder(key: string): number {
  return key === UNPARSED ? Number.MAX_SAFE_INTEGER : Number(key);
}

export function groupByFloor(units: HouseholdSummary[]): Floor[] {
  const buckets = new Map<string, HouseholdSummary[]>();

  for (const entry of units) {
    const key = parseUnitNumber(entry.household.unitNumber)?.floor ?? UNPARSED;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(key, [entry]);
    }
  }

  return [...buckets.entries()]
    .map(([key, list]) => ({
      key,
      label: key === UNPARSED ? "Other units" : `Floor ${String(Number(key))}`,
      units: [...list].sort((a, b) => compareUnits(a.household.unitNumber, b.household.unitNumber)),
    }))
    .sort((a, b) => floorOrder(a.key) - floorOrder(b.key));
}

/*
 * Matches the unit number with its punctuation stripped as well, so "05123"
 * finds "#05-123" - typing # and - on a phone keyboard costs two layout
 * switches.
 */
export function matchesQuery(entry: HouseholdSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  const { unitNumber, name, contact } = entry.household;
  return [unitNumber, unitNumber.replace(/[#-]/g, ""), name ?? "", contact ?? ""].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

export function filterUnits(units: HouseholdSummary[], query: string): HouseholdSummary[] {
  return units.filter((entry) => matchesQuery(entry, query));
}

/*
 * "Answered" counts doors where someone actually came to it. A block of
 * no-responses is a full evening's work and should read as covered, so units
 * and answered are reported separately rather than as one percentage.
 */
export function summariseProgress(units: HouseholdSummary[]): Progress {
  const floors = new Set<string>();
  let answered = 0;

  for (const entry of units) {
    floors.add(parseUnitNumber(entry.household.unitNumber)?.floor ?? entry.household.unitNumber);
    if (entry.latestVisit !== null && entry.latestVisit.interestLevel !== "no_response") {
      answered += 1;
    }
  }

  return { units: units.length, floors: floors.size, answered };
}

/*
 * Built here rather than as JSX so the pluralisation is covered properly, and
 * so the whole line reads as one phrase to a screen reader.
 *
 * It names its scope because the tab beside it counts every unit ever recorded
 * on the block. Two bare numbers on one screen read as a contradiction.
 */
export function progressLabel(progress: Progress, scope: string): string {
  const units = `${String(progress.units)} ${progress.units === 1 ? "unit" : "units"}`;
  const floors = `${String(progress.floors)} ${progress.floors === 1 ? "floor" : "floors"}`;
  return `${scope}: ${units} on ${floors}, ${String(progress.answered)} answered`;
}
