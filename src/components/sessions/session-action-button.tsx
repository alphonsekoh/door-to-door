"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { OutingSession } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import type { ActionSpec } from "@/lib/session/sessions";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";

/*
 * Start, end or reopen, with the refusal spelled out.
 *
 * One active session at a time is a database constraint, so starting a second
 * one fails at the server. The message it sends back says what to do about it,
 * and this shows that rather than a generic failure.
 *
 * A failure is said under the button and brought into view with it: near the
 * foot of the Sessions list it landed under the nav (#213).
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
  const pressed = useRef<HTMLButtonElement>(null);
  const said = useRef<HTMLParagraphElement>(null);

  /*
   * Before it is painted, clear of the nav and a banner floating on it, and
   * no further: no Save docks where this is (D-195-1). Focus stays put
   * (D-164-1). Not one block around both, as on the member page: on the list
   * that block holds the title beside the button, and at the largest text it
   * outgrew the screen and left the alert's end under the nav. The alert's
   * end, then the button's top, land where a block of just the two would,
   * the button winning where even they cannot fit.
   */
  useLayoutEffect(() => {
    if (failure === null) return;
    said.current?.scrollIntoView({ block: "nearest" });
    pressed.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

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
      setFailure(failureLine(error, "Could not do that."));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={pressed}
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
        className={`scroll-clear-nav ${spec.destructive ? "btn-danger-outline" : primary ? "btn-primary" : "btn-secondary"} ${
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
        <p ref={said} role="alert" className="mt-2 basis-full scroll-clear-nav notice-danger">
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
