"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [confirming, setConfirming] = useState(false);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);

  const length = text.trim().length;
  const title = mode.kind === "create" ? `Follow-up for ${mode.unitNumber}` : "Edit follow-up";

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
    if (length === 0) {
      setFailure("Write the note first.");
      return;
    }
    if (length > MAX_NOTE_LENGTH) {
      setFailure(`Keep the note to ${String(MAX_NOTE_LENGTH)} characters.`);
      return;
    }
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

  /*
   * Portalled to the body: the panel that opens it sits inside the recording
   * form, where Enter in the date field would otherwise submit the visit.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85dvh] scroll-pb-28 overflow-y-auto rounded-t-2xl border-t border-border bg-background px-4 pt-4 inset-safe-bottom"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-title font-semibold break-words">{title}</p>
          <button type="button" onClick={onClose} className="min-h-11 text-body text-primary">
            Cancel
          </button>
        </div>

        {failure === null ? null : (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
          >
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
            onChange={(event) => {
              setText(event.target.value);
            }}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body"
          />
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
            className="h-12 min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
          />
        </div>

        {editing === null ? null : (
          <button
            type="button"
            disabled={!online || busy}
            onClick={() => {
              setConfirming(true);
            }}
            className="mt-3 min-h-11 text-body font-medium text-interest-low disabled:opacity-60"
          >
            Delete this note
          </button>
        )}

        <div className="sticky bottom-0 -mx-4 mt-4 bg-background/95 px-4 py-3 backdrop-blur">
          {online ? null : (
            <p className="mb-2 text-center text-caption text-foreground-muted">
              {FOLLOW_UP_OFFLINE_NOTE}
            </p>
          )}
          <button
            type="button"
            disabled={busy || !online}
            onClick={submit}
            className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Saving…" : editing === null ? "Save follow-up" : "Save changes"}
          </button>
        </div>
      </div>

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
    </div>,
    document.body,
  );
}
