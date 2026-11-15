import type { FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";
import { MAX_OFFSET } from "@/lib/households/pages";

/*
 * A unit's history, a page of visits at a time (#160). Both screens read the
 * newest page; the panel reads older ones on request and holds them here.
 */

/* Owner, 2026-11-14: no real unit has twenty visits, so only a flooded one pages. */
export const HISTORY_PAGE_SIZE = 20;

export function historyPath(householdId: string, offset = 0): string {
  const params = new URLSearchParams({
    limit: String(HISTORY_PAGE_SIZE),
    offset: String(offset),
  });
  return `/households/${householdId}?${params.toString()}`;
}

/*
 * The visits read so far for one unit besides its current first page, and
 * where the next older page starts.
 */
export type EarlierVisits = {
  householdId: string;
  visits: Visit[];
  next: number;
  total: number;
  /* A read came back empty: nothing older is left to ask for. */
  ended: boolean;
};

/*
 * A page added to what is held. What is held for another unit is dropped, so
 * a late answer never mixes two doors.
 */
function gather(
  current: EarlierVisits | null,
  page: HouseholdHistory,
  ended: (same: EarlierVisits | null) => boolean,
): EarlierVisits {
  const same = current !== null && current.householdId === page.household.id ? current : null;
  return {
    householdId: page.household.id,
    visits: same === null ? page.visits : [...same.visits, ...page.visits],
    /* The spec's rule for the next page: its offset plus the visits received. */
    next: Math.max(same?.next ?? 0, page.pagination.offset + page.visits.length),
    total: Math.max(same?.total ?? 0, page.pagination.total),
    ended: ended(same),
  };
}

/* An older page, read on request. */
export function addEarlier(current: EarlierVisits | null, page: HouseholdHistory): EarlierVisits {
  return gather(current, page, () => page.visits.length === 0);
}

/*
 * A first page the parent has since read again. Its visits stay held: one
 * stored in between pushes the oldest of them off the new first page, and an
 * older page read from an offset counted before that would not have it
 * either. An empty first page says nothing about older ones.
 */
export function keepFirstPage(
  current: EarlierVisits | null,
  outgoing: HouseholdHistory,
): EarlierVisits {
  return gather(current, outgoing, (same) => same?.ended ?? false);
}

export type HeldVisits = {
  /* Newest first, each once. */
  visits: Visit[];
  next: number;
  total: number;
  more: boolean;
};

const newer = (a: Visit, b: Visit) => Date.parse(a.updatedAt) > Date.parse(b.updatedAt);

/*
 * The first page and the older pages as one list. A visit stored between two
 * reads shifts every offset by one, so a page can repeat a visit but never
 * skip one (visits are never removed): each is kept once, the copy amended
 * last, and the first page's on a tie. The order is for showing only; the
 * next offset comes from what each read received, never from this list.
 */
export function holdVisits(first: HouseholdHistory, earlier: EarlierVisits | null): HeldVisits {
  const older = earlier !== null && earlier.householdId === first.household.id ? earlier : null;
  const byId = new Map<string, Visit>();
  for (const visit of [...first.visits, ...(older?.visits ?? [])]) {
    const held = byId.get(visit.id);
    if (held === undefined || newer(visit, held)) byId.set(visit.id, visit);
  }
  const visits = [...byId.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1),
  );
  const next = Math.max(first.pagination.offset + first.visits.length, older?.next ?? 0);
  const total = Math.max(first.pagination.total, older?.total ?? 0);
  /* Past the contract's offset cap a read is refused, so the oldest stay unread (D-126-9). */
  const more = older?.ended !== true && next < total && next <= MAX_OFFSET;
  return { visits, next, total, more };
}

/*
 * While older visits remain unread, a resolved note older than every visit
 * shown waits with them: one from years back above this year's visits would
 * hide the gap between them.
 */
export function timelineNotes(
  resolved: readonly FollowUp[],
  held: HeldVisits,
): readonly FollowUp[] {
  const oldest = held.visits.at(-1);
  if (!held.more || oldest === undefined) return resolved;
  const from = Date.parse(oldest.createdAt);
  return resolved.filter((note) => Date.parse(note.createdAt) >= from);
}
