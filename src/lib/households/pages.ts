import type { HouseholdList, HouseholdSummary } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/* The contract's largest `offset` (D-126-9): past it, a list answers 400. */
export const MAX_OFFSET = 10_000;

/* One read of a block's units: every page, or the pages that came before one failed. */
export type BlockRead =
  | { complete: true; units: HouseholdSummary[] }
  | { complete: false; units: HouseholdSummary[]; failure: unknown };

/* Each household once, where it first came, with the copy read last. */
export function keepEachOnce(lists: readonly (readonly HouseholdSummary[])[]): HouseholdSummary[] {
  const units = new Map<string, HouseholdSummary>();
  for (const list of lists) for (const unit of list) units.set(unit.household.id, unit);
  return [...units.values()];
}

/*
 * Every unit of a block, a page at a time, as D-74-61 reads users: one page of
 * 100 let a burst of new units push real ones, and their history, off the
 * block screen (#127). A household added ahead of another between pages hands
 * it back twice, so each is kept once, as loadAllFollowUps keeps notes. Stops
 * on the server's say-so, an empty page or the offset cap, so a miscounting
 * server cannot loop it. A failed page ends the read with what came before
 * it: on weak signal each extra page is one more request that can drop, and
 * the pages that did arrive still carry their units' history.
 */
export async function loadAllHouseholds(blockId: string, pageSize = 100): Promise<BlockRead> {
  const pages: HouseholdSummary[][] = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      blockId,
      limit: String(pageSize),
      offset: String(offset),
    });
    let page: HouseholdList;
    try {
      page = await apiFetch<HouseholdList>(`/households?${params.toString()}`);
    } catch (failure) {
      return { complete: false, units: keepEachOnce(pages), failure };
    }
    pages.push(page.data);
    offset += page.data.length;
    if (!page.pagination.hasMore || page.data.length === 0 || offset > MAX_OFFSET) {
      return { complete: true, units: keepEachOnce(pages) };
    }
  }
}
