import type { HistoryEntry, InterestLevel, Religion } from "@/generated/types.gen";
import { asUuid } from "@/lib/history/record-filters";

/*
 * Filters for the admin's long-term history view, held in the URL, apart from
 * the search term, which the screen holds itself.
 *
 * Kept apart from record-filters, which covers the running outing: that one is
 * always scoped to one session and offers a narrower set. Merging them would
 * mean a shape where half the fields are meaningless on either screen.
 */

export type HistoryFilters = {
  blockId: string;
  sessionId: string;
  memberId: string;
  teamId: string;
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
  teamId: "",
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

/*
 * A team only means something inside its outing - two outings can each have
 * an "Ann & Ben" - so the team filter is offered, and kept, only once an
 * outing is chosen.
 *
 * The search term is never read from the URL nor written to it: it is a name
 * or a phone number, and a query string goes to the server, its logs, the
 * phone's history and a sign-in's callbackUrl. The search runs on what is
 * already loaded (D-30-6), so nothing needs it there. An old link's `q` is
 * ignored.
 */
export function parseHistoryFilters(params: URLSearchParams): HistoryFilters {
  const sessionId = params.get("sessionId") ?? "";
  return {
    blockId: params.get("blockId") ?? "",
    sessionId,
    memberId: params.get("memberId") ?? "",
    teamId: sessionId === "" ? "" : asUuid(params.get("teamId")),
    interestLevel: LEVELS.find((level) => level === params.get("interestLevel")) ?? "",
    religion: RELIGIONS.find((religion) => religion === params.get("religion")) ?? "",
    from: asDate(params.get("from")),
    to: asDate(params.get("to")),
    q: "",
  };
}

export function toHistorySearch(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  for (const key of [
    "blockId",
    "sessionId",
    "memberId",
    "teamId",
    "interestLevel",
    "religion",
    "from",
    "to",
  ] as const) {
    if (filters[key] !== "") params.set(key, filters[key]);
  }
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
  for (const key of [
    "blockId",
    "sessionId",
    "memberId",
    "teamId",
    "interestLevel",
    "religion",
  ] as const) {
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
  return toHistorySearch(filters) !== "" || filters.q.trim() !== "";
}

export type HouseholdGroup = {
  key: string;
  /* Every entry for a door carries the same household and block. */
  household: HistoryEntry["household"];
  block: HistoryEntry["block"];
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
  const groups = new Map<string, HouseholdGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.household.id);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(entry.household.id, {
        key: entry.household.id,
        household: entry.household,
        block: entry.block,
        entries: [entry],
      });
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    entries: [...group.entries].sort(
      (a, b) => new Date(a.visit.createdAt).getTime() - new Date(b.visit.createdAt).getTime(),
    ),
  }));
}
