"use client";

import { useId, useState } from "react";
import type { OutingSession } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import type { ActionSpec } from "@/lib/session/sessions";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";

/*
 * Start, end or reopen, with the refusal spelled out.
 *
 * One active session at a time is a database constraint, so starting a second
 * one fails at the server. The message it sends back says what to do about it,
 * and this shows that rather than a generic failure.
 */
export function SessionActionButton({
  sessionId,
  spec,
  primary = true,
  blocked = null,
  onDone,
}: {
  sessionId: string;
  spec: ActionSpec;
  primary?: boolean;
  /* Why the server would refuse it now, said beside it instead of offered. */
  blocked?: string | null;
  onDone: (session: OutingSession) => void;
}) {
  const blockedId = useId();
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
        disabled={busy || blocked !== null}
        aria-describedby={blocked === null ? undefined : blockedId}
        onClick={() => {
          if (spec.confirm === null) {
            void run();
          } else {
            setConfirming(true);
          }
        }}
        className={`${spec.destructive ? "btn-danger-outline" : primary ? "btn-primary" : "btn-secondary"} ${
          primary
            ? "min-h-14 w-full rounded-xl text-title font-semibold"
            : "min-h-11 rounded-lg px-3 text-body font-medium"
        }`}
      >
        {busy && !confirming ? "Working…" : spec.label}
      </button>

      {blocked === null ? null : (
        <p id={blockedId} className="mt-2 basis-full text-caption text-foreground-muted">
          {blocked}
        </p>
      )}
      {/* A row of its own when the button sits beside a title. */}
      {failure === null ? null : (
        <p role="alert" className="mt-2 basis-full notice-danger">
          {failure}
        </p>
      )}

      <SheetPresence>
        {confirming && spec.confirm !== null ? (
          <ConfirmDialog
            tone={spec.destructive ? "destructive" : "default"}
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
      </SheetPresence>
    </>
  );
}
