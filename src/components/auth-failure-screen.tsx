"use client";

import { signOut } from "next-auth/react";
import { useEffect, useId, useRef, useState } from "react";
import type { AuthFailure } from "@/lib/account-state";
import { goTo } from "@/lib/navigate";
import { signOutAndForget } from "@/lib/sign-out";
import { useModal } from "@/lib/use-modal";
import { hasUnsyncedItems } from "@/lib/sw-update";
import { useRole } from "@/lib/use-role";

const COPY = {
  deactivated: {
    heading: "Account deactivated",
    body: "This account has been deactivated. Ask an admin.",
    action: "Sign out",
    destination: "/sign-in",
  },
  "signed-out": {
    heading: "Signed out",
    body: "You've been signed out.",
    action: "Sign in again",
    destination: "/sign-in?reason=signed-out",
  },
} as const;

/*
 * Replaces every screen once the server stops accepting this session. Nothing
 * underneath can succeed again, so there is no Try again and no way to
 * dismiss it: signing out is the only way forward, and it also clears the
 * cookie a deleted account leaves behind.
 *
 * Opaque and above every sheet and dialog, so no stale form shows through.
 * A blocking modal: Escape does nothing, and a sheet open underneath or opened
 * later cannot take focus from it.
 */
export function AuthFailureScreen({ kind }: { kind: AuthFailure }) {
  const copy = COPY[kind];
  const headingId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const { overlay, panel } = useModal(null, button);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unsynced, setUnsynced] = useState(false);
  const { userId } = useRole();

  /* The button was disabled while signing out, and a browser drops focus
     from a disabled control; put it back for the retry. */
  useEffect(() => {
    if (failed) button.current?.focus();
  }, [failed]);

  /* The queue's records stay on the phone through a sign-out, so the member
     is told rather than asked (D-85-9). */
  useEffect(() => {
    void hasUnsyncedItems(userId).then(setUnsynced);
  }, [userId]);

  async function leave(): Promise<void> {
    setFailed(false);
    setBusy(true);
    try {
      await signOutAndForget(signOut, goTo, copy.destination);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div
      ref={overlay}
      className="fixed inset-0 z-70 overflow-y-auto bg-background pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="mx-auto flex min-h-full w-full max-w-screen-sm flex-col justify-center gap-4 px-6 focus:outline-none"
      >
        <h1 id={headingId} className="text-title font-semibold">
          {copy.heading}
        </h1>
        <p className="text-body">{copy.body}</p>
        {unsynced ? (
          <p className="text-body text-foreground-muted">
            Records not yet sent are kept on this phone.
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="notice-danger">
            Could not sign out. Try again.
          </p>
        ) : null}
        <button
          ref={button}
          type="button"
          disabled={busy}
          onClick={() => {
            void leave();
          }}
          className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
        >
          {busy ? "Signing out…" : copy.action}
        </button>
      </div>
    </div>
  );
}
