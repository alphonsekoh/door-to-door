import type { HistoryEntry, InterestLevel } from "@/generated/types.gen";

/*
 * Filters for the admin record list, held in the URL so a view can be sent to
 * someone else.
 *
 * That is also why the values are validated on the way in: a URL is editable,
 * and an interest level the contract does not know would come back as a 400
 * rather than an empty list.
 */

export type RecordFilters = {
  blockId: string;
  memberId: string;
  interestLevel: InterestLevel | "";
  q: string;
};

export const EMPTY_FILTERS: RecordFilters = {
  blockId: "",
  memberId: "",
  interestLevel: "",
  q: "",
};

const LEVELS: InterestLevel[] = ["low", "medium", "high", "no_response"];

function asInterestLevel(value: string | null): InterestLevel | "" {
  return LEVELS.find((level) => level === value) ?? "";
}

export function parseFilters(params: URLSearchParams): RecordFilters {
  return {
    blockId: params.get("blockId") ?? "",
    memberId: params.get("memberId") ?? "",
    interestLevel: asInterestLevel(params.get("interestLevel")),
    q: params.get("q") ?? "",
  };
}

/* Only the filters that are set, so the URL stays readable and short. */
export function toSearchParams(filters: RecordFilters): string {
  const params = new URLSearchParams();
  if (filters.blockId !== "") params.set("blockId", filters.blockId);
  if (filters.memberId !== "") params.set("memberId", filters.memberId);
  if (filters.interestLevel !== "") params.set("interestLevel", filters.interestLevel);
  if (filters.q.trim() !== "") params.set("q", filters.q.trim());
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

export function hasAnyFilter(filters: RecordFilters): boolean {
  return toSearchParams(filters) !== "";
}
