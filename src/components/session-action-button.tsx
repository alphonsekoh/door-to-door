"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { OutingSession } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import type { ActionSpec } from "@/lib/sessions";

/*
 * Start, end or reopen, with the refusal spelled out.
 *
 * One active outing at a time is a database constraint, so starting a second
 * one fails at the server. The message it sends back says what to do about it,
 * and this shows that rather than a generic failure.
 */
export function SessionActionButton({
  sessionId,
  spec,
  primary = true,
  onDone,
}: {
  sessionId: string;
  spec: ActionSpec;
  primary?: boolean;
  onDone: (session: OutingSession) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(): Promise<void> {
    setFailure(null);
    setBusy(true);
    try {
      const session = await apiFetch<OutingSession>(`/sessions/${sessionId}/${spec.action}`, {
        method: "POST",
      });
      setConfirming(false);
      onDone(session);
    } catch (error) {
      /* ApiRequestError carries the contract's message, which for a clash
         says how to clear it - keep it rather than a generic apology. */
      setFailure(error instanceof Error ? error.message : "Could not do that.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (spec.confirm === null) {
            void run();
          } else {
            setConfirming(true);
          }
        }}
        className={
          primary
            ? "min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
            : "min-h-11 shrink-0 rounded-lg border border-border px-3 text-body font-medium disabled:opacity-60"
        }
      >
        {busy && !confirming ? "Working…" : spec.label}
      </button>

      {failure === null ? null : (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
        >
          {failure}
        </p>
      )}

      {confirming && spec.confirm !== null ? (
        <ConfirmDialog
          title={spec.label}
          detail={spec.confirm}
          confirmLabel={spec.label}
          busy={busy}
          onConfirm={() => void run()}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : null}
    </>
  );
}
