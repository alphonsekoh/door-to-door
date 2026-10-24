"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { RemoveFollowUpSheet } from "@/components/follow-ups/remove-follow-up-sheet";
import type { ActiveSession, FollowUp } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { followUpRights } from "@/lib/follow-ups/rights";
import {
  FOLLOW_UP_OFFLINE_NOTE,
  addedByline,
  describeFollowUpFailure,
  doneByline,
  isOverdue,
  listedByline,
} from "@/lib/history/follow-ups";
import { useOnline } from "@/lib/hooks/use-online";
import { useRole } from "@/lib/hooks/use-role";
import { formatDay } from "@/lib/history/dates";
import { SheetPresence } from "@/components/ui/sheet";
import { FollowUpDoor } from "@/components/ui/unit-number";

/* Words as well as colour: colour alone is lost in sunlight and to some eyes. */
export function OverdueBadge() {
  return (
    <span className="shrink-0 rounded-full border border-danger bg-danger/15 px-2 py-0.5 text-caption font-semibold">
      Overdue
    </span>
  );
}

export function followUpTone(note: FollowUp, now: Date): string {
  if (note.status === "suggested") return "border-dashed border-border-strong bg-surface";
  return isOverdue(note, now) ? "border-danger/60 bg-danger/10" : "border-border bg-surface";
}

/*
 * One note: the door (when the list spans doors), the words, when it is due,
 * who wrote, listed and closed it, and the controls the viewer has. A
 * suggestion is drawn with a dashed edge: it is a request, not yet owed.
 */
export function FollowUpItem({
  note,
  now,
  active,
  showUnit = false,
  onChanged,
  onEdit,
}: {
  note: FollowUp;
  now: Date;
  /* The running session, which decides what a member may change. */
  active: ActiveSession | null;
  showUnit?: boolean;
  onChanged?: () => void;
  onEdit?: (note: FollowUp) => void;
}) {
  const { userId } = useRole();
  const overdue = isOverdue(note, now);
  const resolved = doneByline(note, userId);
  const listed = listedByline(note, userId);

  return (
    <div className={`rounded-lg border p-3 ${followUpTone(note, now)}`}>
      {showUnit || overdue ? (
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          {showUnit ? (
            <Link
              href={`/households/${note.householdId}`}
              className="inline-flex min-h-11 items-center text-body font-semibold btn-text tabular-nums"
            >
              <FollowUpDoor note={note} />
            </Link>
          ) : (
            <span />
          )}
          {overdue ? <OverdueBadge /> : null}
        </div>
      ) : null}

      <p className="text-body break-words whitespace-pre-wrap">{note.note}</p>
      {note.dueDate === null ? null : (
        <p className="text-caption text-foreground-muted">
          {note.status === "suggested" ? "Go back by" : "Due"} {formatDay(note.dueDate)}
        </p>
      )}
      <p className="mt-1 text-caption break-words text-foreground-muted">
        {addedByline(note, userId)}
      </p>
      {listed === null ? null : (
        <p className="text-caption break-words text-foreground-muted">{listed}</p>
      )}
      {resolved === null ? null : (
        <p className="text-caption break-words text-foreground-muted">{resolved}</p>
      )}

      <FollowUpControls note={note} active={active} onChanged={onChanged} onEdit={onEdit} />
    </div>
  );
}

function FollowUpControls({
  note,
  active,
  onChanged,
  onEdit,
}: {
  note: FollowUp;
  active: ActiveSession | null;
  onChanged: (() => void) | undefined;
  onEdit: ((note: FollowUp) => void) | undefined;
}) {
  const online = useOnline();
  const { userId, isAdmin } = useRole();
  const rights = followUpRights(note, { userId, isAdmin }, active);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);
  const done = note.doneAt !== null;

  async function change(body: Record<string, unknown>): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await apiFetch(`/follow-ups/${note.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onChanged?.();
    } catch (error) {
      setFailure(describeFollowUpFailure(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const editable = onEdit !== undefined && rights.canEditText;
  const offers = rights.canResolve || rights.canPromote || editable || rights.canRemove;
  const removeLabel = !isAdmin
    ? "Withdraw"
    : note.status === "suggested"
      ? "Dismiss"
      : "Remove from list";

  return (
    <>
      {failure === null ? null : (
        <p role="alert" className="mt-2 notice-danger">
          {failure}
        </p>
      )}
      {offers ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {rights.canPromote ? (
            <button
              type="button"
              disabled={busy || !online}
              onClick={() => void change({ status: "listed" })}
              className="min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
            >
              {busy ? "Saving…" : "Add to list"}
            </button>
          ) : null}
          {rights.canResolve ? (
            /* `done` alone, so it counts as a resolution any member may make. */
            <button
              type="button"
              disabled={busy || !online}
              onClick={() => void change({ done: !done })}
              className="min-h-11 btn-secondary rounded-lg bg-background px-4 text-body font-medium"
            >
              {busy ? "Saving…" : done ? "Reopen" : "Mark done"}
            </button>
          ) : null}
          {editable ? (
            <button
              type="button"
              disabled={!online}
              onClick={() => {
                onEdit(note);
              }}
              className="min-h-11 rounded-lg px-4 text-body font-medium btn-text"
            >
              Edit
            </button>
          ) : null}
          {rights.canRemove ? (
            <button
              type="button"
              disabled={busy || !online}
              onClick={() => {
                setRemoving(true);
              }}
              className="min-h-11 rounded-lg px-4 text-body font-medium text-danger disabled:opacity-60"
            >
              {removeLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {/* Named for the block, since a follow-up session may be running
          elsewhere. A note resolved before a session starts is never on its
          list, so no session will let a member reopen it. */}
      {rights.locked ? (
        <p className="mt-1 text-caption text-foreground-muted">
          {done
            ? "Ask an admin if it needs reopening."
            : `You can mark this done during a follow-up session that includes Blk ${note.blockName}.`}
        </p>
      ) : null}
      {offers && !online ? (
        <p className="mt-1 text-caption text-foreground-muted">{FOLLOW_UP_OFFLINE_NOTE}</p>
      ) : null}

      <SheetPresence>
        {removing ? (
          <RemoveFollowUpSheet
            note={note}
            isAdmin={isAdmin}
            viewerId={userId}
            onClose={() => {
              setRemoving(false);
            }}
            onRemoved={() => {
              setRemoving(false);
              onChanged?.();
            }}
          />
        ) : null}
      </SheetPresence>
    </>
  );
}
