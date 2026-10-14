"use client";

import { signOut } from "next-auth/react";
import { useEffect, useId, useRef, useState } from "react";
import type { AuthFailure } from "@/lib/account-state";
import { goTo } from "@/lib/navigate";
import { signOutAndForget } from "@/lib/sign-out";
import { hasUnsyncedItems } from "@/lib/sw-update";

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
 */
export function AuthFailureScreen({ kind }: { kind: AuthFailure }) {
  const copy = COPY[kind];
  const headingId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unsynced, setUnsynced] = useState(false);

  useEffect(() => {
    button.current?.focus();
  }, []);

  /* The shell makes the app inert, but a sheet portalled to the body sits
     outside it and would still take focus behind this screen. */
  useEffect(() => {
    const others = [...document.body.children].filter(
      (element) => !element.contains(root.current) && !element.hasAttribute("inert"),
    );
    for (const element of others) element.setAttribute("inert", "");
    return () => {
      for (const element of others) element.removeAttribute("inert");
    };
  }, []);

  /* #33: the queue will answer this for real. Its records stay on the phone
     through a sign-out, so the member is told rather than asked. */
  useEffect(() => {
    void hasUnsyncedItems().then(setUnsynced);
  }, []);

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
      ref={root}
      className="fixed inset-0 z-70 overflow-y-auto bg-background pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className="mx-auto flex min-h-full w-full max-w-screen-sm flex-col justify-center gap-4 px-6">
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
          <p
            role="alert"
            className="rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
          >
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
          className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Signing out…" : copy.action}
        </button>
      </div>
    </div>
  );
}
