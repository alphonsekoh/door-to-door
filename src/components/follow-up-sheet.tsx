"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { FollowUp } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import {
  FOLLOW_UP_OFFLINE_NOTE,
  MAX_NOTE_LENGTH,
  describeFollowUpFailure,
  dueDayToInstant,
  instantToDueDay,
} from "@/lib/follow-ups";
import { useOnline } from "@/lib/use-online";
import { Sheet, SheetActions, SheetPresence } from "@/components/sheet";
import { UnitNumber } from "@/components/unit-number";

export type FollowUpSheetMode =
  | { kind: "create"; householdId: string; visitId: string | null; unitNumber: string }
  | { kind: "edit"; note: FollowUp };

type Changes = { note?: string; dueDate?: string | null };

/* Only what moved: the contract refuses an empty PATCH, and an untouched
   field sent back would read as an edit for no reason. */
export function diffFollowUp(before: FollowUp, text: string, day: string): Changes {
  const changes: Changes = {};
  if (text.trim() !== before.note) changes.note = text.trim();
  if (day !== instantToDueDay(before.dueDate)) changes.dueDate = dueDayToInstant(day);
  return changes;
}

/* Why a note cannot be saved yet, or null when it can. */
function checkNote(text: string): string | null {
  const length = text.trim().length;
  if (length === 0) return "Write the note first.";
  if (length > MAX_NOTE_LENGTH) return `Keep the note to ${String(MAX_NOTE_LENGTH)} characters.`;
  return null;
}

/*
 * Add or change one note. Typed text survives a failed request (D-25-8): a
 * refusal must not cost anyone what they wrote at the door.
 */
export function FollowUpSheet({
  mode,
  onClose,
  onSaved,
}: {
  mode: FollowUpSheetMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const online = useOnline();
  const editing = mode.kind === "edit" ? mode.note : null;
  const [text, setText] = useState(editing?.note ?? "");
  const [day, setDay] = useState(instantToDueDay(editing?.dueDate ?? null));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Under the field it is about, not in the banner a request failure uses. */
  const [noteError, setNoteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  const length = text.trim().length;
  const label = mode.kind === "create" ? `Follow-up for ${mode.unitNumber}` : "Edit follow-up";
  /* Asked before a flick or a stray tap loses what was typed at the door. An
     edit asks about the changes: "this note" would read as deleting it. */
  const discard =
    editing === null
      ? text.trim() === "" && day === ""
        ? undefined
        : { title: "Discard this note?", detail: "What you typed has not been saved." }
      : Object.keys(diffFollowUp(editing, text, day)).length === 0
        ? undefined
        : { title: "Discard your changes?", detail: "The note stays as it was." };

  async function send(request: () => Promise<unknown>): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await request();
      onSaved();
    } catch (error) {
      setFailure(describeFollowUpFailure(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function submit(): void {
    const problem = checkNote(text);
    setNoteError(problem);
    if (problem !== null) return;
    if (mode.kind === "create") {
      void send(() =>
        apiFetch("/follow-ups", {
          method: "POST",
          body: JSON.stringify({
            householdId: mode.householdId,
            visitId: mode.visitId,
            note: text.trim(),
            dueDate: dueDayToInstant(day),
          }),
        }),
      );
      return;
    }
    const changes = diffFollowUp(mode.note, text, day);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    void send(() =>
      apiFetch(`/follow-ups/${mode.note.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      }),
    );
  }

  return (
    <>
      <Sheet
        label={label}
        title={
          mode.kind === "create" ? (
            <>
              Follow-up for <UnitNumber value={mode.unitNumber} />
            </>
          ) : (
            label
          )
        }
        onClose={onClose}
        discard={discard}
      >
        {failure === null ? null : (
          <p role="alert" className="mt-3 notice-danger">
            {failure}
          </p>
        )}

        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <label htmlFor="follow-up-note" className="text-body font-medium">
              Note
            </label>
            <span className="text-caption text-foreground-muted">
              {String(length)} of {String(MAX_NOTE_LENGTH)}
            </span>
          </div>
          <textarea
            id="follow-up-note"
            rows={4}
            value={text}
            aria-invalid={noteError !== null}
            aria-describedby={noteError === null ? undefined : "follow-up-note-error"}
            onChange={(event) => {
              setText(event.target.value);
              // Cleared as soon as it is fixed, never raised while typing.
              if (noteError !== null && checkNote(event.target.value) === null) setNoteError(null);
            }}
            className="field py-2"
          />
          {noteError === null ? null : (
            <p id="follow-up-note-error" className="mt-1 field-error">
              {noteError}
            </p>
          )}
        </div>

        <div className="mt-3">
          <label htmlFor="follow-up-due" className="mb-1 block text-body font-medium">
            Due (optional)
          </label>
          {/* h-12, not min-h: iOS WebKit ignores min-height on native date
              and select controls (D-74-62). */}
          <input
            id="follow-up-due"
            type="date"
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
            }}
            className="h-12 min-h-12 field"
          />
        </div>

        {editing === null ? null : (
          <button
            type="button"
            disabled={!online || busy}
            onClick={() => {
              setConfirming(true);
            }}
            className="mt-3 min-h-11 text-body font-medium text-danger disabled:opacity-60"
          >
            Delete this note
          </button>
        )}

        <SheetActions>
          {online ? null : (
            <p className="mb-2 text-center text-caption text-foreground-muted">
              {FOLLOW_UP_OFFLINE_NOTE}
            </p>
          )}
          <button
            type="button"
            disabled={busy || !online}
            onClick={submit}
            className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
          >
            {busy ? "Saving…" : editing === null ? "Save follow-up" : "Save changes"}
          </button>
        </SheetActions>
      </Sheet>

      <SheetPresence>
        {editing !== null && confirming ? (
          <ConfirmDialog
            title="Delete this follow-up?"
            detail="It disappears from this unit's history for everyone."
            confirmLabel="Delete"
            busy={busy}
            onCancel={() => {
              setConfirming(false);
            }}
            onConfirm={() => {
              void send(() => apiFetch(`/follow-ups/${editing.id}`, { method: "DELETE" })).then(
                () => {
                  setConfirming(false);
                },
              );
            }}
          />
        ) : null}
      </SheetPresence>
    </>
  );
}
