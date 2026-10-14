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
  formatDay,
  isOverdue,
  mayEditFollowUp,
  unitLabel,
} from "@/lib/follow-ups";
import { useOnline } from "@/lib/use-online";
import { useRole } from "@/lib/use-role";

/* Words as well as colour: colour alone is lost in sunlight and to some eyes. */
export function OverdueBadge() {
  return (
    <span className="shrink-0 rounded-full border border-interest-low bg-interest-low/15 px-2 py-0.5 text-caption font-semibold">
      Overdue
    </span>
  );
}

export function followUpTone(note: FollowUp, now: Date): string {
  return isOverdue(note, now)
    ? "border-interest-low/60 bg-interest-low/10"
    : "border-border bg-surface";
}

/*
 * One note: the door (when the list spans doors), the words, when it is due,
 * and who wrote and who closed it. Controls are opt-in, so a read-only list
 * does not need a signed-in session to render.
 */
export function FollowUpItem({
  note,
  now,
  showUnit = false,
  controls = false,
  onChanged,
  onEdit,
}: {
  note: FollowUp;
  now: Date;
  showUnit?: boolean;
  controls?: boolean;
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
              className="inline-flex min-h-11 items-center text-body font-semibold text-primary tabular-nums"
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

      {controls ? <FollowUpControls note={note} onChanged={onChanged} onEdit={onEdit} /> : null}
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
        <p
          role="alert"
          className="mb-2 rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
        >
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !online}
          onClick={() => void toggle()}
          className="min-h-11 rounded-lg border border-border bg-background px-4 text-body font-medium disabled:opacity-60"
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
            className="min-h-11 rounded-lg px-4 text-body font-medium text-primary disabled:opacity-60"
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
