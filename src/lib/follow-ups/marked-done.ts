import type { RevisitEntry } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { normaliseUnitNumber } from "@/lib/units/unit-number";

/*
 * In a follow-up session the server marks a household's follow-ups done
 * when a visit there is stored, and names them in its answer. The Saved line
 * says so, and offers Undo once it knows which; Undo reopens exactly those,
 * and never touches the visit.
 */

/* How many notes the unit owes on the session's list as last read: what a
   save there marks done. None when the list is unknown. */
export function owedAt(
  revisits: readonly RevisitEntry[] | null | undefined,
  blockId: string,
  unit: string,
): number {
  if (revisits == null) return 0;
  const typed = normaliseUnitNumber(unit);
  const entry = revisits.find(
    (candidate) => candidate.block.id === blockId && candidate.household.unitNumber === typed,
  );
  return entry === undefined ? 0 : entry.notes.filter((note) => note.doneAt === null).length;
}

export type UndoState =
  | { kind: "ready" }
  | { kind: "undoing" }
  | { kind: "undone"; count: number }
  /* The server would not reopen them: its reason, and nothing to retry. */
  | { kind: "refused"; reason: string }
  /* No answer: what is still to reopen, and how many already were. */
  | { kind: "failed"; left: string[]; reopened: number };

export const UNDO_READY: UndoState = { kind: "ready" };

const followUps = (count: number) => (count === 1 ? "Follow-up" : `${String(count)} follow-ups`);

export type MarkedDoneLine = {
  text: string;
  /* What Undo would reopen; null when there is nothing to offer. */
  undo: string[] | null;
};

/*
 * The Saved line's follow-up row. `owed` is what the list said the unit owed
 * when it was saved; `marked` is what the server says it marked, null until
 * the visit has been sent. Null when there is nothing to say: once sent,
 * a save that marked nothing (someone marked them by hand meanwhile) says
 * nothing.
 */
export function markedDoneLine(
  owed: number,
  marked: readonly string[] | null,
  undo: UndoState,
): MarkedDoneLine | null {
  if (marked === null) {
    return owed > 0 ? { text: `${followUps(owed)} marked done once sent.`, undo: null } : null;
  }
  switch (undo.kind) {
    case "undone":
      return {
        text: undo.count === 0 ? "Undone." : `Undone. ${followUps(undo.count)} reopened.`,
        undo: null,
      };
    case "refused":
      return { text: `Not undone. ${undo.reason}`, undo: null };
    case "failed":
      return { text: "Not undone. Check your signal and try again.", undo: undo.left };
    default:
      return marked.length === 0
        ? null
        : { text: `${followUps(marked.length)} marked done.`, undo: [...marked] };
  }
}

/*
 * Reopens each note in turn. A note removed since is skipped: there is
 * nothing left to undo there. A refusal stops with the server's reason
 * (a member's reopen waits while a suggestion is waiting, D-117-32); no
 * answer keeps what is still to reopen, for a second try.
 */
export async function undoMarkedDone(
  ids: readonly string[],
  reopenedBefore = 0,
): Promise<UndoState> {
  let reopened = reopenedBefore;
  for (const [index, id] of ids.entries()) {
    try {
      await apiFetch(`/follow-ups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: false }),
      });
      reopened += 1;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) continue;
      if (error instanceof ApiRequestError && error.status < 500) {
        return { kind: "refused", reason: error.message };
      }
      return { kind: "failed", left: ids.slice(index), reopened };
    }
  }
  return { kind: "undone", count: reopened };
}
