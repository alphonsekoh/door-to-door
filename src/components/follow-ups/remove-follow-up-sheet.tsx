"use client";

import { useRef, useState } from "react";
import type { FollowUp } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { FOLLOW_UP_OFFLINE_NOTE, describeFollowUpFailure } from "@/lib/history/follow-ups";
import { useOnline } from "@/lib/hooks/use-online";
import { firstName } from "@/lib/teams/team-ui";
import { ConfirmDialog, Sheet, SheetActions } from "@/components/ui/sheet";
import { FollowUpDoor } from "@/components/ui/unit-number";

export const MAX_REASON_LENGTH = 500;

/* Removal is soft: the note stays, with who removed it and why. */
function removalPath(note: FollowUp, reason: string): string {
  const trimmed = reason.trim();
  return trimmed === ""
    ? `/follow-ups/${note.id}`
    : `/follow-ups/${note.id}?reason=${encodeURIComponent(trimmed)}`;
}

/*
 * Taking a note away. An admin dismisses a suggestion or removes a listed
 * note, with a reason the author sees; a member only ever withdraws their own
 * suggestion, which needs no reason and so is a plain confirmation.
 */
export function RemoveFollowUpSheet({
  note,
  isAdmin,
  onClose,
  onRemoved,
}: {
  note: FollowUp;
  isAdmin: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const online = useOnline();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  async function remove(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await apiFetch(removalPath(note, isAdmin ? reason : ""), { method: "DELETE" });
      onRemoved();
    } catch (error) {
      setFailure(describeFollowUpFailure(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <ConfirmDialog
        title="Withdraw your suggestion?"
        detail={failure ?? "Admins will no longer see it for review."}
        confirmLabel="Withdraw"
        cancelLabel="Keep it"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={onClose}
      />
    );
  }

  const suggestion = note.status === "suggested";
  const author = firstName(note.author.name);
  const title = suggestion ? "Dismiss this suggestion?" : "Remove from the follow-up list?";
  const tooLong = reason.trim().length > MAX_REASON_LENGTH;

  return (
    <Sheet label={title} title={title} onClose={onClose}>
      <p className="mt-1 text-body tabular-nums">
        <FollowUpDoor note={note} />
      </p>
      <p className="mt-1 text-body text-foreground-muted">
        {suggestion
          ? `${author} will be told it was not added.`
          : "It stops showing on the list and in sessions. Admins can still see it under Dismissed."}
      </p>

      {failure === null ? null : (
        <p role="alert" className="mt-3 notice-danger">
          {failure}
        </p>
      )}

      <div className="mt-3">
        <label htmlFor="remove-reason" className="mb-1 block text-body font-medium">
          Reason (optional)
        </label>
        <textarea
          id="remove-reason"
          rows={2}
          value={reason}
          aria-invalid={tooLong}
          aria-describedby="remove-reason-note"
          onChange={(event) => {
            setReason(event.target.value);
          }}
          className="field py-2"
        />
        <p
          id="remove-reason-note"
          className={tooLong ? "mt-1 field-error" : "mt-1 text-caption text-foreground-muted"}
        >
          {tooLong
            ? `Keep the reason to ${String(MAX_REASON_LENGTH)} characters.`
            : suggestion
              ? `${author} will see this.`
              : "Admins see this under Dismissed."}
        </p>
      </div>

      <SheetActions>
        {online ? null : (
          <p className="mb-2 text-center text-caption text-foreground-muted">
            {FOLLOW_UP_OFFLINE_NOTE}
          </p>
        )}
        <button
          type="button"
          disabled={busy || !online || tooLong}
          onClick={() => void remove()}
          className="min-h-14 w-full btn-danger rounded-xl text-title font-semibold"
        >
          {busy ? "Working…" : suggestion ? "Dismiss suggestion" : "Remove from list"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
        >
          Keep it
        </button>
      </SheetActions>
    </Sheet>
  );
}
