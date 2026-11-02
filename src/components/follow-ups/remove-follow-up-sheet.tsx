"use client";

import { useRef, useState } from "react";
import type { FollowUp } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { reasonNote, reasonProblem, removalCopy } from "@/lib/follow-ups/removal";
import { FOLLOW_UP_OFFLINE_NOTE, describeFollowUpFailure } from "@/lib/history/follow-ups";
import { useOnline } from "@/lib/hooks/use-online";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { FollowUpDoor } from "@/components/ui/unit-number";

/*
 * Taking a note away: an admin dismisses a suggestion or removes a listed
 * note, and a member withdraws their own suggestion. Every one needs a
 * reason, sent in the body so it never lands in a URL, and the sheet says
 * who will read it. Removal is soft: the note stays, with who and why.
 */
export function RemoveFollowUpSheet({
  note,
  isAdmin,
  viewerId,
  onClose,
  onRemoved,
}: {
  note: FollowUp;
  isAdmin: boolean;
  viewerId?: string | undefined;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const online = useOnline();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  const copy = removalCopy(note, isAdmin, viewerId);
  const problem = reasonProblem(reason);

  async function remove(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await apiFetch(`/follow-ups/${note.id}/remove`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      onRemoved();
    } catch (error) {
      setFailure(describeFollowUpFailure(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /* One button in the docked bar, as in every sheet with a field: a second
     one stood the bar so tall that the reason, typed with the keyboard up,
     ran under it. Keep it is the header's way out instead. A typed reason
     is asked about before a stray tap on the backdrop throws it away. */
  return (
    <Sheet
      label={copy.title}
      title={copy.title}
      closeLabel="Keep it"
      onClose={onClose}
      discard={
        reason.trim() === ""
          ? undefined
          : { title: "Discard this reason?", detail: "Nothing has been removed." }
      }
    >
      <p className="mt-1 text-body tabular-nums">
        <FollowUpDoor note={note} />
      </p>
      <p className="mt-1 text-body text-foreground-muted">{copy.body}</p>

      {failure === null ? null : (
        <p role="alert" className="mt-3 notice-danger">
          {failure}
        </p>
      )}

      <div className="mt-3">
        <label htmlFor="remove-reason" className="mb-1 block text-body font-medium">
          {copy.label}
        </label>
        <textarea
          id="remove-reason"
          rows={2}
          value={reason}
          placeholder={copy.placeholder}
          aria-invalid={problem === "too_long"}
          aria-describedby="remove-reason-note"
          onChange={(event) => {
            setReason(event.target.value);
          }}
          className="field py-2"
        />
        <p
          id="remove-reason-note"
          className={
            problem === "too_long" ? "mt-1 field-error" : "mt-1 text-caption text-foreground-muted"
          }
        >
          {reasonNote(problem, copy.readers)}
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
          disabled={busy || !online || problem !== null}
          aria-describedby="remove-reason-note"
          onClick={() => void remove()}
          className="min-h-14 w-full btn-danger rounded-xl text-title font-semibold"
        >
          {busy ? "Working…" : copy.button}
        </button>
      </SheetActions>
    </Sheet>
  );
}
