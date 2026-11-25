"use client";

import { useId, useRef, useState } from "react";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import type { ErasureRequest } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { useFailureInView } from "@/lib/hooks/use-failure-in-view";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { dayInput, requestedAtFor } from "@/lib/privacy/requested";

export type EraseSubject = { kind: "household" | "account"; id: string; label: string };

/* Pass a request on for an admin to carry out, or erase now as the admin. */
export type EraseMode = "pass_on" | "erase";

const COPY = {
  household: {
    erase: {
      title: "Erase this unit's data",
      says: "This deletes the name, contact and religion, every visit and its notes, and every follow-up note, removed ones included. The unit stays, with the date it was erased. It cannot be undone.",
    },
    passOn: {
      title: "Pass on a deletion request",
      says: "An admin will erase what we hold about this unit. Nothing is deleted until they do.",
    },
  },
  account: {
    erase: {
      title: "Erase this account",
      says: "This deletes the name, email, Google link, password and sign-ins, and signs them out everywhere. The visits and notes they recorded stay, under no name. It cannot be undone.",
    },
    passOn: {
      title: "Pass on an account deletion",
      says: "An admin will erase this account. Nothing is deleted until they do.",
    },
  },
} as const;

const NO_ANSWER = "Could not send that. Check your connection and try again.";

/*
 * The one sheet behind every way to ask for, or carry out, an erasure
 * (#279). The date is when the person asked, today unless they said earlier:
 * it starts the clock on the admin's deadline. Erasing logs the request and
 * carries it out in two calls, so the request record always exists; if the
 * second fails the first stands, an open request an admin can finish.
 */
export function EraseSheet({
  subject,
  mode,
  onClose,
  onDone,
}: {
  subject: EraseSubject;
  mode: EraseMode;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [today] = useState(() => new Date());
  const [day, setDay] = useState(() => dayInput(today));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const sending = useRef(false);
  const { notePress, refused } = useRefusalFocus();
  const failureSaid = useFailureInView<HTMLParagraphElement>(failure);
  const dateId = useId();

  const erasing = mode === "erase";
  const copy = COPY[subject.kind][erasing ? "erase" : "passOn"];

  async function submit(): Promise<void> {
    if (sending.current) return;
    const requestedAt = requestedAtFor(day, today);
    if (requestedAt === null) {
      setFailure("Choose the day they asked.");
      return;
    }
    notePress();
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const request = await apiFetch<ErasureRequest>("/erasure-requests", {
        method: "POST",
        body: JSON.stringify({
          kind: subject.kind,
          id: subject.id,
          ...(requestedAt === undefined ? {} : { requestedAt }),
        }),
      });
      if (erasing) {
        await apiFetch(`/erasure-requests/${request.id}/erase`, { method: "POST" });
      }
      onDone(erasing ? "Erased." : "Passed on. An admin will erase it.");
    } catch (error) {
      setFailure(failureLine(error, NO_ANSWER));
      refused();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Sheet label={`${copy.title}, ${subject.label}`} title={copy.title} onClose={onClose}>
      <p className="mt-2 text-body font-medium">{subject.label}</p>
      <p className="mt-2 text-body text-foreground-muted">{copy.says}</p>
      {erasing && subject.kind === "household" ? (
        <p className="mt-2 text-body text-foreground-muted">
          Also delete any CSV export of All records that holds this unit: the app cannot reach those
          files.
        </p>
      ) : null}

      <div className="mt-3">
        <label htmlFor={dateId} className="mb-1 block text-body font-medium">
          When they asked
        </label>
        <input
          id={dateId}
          type="date"
          value={day}
          max={dayInput(today)}
          onChange={(event) => {
            setDay(event.target.value);
          }}
          className="min-h-12 field"
        />
      </div>

      {failure === null ? null : (
        <p ref={failureSaid} role="alert" className="mt-3 notice-danger">
          {failure}
        </p>
      )}

      <SheetActions>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className={`${erasing ? "btn-danger" : "btn-primary"} min-h-14 w-full rounded-xl text-title font-semibold`}
        >
          {busy ? "Working…" : erasing ? "Erase" : "Pass it on"}
        </button>
      </SheetActions>
    </Sheet>
  );
}
