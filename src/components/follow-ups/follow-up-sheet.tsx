"use client";

import { useRef, useState } from "react";
import { AlsoAddRow, useAlsoAdd } from "@/components/follow-ups/also-add";
import type { FollowUp } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import {
  ADDED_TO_LIST,
  type AddOutcome,
  type HalfAdded,
  intoSession,
  listThenAdd,
  partialMessage,
} from "@/lib/follow-ups/add-to-list";
import {
  FOLLOW_UP_OFFLINE_NOTE,
  MAX_NOTE_LENGTH,
  describeFollowUpFailure,
  dueDayToInstant,
  instantToDueDay,
} from "@/lib/history/follow-ups";
import { useOnline } from "@/lib/hooks/use-online";
import { useRole } from "@/lib/hooks/use-role";
import {
  NOTE_NOT_SAVED,
  type NotSaved,
  notSavedByForm,
  notSavedFromServer,
  notSavedLine,
} from "@/lib/not-saved";
import { NotSavedDialog } from "@/components/ui/not-saved-dialog";
import { Sheet, SheetActions, SheetPresence } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";

export type FollowUpSheetMode =
  | {
      kind: "create";
      householdId: string;
      visitId: string | null;
      unitNumber: string;
      /* Why the household needs a visit, shown above the note rather than
         written into it: the note is what the next visit should do. */
      context?: string;
    }
  | { kind: "edit"; note: FollowUp };

/* What a member is told once their suggestion is in, wherever they sent it. */
export const SUGGESTION_SENT = "Suggestion sent. An admin will review it.";

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
 * Add or change one note. An admin's goes on the follow-up list, and may go
 * into a follow-up session in the same tap; a member's is a suggestion for an
 * admin to review. Typed text survives a failed request (D-25-8): a refusal
 * must not cost anyone what they wrote at the door.
 *
 * `onSaved` is told what to say: the parent shows it once the sheet has gone.
 */
export function FollowUpSheet({
  mode,
  onClose,
  onSaved,
}: {
  mode: FollowUpSheetMode;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const online = useOnline();
  const { isAdmin } = useRole();
  const editing = mode.kind === "edit" ? mode.note : null;
  const also = useAlsoAdd(isAdmin && mode.kind === "create");
  /* Listed, but the session step failed: the note is saved, so only that
     step is retried, and closing loses nothing. */
  const [partial, setPartial] = useState<(HalfAdded & { householdId: string }) | null>(null);
  const [text, setText] = useState(editing?.note ?? "");
  const [day, setDay] = useState(instantToDueDay(editing?.dueDate ?? null));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Under the field it is about, not in the banner a request failure uses. */
  const [noteError, setNoteError] = useState<string | null>(null);
  /* Why a blank note, or one the server refused, was not saved. */
  const [notSaved, setNotSaved] = useState<NotSaved | null>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  const copy = copyFor(mode, isAdmin);
  const length = text.trim().length;
  /* Asked before a flick or a stray tap loses what was typed at the door.
     An edit asks about the changes: "this note" would read as deleting it. */
  const discard =
    partial !== null
      ? undefined
      : editing === null
        ? text.trim() === "" && day === ""
          ? undefined
          : { title: "Discard this note?", detail: "What you typed has not been saved." }
        : Object.keys(diffFollowUp(editing, text, day)).length === 0
          ? undefined
          : { title: "Discard your changes?", detail: "The note stays as it was." };

  /* The request answers with what to tell the parent, or null to stay open. */
  async function send(request: () => Promise<string | null>): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const message = await request();
      if (message !== null) onSaved(message);
    } catch (error) {
      const refused = notSavedFromServer(error, ["note"]);
      if (refused === null) {
        setFailure(describeFollowUpFailure(error));
      } else {
        const note = refused.fields.note;
        setNoteError(note ?? null);
        // A refusal the note has no error for, of the due date say, goes in
        // the banner, or the sheet would show nothing once OK is tapped.
        if (note === undefined) setFailure(notSavedLine(refused));
        setNotSaved(refused);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function submit(): void {
    const problem = checkNote(text);
    setNoteError(problem);
    if (problem !== null) {
      // Only a blank one: past the limit, the count and the error say enough.
      setNotSaved(notSavedByForm(text.trim() === "" ? ["note"] : [], ["note"]));
      return;
    }
    if (mode.kind === "create") {
      const create = () =>
        apiFetch("/follow-ups", {
          method: "POST",
          body: JSON.stringify({
            householdId: mode.householdId,
            visitId: mode.visitId,
            note: text.trim(),
            dueDate: dueDayToInstant(day),
          }),
        });
      if (!isAdmin) {
        void send(async () => {
          await create();
          return SUGGESTION_SENT;
        });
        return;
      }
      void send(async () =>
        settle(await listThenAdd(create, mode.householdId, also.chosen), mode.householdId),
      );
      return;
    }
    const changes = diffFollowUp(mode.note, text, day);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    void send(async () => {
      await apiFetch(`/follow-ups/${mode.note.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      return "Saved.";
    });
  }

  /* What to say once done, or the half done, kept open to say why. */
  function settle(outcome: AddOutcome, householdId: string): string | null {
    if (outcome.status === "done") return outcome.message;
    setPartial({ ...outcome.half, householdId });
    return null;
  }

  /* Only the session step: the note is already on the list. */
  function retry({ target, householdId }: HalfAdded & { householdId: string }): void {
    void send(async () => settle(await intoSession(target, householdId), householdId));
  }

  const unit = mode.kind === "create" ? mode.unitNumber : mode.note.unitNumber;

  return (
    <>
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
        onClose={
          partial === null
            ? onClose
            : () => {
                onSaved(ADDED_TO_LIST);
              }
        }
        discard={discard}
      >
        {copy.hint === null ? null : (
          <p className="mt-2 text-body text-foreground-muted">{copy.hint}</p>
        )}
        {mode.kind === "create" && mode.context !== undefined ? (
          <p className="mt-2 text-body text-foreground-muted">{mode.context}</p>
        ) : null}

        {failure === null ? null : (
          <p role="alert" className="mt-3 notice-danger">
            {failure}
          </p>
        )}
        {partial === null ? null : (
          <p role="alert" className="mt-3 notice-danger">
            {partialMessage(partial)}
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
            ref={noteField}
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

        {partial === null ? <AlsoAddRow also={also} /> : null}

        <SheetActions>
          {online ? null : (
            <p className="mb-2 text-center text-caption text-foreground-muted">
              {FOLLOW_UP_OFFLINE_NOTE}
            </p>
          )}
          {partial === null ? null : partial.refused === null ? (
            <button
              type="button"
              disabled={busy || !online}
              onClick={() => {
                retry(partial);
              }}
              className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold break-words"
            >
              {busy ? "Saving…" : `Add to ${partial.target.title}`}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                onSaved(ADDED_TO_LIST);
              }}
              className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
            >
              Done
            </button>
          )}
          {partial !== null ? null : (
            <button
              type="button"
              disabled={busy || !online || also.looking}
              onClick={submit}
              className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
            >
              {busy ? "Saving…" : copy.submit}
            </button>
          )}
        </SheetActions>
      </Sheet>
      {/* Beside the sheet, not in it, as Sheet keeps its own confirmation. */}
      <SheetPresence>
        {notSaved === null ? null : (
          <NotSavedDialog
            lead={NOTE_NOT_SAVED}
            reasons={notSaved.reasons}
            returnFocus={notSaved.field === "note" ? noteField : undefined}
            onDismiss={() => {
              setNotSaved(null);
            }}
          />
        )}
      </SheetPresence>
    </>
  );
}
