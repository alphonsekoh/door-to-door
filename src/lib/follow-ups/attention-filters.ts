import { asUuid } from "@/lib/history/record-filters";

/*
 * Filters for Needs a return visit, held in the address so Back from a
 * household keeps them (D-29-4). The search term is the screen's alone and
 * never read or written here (D-129-7, D-163-5): it runs over the loaded rows.
 *
 * The block is checked on the way in, as an edited address with a malformed
 * id would come back a 400 and take the whole list with it.
 */

export type AttentionFilters = {
  blockId: string;
  includeMedium: boolean;
};

export function parseAttentionFilters(params: URLSearchParams): AttentionFilters {
  return {
    blockId: asUuid(params.get("blockId")),
    includeMedium: params.get("minimumInterest") === "medium",
  };
}

/* Only what is set, so the address stays short. */
export function toAttentionSearch(filters: AttentionFilters): string {
  const params = new URLSearchParams();
  if (filters.blockId !== "") params.set("blockId", filters.blockId);
  if (filters.includeMedium) params.set("minimumInterest", "medium");
  return params.toString();
}

export function toAttentionRequest(
  filters: AttentionFilters,
  page: { limit: number; offset: number },
): string {
  const params = new URLSearchParams({
    limit: String(page.limit),
    offset: String(page.offset),
  });
  if (filters.includeMedium) params.set("minimumInterest", "medium");
  if (filters.blockId !== "") params.set("blockId", filters.blockId);
  return params.toString();
}

/* The medium toggle widens the list rather than narrowing it, so it is not a
   filter here: an empty list under it still means nothing is waiting. */
export function hasAttentionFilter(filters: AttentionFilters, q: string): boolean {
  return filters.blockId !== "" || q.trim() !== "";
}
