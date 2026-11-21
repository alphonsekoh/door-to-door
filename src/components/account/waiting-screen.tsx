"use client";

import { signOut, useSession } from "next-auth/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { User } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { useRole } from "@/lib/hooks/use-role";
import { reloadPage } from "@/lib/session/navigate";
import { MAX_NAME_LENGTH, checkOwnName, nameLength } from "@/lib/session/own-name";
import { signOutAndForget } from "@/lib/session/sign-out";

export type WaitingAccount = {
  email: string | null;
  name: string | null;
  approval: "pending" | "blocked";
};

/*
 * The one screen an account nobody has approved may use (#249). Waiting, it
 * can put right the name its Google account gave it, look again, and sign
 * out. Rejected, it can only sign out. Nothing is docked and there is no
 * nav: there is nowhere else to go.
 */
export function WaitingScreen({ account }: { account: WaitingAccount }) {
  const { userId } = useRole();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailure, setSignOutFailure] = useState<string | null>(null);
  const signOutBlock = useRef<HTMLDivElement>(null);
  const signOutFocus = useRefusalFocus();
  const address = account.email ?? "this account";

  /* Brought into view clear of the bottom of the screen, as on Account. */
  useLayoutEffect(() => {
    if (signOutFailure !== null) signOutBlock.current?.scrollIntoView({ block: "nearest" });
  }, [signOutFailure]);

  async function leave(): Promise<void> {
    setSignOutFailure(null);
    setSigningOut(true);
    try {
      await signOutAndForget(signOut, userId);
    } catch {
      setSignOutFailure("Could not sign out. Check your connection and try again.");
      setSigningOut(false);
      signOutFocus.refused();
    }
  }

  const signOutControls = (
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
          void leave();
        }}
        className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );

  if (account.approval === "blocked") {
    return (
      <div className="space-y-6">
        <p className="text-body break-words">
          An admin didn&apos;t approve {address} for Door to Door. If you think that&apos;s a
          mistake, ask an admin.
        </p>
        {signOutControls}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-body break-words">
        An admin needs to approve {address} before you can use Door to Door. You won&apos;t need to
        sign in again: once they have, Check again takes you in.
      </p>

      <NameForm initial={account.name} />

      <div className="space-y-3">
        <button
          type="button"
          onClick={reloadPage}
          className="min-h-12 w-full btn-primary rounded-xl text-body font-semibold"
        >
          Check again
        </button>
        {signOutControls}
      </div>
    </div>
  );
}

/* The name an admin sees on the request, which Google may have got wrong. */
function NameForm({ initial }: { initial: string | null }) {
  const { update } = useSession();
  const [name, setName] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const focus = useRefusalFocus();

  async function save(): Promise<void> {
    setSaved(false);
    const checked = checkOwnName(name);
    if (!checked.ok) {
      setFailure(checked.message);
      return;
    }
    focus.notePress();
    setFailure(null);
    setSaving(true);
    try {
      const updated = await apiFetch<User>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ name: checked.name }),
      });
      setName(updated.name ?? "");
      setSaved(true);
      await update({ name: updated.name }).catch(() => undefined);
    } catch (error) {
      /* Rejected meanwhile: the page says so once it is drawn again. */
      if (error instanceof ApiRequestError && error.code === "account_blocked") {
        reloadPage();
        return;
      }
      setFailure(failureLine(error, "Could not save your name."));
      focus.refused();
    } finally {
      setSaving(false);
    }
  }

  return (
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
        <label htmlFor="waiting-name" className="mb-1 block text-body font-medium">
          Your name
        </label>
        <input
          id="waiting-name"
          value={name}
          autoComplete="name"
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
          className="min-h-12 field"
        />
        <p className="mt-1 text-caption text-foreground-muted">
          The name an admin sees on your request.{" "}
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

      <button
        type="submit"
        disabled={saving}
        className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
      >
        {saving ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}
