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

export type UnattachedBlock = { blockId: string; blockName: string; households: number };

/*
 * Blocks with households on the list that the session does not cover yet:
 * a follow-up session reaches only its attached blocks, so these are the
 * ones an admin is offered to add. By block name, as blocks are listed.
 */
export function unattachedListedBlocks(
  notes: readonly Pick<FollowUp, "blockId" | "blockName" | "householdId">[],
  attachedIds: readonly string[],
): UnattachedBlock[] {
  const byBlock = new Map<string, { blockName: string; households: Set<string> }>();
  for (const note of notes) {
    if (attachedIds.includes(note.blockId)) continue;
    const entry = byBlock.get(note.blockId) ?? { blockName: note.blockName, households: new Set() };
    entry.households.add(note.householdId);
    byBlock.set(note.blockId, entry);
  }
  return [...byBlock.entries()]
    .map(([blockId, entry]) => ({
      blockId,
      blockName: entry.blockName,
      households: entry.households.size,
    }))
    .sort((a, b) => a.blockName.localeCompare(b.blockName));
}
