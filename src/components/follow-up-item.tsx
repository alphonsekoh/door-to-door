"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { FollowUp } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import {
  FOLLOW_UP_OFFLINE_NOTE,
  addedByline,
  describeFollowUpFailure,
  doneByline,
  isOverdue,
  mayEditFollowUp,
  unitLabel,
} from "@/lib/follow-ups";
import { useOnline } from "@/lib/use-online";
import { useRole } from "@/lib/use-role";
import { formatDay } from "@/lib/dates";

/* Words as well as colour: colour alone is lost in sunlight and to some eyes. */
export function OverdueBadge() {
  return (
    <span className="shrink-0 rounded-full border border-danger bg-danger/15 px-2 py-0.5 text-caption font-semibold">
      Overdue
    </span>
  );
}

export function followUpTone(note: FollowUp, now: Date): string {
  return isOverdue(note, now) ? "border-danger/60 bg-danger/10" : "border-border bg-surface";
}

/*
 * One note: the door (when the list spans doors), the words, when it is due,
 * who wrote and who closed it, and its controls.
 */
export function FollowUpItem({
  note,
  now,
  showUnit = false,
  onChanged,
  onEdit,
}: {
  note: FollowUp;
  now: Date;
  showUnit?: boolean;
  onChanged?: () => void;
  onEdit?: (note: FollowUp) => void;
}) {
  const overdue = isOverdue(note, now);
  const resolved = doneByline(note);

  return (
    <div className={`rounded-lg border p-3 ${followUpTone(note, now)}`}>
      {showUnit || overdue ? (
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          {showUnit ? (
            <Link
              href={`/households/${note.householdId}`}
              className="inline-flex min-h-11 items-center text-body font-semibold btn-text tabular-nums"
            >
              {unitLabel(note)}
            </Link>
          ) : (
            <span />
          )}
          {overdue ? <OverdueBadge /> : null}
        </div>
      ) : null}

      <p className="text-body break-words whitespace-pre-wrap">{note.note}</p>
      {note.dueDate === null ? null : (
        <p className="text-caption text-foreground-muted">Due {formatDay(note.dueDate)}</p>
      )}
      <p className="mt-1 text-caption break-words text-foreground-muted">{addedByline(note)}</p>
      {resolved === null ? null : (
        <p className="text-caption break-words text-foreground-muted">{resolved}</p>
      )}

      <FollowUpControls note={note} onChanged={onChanged} onEdit={onEdit} />
    </div>
  );
}

function FollowUpControls({
  note,
  onChanged,
  onEdit,
}: {
  note: FollowUp;
  onChanged: (() => void) | undefined;
  onEdit: ((note: FollowUp) => void) | undefined;
}) {
  const online = useOnline();
  const { userId, isAdmin } = useRole();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);
  const done = note.doneAt !== null;

  async function toggle(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      /* `done` alone, so it counts as a resolution any member may make. */
      await apiFetch(`/follow-ups/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !done }),
      });
      onChanged?.();
    } catch (error) {
      setFailure(describeFollowUpFailure(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const label = done ? "Reopen" : "Mark done";

  return (
    <div className="mt-2">
      {failure === null ? null : (
        <p role="alert" className="mb-2 notice-danger">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !online}
          onClick={() => void toggle()}
          className="min-h-11 btn-secondary rounded-lg bg-background px-4 text-body font-medium"
        >
          {busy ? "Saving…" : label}
        </button>
        {onEdit !== undefined && mayEditFollowUp(note, { userId, isAdmin }) ? (
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
      </div>
      {online ? null : (
        <p className="mt-1 text-caption text-foreground-muted">{FOLLOW_UP_OFFLINE_NOTE}</p>
      )}
    </div>
  );
}
