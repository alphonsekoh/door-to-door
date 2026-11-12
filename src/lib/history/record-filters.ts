import type { HistoryEntry, InterestLevel } from "@/generated/types.gen";

/*
 * Filters for the admin record list, held in the URL so a view can be sent to
 * someone else.
 *
 * That is also why the values are validated on the way in: a URL is editable,
 * and an interest level the contract does not know would come back as a 400
 * rather than an empty list.
 *
 * The search term is the exception: the screen holds it, and it is never
 * written to the URL. An old link's `q` is the screen's to take and drop
 * (useSearchTerm), as in history-filters.
 */

export type RecordFilters = {
  blockId: string;
  memberId: string;
  teamId: string;
  interestLevel: InterestLevel | "";
  q: string;
};

export const EMPTY_FILTERS: RecordFilters = {
  blockId: "",
  memberId: "",
  teamId: "",
  interestLevel: "",
  q: "",
};

const LEVELS: InterestLevel[] = ["low", "medium", "high", "no_response"];

function asInterestLevel(value: string | null): InterestLevel | "" {
  return LEVELS.find((level) => level === value) ?? "";
}

/* The API takes a uuid; anything else in an edited URL would come back a 400
   and take the whole list with it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asUuid(value: string | null): string {
  return value !== null && UUID.test(value) ? value : "";
}

export function parseFilters(params: URLSearchParams): RecordFilters {
  return {
    blockId: params.get("blockId") ?? "",
    memberId: params.get("memberId") ?? "",
    teamId: asUuid(params.get("teamId")),
    interestLevel: asInterestLevel(params.get("interestLevel")),
    q: "",
  };
}

/* Only the filters that are set, so the URL stays readable and short. */
export function toSearchParams(filters: RecordFilters): string {
  const params = new URLSearchParams();
  if (filters.blockId !== "") params.set("blockId", filters.blockId);
  if (filters.memberId !== "") params.set("memberId", filters.memberId);
  if (filters.teamId !== "") params.set("teamId", filters.teamId);
  if (filters.interestLevel !== "") params.set("interestLevel", filters.interestLevel);
  return params.toString();
}

/*
 * The search term is applied here rather than sent: /history has no text
 * parameter, and adding one for a screen that already holds the page in memory
 * would be a contract change earning nothing.
 */
export function toHistoryQuery(filters: RecordFilters, sessionId: string, limit: number): string {
  const params = new URLSearchParams({ sessionId, limit: String(limit) });
  if (filters.blockId !== "") params.set("blockId", filters.blockId);
  if (filters.memberId !== "") params.set("memberId", filters.memberId);
  if (filters.teamId !== "") params.set("teamId", filters.teamId);
  if (filters.interestLevel !== "") params.set("interestLevel", filters.interestLevel);
  return params.toString();
}

export function matchesSearch(entry: HistoryEntry, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  const { unitNumber, name, contact } = entry.household;
  return [unitNumber, unitNumber.replace(/[#-]/g, ""), name ?? "", contact ?? ""].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

/* Filters the server applies: with any of these set, an empty page says
   nothing about whether the outing has records. */
export function hasServerFilter(filters: RecordFilters): boolean {
  return [filters.blockId, filters.memberId, filters.teamId, filters.interestLevel].some(
    (value) => value !== "",
  );
}

export function hasAnyFilter(filters: RecordFilters): boolean {
  return toSearchParams(filters) !== "" || filters.q.trim() !== "";
}
