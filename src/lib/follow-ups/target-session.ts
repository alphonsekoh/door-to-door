import type { OutingSession, SessionList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * Which follow-up session a door just added to the follow-up list may also
 * go into: the one running now, else the newest one not started yet, else
 * none. One predictable checkbox rather than a choice among sessions.
 */
export function chooseTarget(
  running: readonly OutingSession[],
  drafts: readonly OutingSession[],
): OutingSession | null {
  const newest = [...drafts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return running[0] ?? newest[0] ?? null;
}

export async function loadTarget(): Promise<OutingSession | null> {
  const page = (status: "active" | "draft") =>
    apiFetch<SessionList>(`/sessions?status=${status}&kind=follow_up&limit=1`);
  const [running, drafts] = await Promise.all([page("active"), page("draft")]);
  return chooseTarget(running.data, drafts.data);
}

/* Said under the checkbox, so the admin knows who will see it and when. */
export function targetCaption(target: OutingSession): string {
  return target.status === "active"
    ? "Running now. Members will see it on their list."
    : "A follow-up session that hasn't started yet.";
}
