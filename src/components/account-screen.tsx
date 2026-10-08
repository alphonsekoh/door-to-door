"use client";

import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { User } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { MAX_NAME_LENGTH, checkOwnName } from "@/lib/own-name";
import { signOutAndForget } from "@/lib/sign-out";
import { hasUnsyncedItems } from "@/lib/sw-update";

const ROLE_LABEL = { admin: "Admin", member: "Member" } as const;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

export function AccountScreen() {
  const { update } = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailure, setSignOutFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<User>("/users/me").then(
      (found) => {
        if (cancelled) return;
        setUser(found);
        setName(found.name ?? "");
      },
      (error: unknown) => {
        if (!cancelled) setLoadFailure(messageOf(error, "Could not load your details."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(): Promise<void> {
    setSaved(false);
    const checked = checkOwnName(name);
    if (!checked.ok) {
      setFailure(checked.message);
      return;
    }

    setFailure(null);
    setSaving(true);
    try {
      const updated = await apiFetch<User>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ name: checked.name }),
      });
      setUser(updated);
      setName(updated.name ?? "");
      setSaved(true);
      /* The rename is done; a session that cannot refresh just shows the old
         name until the next sign-in, which is not worth failing the save for. */
      await update({ name: updated.name }).catch(() => undefined);
    } catch (error) {
      setFailure(messageOf(error, "Could not save your name."));
    } finally {
      setSaving(false);
    }
  }

  async function leave(): Promise<void> {
    setSignOutFailure(null);
    setSigningOut(true);
    try {
      await signOutAndForget(signOut);
    } catch {
      setSignOutFailure("Could not sign out. Check your connection and try again.");
      setConfirmingSignOut(false);
      setSigningOut(false);
    }
  }

  async function startSignOut(): Promise<void> {
    /* Unsynced records stay on this phone, so signing out is the moment to
       say they will wait; the member decides. */
    if (await hasUnsyncedItems()) {
      setConfirmingSignOut(true);
      return;
    }
    await leave();
  }

  if (loadFailure !== null) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
      >
        {loadFailure}
      </p>
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
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
          />
          <p className="mt-1 text-caption text-foreground-muted">
            Shown on your records, including earlier ones.
          </p>
        </div>

        {failure === null ? null : (
          <p
            role="alert"
            className="rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
          >
            {failure}
          </p>
        )}
        {saved ? (
          <p
            role="status"
            className="rounded-lg border border-interest-high/40 bg-interest-high/10 px-3 py-2 text-body"
          >
            Name saved.
          </p>
        ) : null}

        <div className="sticky above-nav -mx-4 bg-background/95 px-4 py-3 backdrop-blur">
          <button
            type="submit"
            disabled={saving}
            className="min-h-12 w-full rounded-xl bg-primary text-body font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save name"}
          </button>
        </div>
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

      <div className="space-y-2">
        {signOutFailure === null ? null : (
          <p
            role="alert"
            className="rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
          >
            {signOutFailure}
          </p>
        )}
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            void startSignOut();
          }}
          className="min-h-12 w-full rounded-xl border border-border text-body font-medium disabled:opacity-60"
        >
          {signingOut && !confirmingSignOut ? "Signing out…" : "Sign out"}
        </button>
      </div>

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
    </div>
  );
}
