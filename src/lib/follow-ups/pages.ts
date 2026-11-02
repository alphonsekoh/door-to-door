import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * Every follow-up a query matches, a page at a time, as D-74-61 reads users.
 * Offset paging over a list that changes between pages can hand a note back
 * twice, when one is added ahead of it, so each is kept once, where it first
 * came. One can still be missed when a note ahead of it leaves; the next read
 * has it. Stops on the server's say-so or an empty page, so a miscounting
 * server cannot loop it. A failed page fails the whole read.
 */
export async function loadAllFollowUps(
  query: Readonly<Record<string, string>>,
  pageSize: number,
): Promise<FollowUp[]> {
  const notes = new Map<string, FollowUp>();
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      ...query,
      limit: String(pageSize),
      offset: String(offset),
    });
    const page = await apiFetch<FollowUpList>(`/follow-ups?${params.toString()}`);
    for (const note of page.data) notes.set(note.id, note);
    offset += page.data.length;
    if (!page.pagination.hasMore || page.data.length === 0) return [...notes.values()];
  }
}
