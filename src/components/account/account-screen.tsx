"use client";

import { DockedActions } from "@/components/ui/docked-actions";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { User } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { MAX_NAME_LENGTH, checkOwnName, nameLength } from "@/lib/session/own-name";
import { signOutAndForget } from "@/lib/session/sign-out";
import { hasUnsyncedItems } from "@/lib/pwa/sw-update";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { useRole } from "@/lib/hooks/use-role";
import { loadCurrentUser, noteSavedUser } from "@/lib/session/users";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";
import { useSyncQueue } from "@/components/sync/sync-provider";

const ROLE_LABEL = { admin: "Admin", member: "Member" } as const;

export function AccountScreen() {
  const { update } = useSession();
  const { userId } = useRole();
  /* A session refresh that fails for want of signal reads as signed out for
     the rest of the page load; the queue still knows whose records it holds. */
  const { ownerId } = useSyncQueue();
  const [user, setUser] = useState<User | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  // The session is no longer valid: signing out is the only thing left to offer.
  const [staleSession, setStaleSession] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailure, setSignOutFailure] = useState<string | null>(null);
  /* The failure and Sign out, scrolled into view together. */
  const signOutBlock = useRef<HTMLDivElement>(null);
  /* Noted on Sign out, never on Sign out anyway, which leaves with its
     dialog: both paths end on Sign out, where D-90-9 returns focus too. */
  const signOutFocus = useRefusalFocus();
  const nameFocus = useRefusalFocus();

  useEffect(() => {
    let cancelled = false;
    loadCurrentUser().then(
      (found) => {
        if (cancelled) return;
        setUser(found);
        setName(found.name ?? "");
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadFailure(failureLine(error, "Could not load your details."));
        setStaleSession(
          error instanceof ApiRequestError &&
            (error.status === 401 || error.code === "account_deactivated"),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /* Drawn above Sign out at the end of the page, the failure pushed it under
     the nav on an iPhone 13, and below the screen at large text (#164): the
     two are brought into view, clear of the nav, before they are painted.
     Not as a second try clears it: Sign out is under the member's thumb. */
  useLayoutEffect(() => {
    if (signOutFailure !== null) signOutBlock.current?.scrollIntoView({ block: "nearest" });
  }, [signOutFailure]);

  async function save(): Promise<void> {
    setSaved(false);
    const checked = checkOwnName(name);
    if (!checked.ok) {
      setFailure(checked.message);
      return;
    }

    nameFocus.notePress();
    setFailure(null);
    setSaving(true);
    try {
      const updated = await apiFetch<User>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ name: checked.name }),
      });
      noteSavedUser(updated);
      setUser(updated);
      setName(updated.name ?? "");
      setSaved(true);
      /* The rename is done; a session that cannot refresh just shows the old
         name until the next sign-in, which is not worth failing the save for. */
      await update({ name: updated.name }).catch(() => undefined);
    } catch (error) {
      setFailure(failureLine(error, "Could not save your name."));
      nameFocus.refused();
    } finally {
      setSaving(false);
    }
  }

  async function leave(): Promise<void> {
    setSignOutFailure(null);
    setSigningOut(true);
    try {
      await signOutAndForget(signOut, userId ?? ownerId);
    } catch {
      setSignOutFailure("Could not sign out. Check your connection and try again.");
      setConfirmingSignOut(false);
      setSigningOut(false);
      signOutFocus.refused();
    }
  }

  async function startSignOut(): Promise<void> {
    /* Unsynced records stay on this phone, so signing out is the moment to
       say they will wait; the member decides. Held and stopped ones count
       too: they are still this member's unsent work. */
    if (await hasUnsyncedItems(userId)) {
      setConfirmingSignOut(true);
      return;
    }
    await leave();
  }

  const signOutControls = (
    <>
      <div ref={signOutBlock} className="scroll-clear-nav space-y-2">
        {signOutFailure === null ? null : (
          <p role="alert" className="notice-danger">
            {signOutFailure}
          </p>
        )}
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            signOutFocus.notePress();
            void startSignOut();
          }}
          className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
        >
          {signingOut && !confirmingSignOut ? "Signing out…" : "Sign out"}
        </button>
      </div>

      <SheetPresence>
        {confirmingSignOut ? (
          <ConfirmDialog
            title="Sign out with unsynced records?"
            detail="Some records on this phone have not reached the server yet. They will wait here until you sign in again."
            confirmLabel="Sign out anyway"
            busy={signingOut}
            onConfirm={() => {
              void leave();
            }}
            onCancel={() => {
              setConfirmingSignOut(false);
            }}
          />
        ) : null}
      </SheetPresence>
    </>
  );

  if (loadFailure !== null) {
    const alert = (
      <p role="alert" className="notice-danger">
        {loadFailure}
      </p>
    );
    return staleSession ? (
      <div className="space-y-4">
        {alert}
        {signOutControls}
      </div>
    ) : (
      alert
    );
  }
  if (user === null) {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
        aria-label="Display name"
        className="space-y-3"
      >
        <div>
          <label htmlFor="own-name" className="mb-1 block text-body font-medium">
            Your name
          </label>
          <input
            id="own-name"
            value={name}
            autoComplete="name"
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            className="min-h-12 field"
          />
          <p className="mt-1 text-caption text-foreground-muted">
            Shown on your records, including earlier ones.{" "}
            <span aria-live="polite">
              {nameLength(name.trim())} of {MAX_NAME_LENGTH}
            </span>
          </p>
        </div>

        {failure === null ? null : (
          <p role="alert" className="notice-danger">
            {failure}
          </p>
        )}
        {saved ? (
          <p role="status" className="notice-success">
            Name saved.
          </p>
        ) : null}

        <DockedActions>
          <button
            type="submit"
            disabled={saving}
            className="min-h-12 w-full btn-primary rounded-xl text-body font-semibold"
          >
            {saving ? "Saving…" : "Save name"}
          </button>
        </DockedActions>
      </form>

      <dl className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div>
          <dt className="text-caption text-foreground-muted">Email</dt>
          <dd className="text-body break-all">{user.email}</dd>
        </div>
        <div>
          <dt className="text-caption text-foreground-muted">Role</dt>
          <dd className="text-body">{ROLE_LABEL[user.role]}</dd>
        </div>
      </dl>

      {signOutControls}
    </div>
  );
}
