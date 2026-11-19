"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { OutingSession } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import type { ActionSpec } from "@/lib/session/sessions";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";

type Failure = {
  line: string;
  /* Said for a 409, until the re-read it set off turns the button into
     another action: the one change the failure is kept through. */
  awaitsMove: boolean;
};

/*
 * Start, end or reopen, with the refusal spelled out.
 *
 * One active session at a time is a database constraint, so starting a second
 * one fails at the server. The message it sends back says what to do about it,
 * and this shows that rather than a generic failure.
 *
 * A failure is said under the button and brought into view with it: near the
 * foot of the Sessions list it landed under the nav (#213).
 *
 * A 409 means the session moved under this screen, ended or started by
 * another admin, so the screen reads it again through `onStale` rather than
 * go on offering End beside "has already ended" (#226). The sentence stays
 * through the change that re-read brings, since it names the state the
 * screen then shows.
 */
export function SessionActionButton({
  sessionId,
  spec,
  primary = true,
  blocked = null,
  onDone,
  onStale,
}: {
  sessionId: string;
  spec: ActionSpec;
  primary?: boolean;
  /* Why the server would refuse it now, said beside it instead of offered. */
  blocked?: string | null;
  onDone: (session: OutingSession) => void;
  onStale: () => void;
}) {
  const blockedId = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const pressed = useRef<HTMLButtonElement>(null);
  const said = useRef<HTMLParagraphElement>(null);
  /* Noted on this button, never on End's confirm, which leaves with its
     dialog: End then ends here too, where D-90-9 returns focus. Above the
     scrolls, which come after focus is back (D-208-4). */
  const { notePress, refused } = useRefusalFocus();

  /* The button outlives a change of its action (D-226-2); what it said or
     opened for the old one does not, as when it was keyed by its action. A
     poll that turned Reopen back into End brought back End's confirm, and
     "has already ended" under it. Only the 409's own re-read keeps the
     failure, once: that sentence names the state it shows. */
  const [actionShown, setActionShown] = useState(spec.action);
  if (actionShown !== spec.action) {
    setActionShown(spec.action);
    setConfirming(false);
    setFailure(failure?.awaitsMove === true ? { line: failure.line, awaitsMove: false } : null);
  }

  /*
   * Before it is painted, clear of the nav and a banner floating on it, and
   * no further: no Save docks where this is (D-195-1). The alert takes no
   * focus (D-164-1). Not one block around both, as on the member page: on the list
   * that block holds the title beside the button, and at the largest text it
   * outgrew the screen and left the alert's end under the nav. The alert's
   * end, then the button's top, land where a block of just the two would,
   * the button winning where even they cannot fit.
   *
   * Again when a 409's re-read turns the button into another action, which
   * keeps the failure as a new one: the re-read redraws the row or page
   * around it, and on a session's page an ended summary lands above it
   * (D-226-4).
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
      /* Only a 409 says the session moved. After a network failure the
         re-read would most likely fail too, swapping the screen for its load
         error. */
      const moved = error instanceof ApiRequestError && error.status === 409;
      setFailure({ line: failureLine(error, "Could not do that."), awaitsMove: moved });
      setConfirming(false);
      refused();
      if (moved) onStale();
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
          notePress();
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
          {failure.line}
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
