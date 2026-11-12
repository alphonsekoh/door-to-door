"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";
import type { SignIn, SignInList, User } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { formatDayTime } from "@/lib/history/dates";

const BACK = { href: "/admin/team", label: "Team" };

/* Sign out everywhere, as against one sign-in, which is named by its id. */
const EVERYWHERE = "everywhere";

type State =
  | { status: "loading" }
  | { status: "ready"; user: User; signIns: SignIn[] }
  | { status: "error"; message: string };

/*
 * One member, for an admin: where they are signed in, and a way to end any
 * of those sign-ins or all of them (#125). Members never see this list,
 * their own included.
 *
 * Ending one needs no confirmation: it costs the member one sign-in on one
 * phone, and the row says which. Ending all of them asks first.
 */
export function MemberDetail({ userId }: { userId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  /* What was pressed, from the tap until the list is read again: a sign-in's
     id, or EVERYWHERE. That control says so, and the list is busy. */
  const [ending, setEnding] = useState<string | null>(null);
  const busy = ending !== null;
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Only the newest read of the list is shown (D-28-7). */
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const [user, signIns] = await Promise.all([
        apiFetch<User>(`/users/${userId}`),
        apiFetch<SignInList>(`/users/${userId}/sign-ins`),
      ]);
      if (mine !== generation.current) return;
      setState({ status: "ready", user, signIns: signIns.data });
    } catch (error) {
      if (mine !== generation.current) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load this member.",
      });
    }
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  async function end(path: string, pressed: string): Promise<void> {
    setFailure(null);
    setEnding(pressed);
    try {
      await apiFetch(path, { method: "DELETE" });
    } catch (error) {
      /* Already ended, on another admin's screen or by its own sign-out:
         what was asked for is done, so the list is simply read again. */
      if (!(error instanceof ApiRequestError && error.status === 404)) {
        setFailure(error instanceof Error ? error.message : "Could not sign that out.");
      }
    }
    setConfirming(false);
    /* Busy until the list is read again: a second Sign out meanwhile would act
       on rows that are about to change. load() never throws. */
    await load();
    setEnding(null);
  }

  if (state.status === "loading") {
    return (
      <>
        <PageHeader title="Member" back={BACK} />
        <p className="text-body text-foreground-muted">Loading…</p>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <PageHeader title="Member" back={BACK} />
        <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  const { user, signIns } = state;
  const self = signIns.some((signIn) => signIn.current);
  const others = signIns.filter((signIn) => !signIn.current);
  const name = user.name ?? user.email;

  return (
    <>
      <PageHeader title={name} subtitle={user.name === null ? undefined : user.email} back={BACK} />

      <section aria-labelledby="sign-ins-heading" className="space-y-3">
        <h2 id="sign-ins-heading" className="text-title font-semibold">
          Signed in on
        </h2>

        {failure === null ? null : (
          <p role="alert" className="notice-danger">
            {failure}
          </p>
        )}

        {user.deactivatedAt !== null ? (
          <p className="text-body text-foreground-muted">Deactivated, so signed out everywhere.</p>
        ) : signIns.length === 0 ? (
          <p className="text-body text-foreground-muted">Not signed in anywhere.</p>
        ) : (
          <ul aria-busy={busy} className="space-y-2">
            {signIns.map((signIn) => (
              <li key={signIn.id} className="rounded-xl border border-border bg-surface p-4">
                {/* At large text the tag drops under the device rather than
                    squeeze it. */}
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-body font-semibold">{signIn.device}</span>
                  {signIn.current ? (
                    <span className="rounded-md border border-interest-high bg-interest-high/20 px-2 py-0.5 text-caption font-medium">
                      This phone
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-caption text-foreground-muted">
                  Signed in {formatDayTime(signIn.signedInAt)}
                </p>
                <p className="text-caption text-foreground-muted">
                  Last used {formatDayTime(signIn.lastUsedAt)}
                </p>
                {/* Your own phone is signed out from Account, which also
                    clears what it holds. */}
                {signIn.current ? null : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void end(`/users/${userId}/sign-ins/${signIn.id}`, signIn.id)}
                    aria-label={`${ending === signIn.id ? "Signing out" : "Sign out"} ${signIn.device}, last used ${formatDayTime(signIn.lastUsedAt)}`}
                    className="mt-3 min-h-11 w-full btn-secondary rounded-lg px-3 text-body font-medium"
                  >
                    {ending === signIn.id ? "Signing out…" : "Sign out"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {others.length === 0 ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
            className="min-h-12 w-full btn-danger-outline rounded-xl text-body font-medium"
          >
            {ending === EVERYWHERE
              ? "Signing out…"
              : self
                ? "Sign out other devices"
                : "Sign out everywhere"}
          </button>
        )}
      </section>

      <SheetPresence>
        {confirming ? (
          <ConfirmDialog
            title={self ? "Sign out your other devices?" : `Sign ${name} out everywhere?`}
            detail={
              self
                ? "You'll need to sign in again on each of them. Records not yet sent stay on those phones."
                : "They'll need to sign in again on every phone. Records not yet sent stay on those phones."
            }
            confirmLabel={self ? "Sign out other devices" : "Sign out everywhere"}
            busy={busy}
            onConfirm={() => void end(`/users/${userId}/sign-ins`, EVERYWHERE)}
            onCancel={() => {
              setConfirming(false);
            }}
          />
        ) : null}
      </SheetPresence>
    </>
  );
}
