import type { HouseholdList, HouseholdSummary } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/* The contract's largest `offset` (D-126-9): past it, a list answers 400. */
export const MAX_OFFSET = 10_000;

/*
 * Every unit of a block, a page at a time, as D-74-61 reads users: one page of
 * 100 let a burst of new units push real ones, and their history, off the
 * block screen (#127). Each household is kept once, where it first came, as
 * loadAllFollowUps keeps notes. Stops on the server's say-so, an empty page
 * or the offset cap, so a miscounting server cannot loop it. A failed page
 * fails the whole read.
 */
export async function loadAllHouseholds(
  blockId: string,
  pageSize = 100,
): Promise<HouseholdSummary[]> {
  const units = new Map<string, HouseholdSummary>();
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      blockId,
      limit: String(pageSize),
      offset: String(offset),
    });
    const page = await apiFetch<HouseholdList>(`/households?${params.toString()}`);
    for (const unit of page.data) units.set(unit.household.id, unit);
    offset += page.data.length;
    if (!page.pagination.hasMore || page.data.length === 0 || offset > MAX_OFFSET) {
      return [...units.values()];
    }
  }
}
