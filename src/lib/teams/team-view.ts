import type { HistoryEntry, InterestLevel } from "@/generated/types.gen";

/*
 * "Me" or "My team" on a member's own history, held in the URL so the choice
 * survives moving between the outing list and an outing (D-29-4: a URL is
 * editable, so anything but the one known value reads as the default).
 */

export type RecordScope = "me" | "team";

const PARAM = "view";

export function parseScope(params: URLSearchParams): RecordScope {
  return params.get(PARAM) === "team" ? "team" : "me";
}

export function scopeHref(path: string, scope: RecordScope): string {
  return scope === "team" ? `${path}?${PARAM}=team` : path;
}

export type OwnRecordFilters = {
  sessionId?: string;
  blockId?: string;
  interestLevel?: InterestLevel | "";
};

/* The team is never named in the request: the server derives it from the
   signed-in user (D-74-21). */
export function ownHistoryRequest(
  scope: RecordScope,
  filters: OwnRecordFilters,
  page: { limit: number; offset: number },
): string {
  const params = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
  if (scope === "team") params.set("includeTeam", "true");
  for (const key of ["sessionId", "blockId", "interestLevel"] as const) {
    const value = filters[key];
    if (value !== undefined && value !== "") params.set(key, value);
  }
  return params.toString();
}

/*
 * The teams the server says the viewer is on now. With includeTeam, a record
 * that is not the viewer's own is only returned because it is stamped with a
 * team they are CURRENTLY on (D-74-17), so its team id is the server's word,
 * not the snapshot's. Without a known viewer nothing can be told apart.
 */
export function vouchedTeamIds(entries: HistoryEntry[], meId: string | undefined): string[] {
  if (meId === undefined) return [];
  const ids = new Set<string>();
  for (const { visit } of entries) {
    if (visit.member.id !== meId && visit.team !== null) ids.add(visit.team.id);
  }
  return [...ids];
}
