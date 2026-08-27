import type { HistoryEntry, InterestLevel, Religion } from "@/generated/types.gen";

/*
 * Filters for the admin's long-term history view, held in the URL.
 *
 * Kept apart from record-filters, which covers the running outing: that one is
 * always scoped to one session and offers a narrower set. Merging them would
 * mean a shape where half the fields are meaningless on either screen.
 */

export type HistoryFilters = {
  blockId: string;
  sessionId: string;
  memberId: string;
  interestLevel: InterestLevel | "";
  religion: Religion | "";
  from: string;
  to: string;
  q: string;
};

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  blockId: "",
  sessionId: "",
  memberId: "",
  interestLevel: "",
  religion: "",
  from: "",
  to: "",
  q: "",
};

const LEVELS: InterestLevel[] = ["low", "medium", "high", "no_response"];
const RELIGIONS: Religion[] = ["buddhist", "christian", "hindu", "freethinker", "others"];

/* A date input gives YYYY-MM-DD; anything else in the URL is discarded. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function asDate(value: string | null): string {
  return value !== null && DATE.test(value) ? value : "";
}

export function parseHistoryFilters(params: URLSearchParams): HistoryFilters {
  return {
    blockId: params.get("blockId") ?? "",
    sessionId: params.get("sessionId") ?? "",
    memberId: params.get("memberId") ?? "",
    interestLevel: LEVELS.find((level) => level === params.get("interestLevel")) ?? "",
    religion: RELIGIONS.find((religion) => religion === params.get("religion")) ?? "",
    from: asDate(params.get("from")),
    to: asDate(params.get("to")),
    q: params.get("q") ?? "",
  };
}

export function toHistorySearch(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  for (const key of [
    "blockId",
    "sessionId",
    "memberId",
    "interestLevel",
    "religion",
    "from",
    "to",
  ] as const) {
    if (filters[key] !== "") params.set(key, filters[key]);
  }
  if (filters.q.trim() !== "") params.set("q", filters.q.trim());
  return params.toString();
}

/*
 * The API takes instants; the inputs give days. `to` is pushed to the end of
 * its day, or a range of one day would match nothing recorded after midnight.
 */
export function toHistoryRequest(
  filters: HistoryFilters,
  page: { limit: number; offset: number },
): string {
  const params = new URLSearchParams({
    limit: String(page.limit),
    offset: String(page.offset),
  });
  for (const key of ["blockId", "sessionId", "memberId", "interestLevel", "religion"] as const) {
    if (filters[key] !== "") params.set(key, filters[key]);
  }
  if (filters.from !== "") params.set("from", `${filters.from}T00:00:00.000Z`);
  if (filters.to !== "") params.set("to", `${filters.to}T23:59:59.999Z`);
  return params.toString();
}

export function matchesHistorySearch(entry: HistoryEntry, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  const { unitNumber, name, contact } = entry.household;
  return [unitNumber, unitNumber.replace(/[#-]/g, ""), name ?? "", contact ?? ""].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

export function hasHistoryFilter(filters: HistoryFilters): boolean {
  return toHistorySearch(filters) !== "";
}

export type HouseholdGroup = {
  key: string;
  entries: HistoryEntry[];
};

/*
 * One row per door, carrying every visit in the current page.
 *
 * This is the household-centric view: a unit knocked on in March and again in
 * August is one line with two visits, not two unrelated rows. The trajectory
 * reads oldest first, which is the direction interest moves in.
 */
export function groupByHousehold(entries: HistoryEntry[]): HouseholdGroup[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.household.id);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(entry.household.id, [entry]);
    }
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    entries: [...list].sort(
      (a, b) => new Date(a.visit.createdAt).getTime() - new Date(b.visit.createdAt).getTime(),
    ),
  }));
}
