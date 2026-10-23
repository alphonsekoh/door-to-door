"use client";

import { useRef, useState } from "react";
import type { FollowUp } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import {
  FOLLOW_UP_OFFLINE_NOTE,
  MAX_NOTE_LENGTH,
  describeFollowUpFailure,
  dueDayToInstant,
  instantToDueDay,
} from "@/lib/history/follow-ups";
import { useOnline } from "@/lib/hooks/use-online";
import { useRole } from "@/lib/hooks/use-role";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";

export type FollowUpSheetMode =
  | {
      kind: "create";
      householdId: string;
      visitId: string | null;
      unitNumber: string;
      /* Words to start from, such as why the household needs a visit. */
      initialNote?: string;
    }
  | { kind: "edit"; note: FollowUp };

/* What a member is told once their suggestion is in, wherever they sent it. */
export const SUGGESTION_SENT = "Suggestion sent. An admin will review it.";
export const ADDED_TO_LIST = "Added to the follow-up list.";

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

/* The words for each role and purpose, so a member is never told they are
   adding to a list only an admin decides. */
function copyFor(mode: FollowUpSheetMode, isAdmin: boolean) {
  if (mode.kind === "edit") {
    const suggestion = mode.note.status === "suggested";
    return {
      title: suggestion ? "Edit suggestion" : "Edit follow-up",
      hint: null,
      field: suggestion ? "Why should we go back?" : "What should the next visit do?",
      placeholder: undefined,
      due: suggestion ? "Go back by (optional)" : "Due (optional)",
      submit: "Save changes",
    };
  }
  return isAdmin
    ? {
        title: "Add to the follow-up list",
        hint: null,
        field: "What should the next visit do?",
        placeholder: "For example: bring the event flyer",
        due: "Due (optional)",
        submit: "Add to list",
      }
    : {
        title: "Suggest a return visit",
        hint: "An admin reviews every suggestion and decides whether to add it to the follow-up list.",
        field: "Why should we go back?",
        placeholder: "For example: asked us to come back after 7pm",
        due: "Go back by (optional)",
        submit: "Send suggestion",
      };
}

/*
 * Add or change one note. An admin's goes on the follow-up list; a member's
 * is a suggestion for an admin to review. Typed text survives a failed
 * request (D-25-8): a refusal must not cost anyone what they wrote at the door.
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
  const { isAdmin } = useRole();
  const editing = mode.kind === "edit" ? mode.note : null;
  const initial = mode.kind === "create" ? (mode.initialNote ?? "") : mode.note.note;
  const [text, setText] = useState(initial);
  const [day, setDay] = useState(instantToDueDay(editing?.dueDate ?? null));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Under the field it is about, not in the banner a request failure uses. */
  const [noteError, setNoteError] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  const copy = copyFor(mode, isAdmin);
  const length = text.trim().length;
  /* Asked before a flick or a stray tap loses what was typed at the door,
     judged against the words the sheet opened with. An edit asks about the
     changes: "this note" would read as deleting it. */
  const discard =
    editing === null
      ? text.trim() === initial.trim() && day === ""
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

  const unit = mode.kind === "create" ? mode.unitNumber : mode.note.unitNumber;

  return (
    <Sheet
      label={`${copy.title}, ${unit}`}
      title={
        <>
          {copy.title}
          <span className="block text-body font-normal text-foreground-muted tabular-nums">
            <UnitNumber value={unit} />
          </span>
        </>
      }
      onClose={onClose}
      discard={discard}
    >
      {copy.hint === null ? null : (
        <p className="mt-2 text-body text-foreground-muted">{copy.hint}</p>
      )}

      {failure === null ? null : (
        <p role="alert" className="mt-3 notice-danger">
          {failure}
        </p>
      )}

      <div className="mt-3">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
          <label htmlFor="follow-up-note" className="text-body font-medium">
            {copy.field}
          </label>
          <span className="text-caption text-foreground-muted">
            {String(length)} of {String(MAX_NOTE_LENGTH)}
          </span>
        </div>
        <textarea
          id="follow-up-note"
          rows={4}
          value={text}
          placeholder={copy.placeholder}
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
          {copy.due}
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
          {busy ? "Saving…" : copy.submit}
        </button>
      </SheetActions>
    </Sheet>
  );
}
