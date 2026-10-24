import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * Every note still owed on the follow-up list, a page at a time, so a block
 * with listed households is never missed because it fell on the second page
 * (D-74-61). Stops on the server's say-so or an empty page, so a miscounting
 * server cannot loop it.
 */
export async function loadAllListed(pageSize = 100): Promise<FollowUp[]> {
  const notes: FollowUp[] = [];
  for (;;) {
    const page = await apiFetch<FollowUpList>(
      `/follow-ups?status=listed&outstanding=true&limit=${String(pageSize)}&offset=${String(notes.length)}`,
    );
    notes.push(...page.data);
    if (!page.pagination.hasMore || page.data.length === 0) return notes;
  }
}
