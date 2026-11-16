"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";
import type { SignIn, SignInList, User } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { formatDayTime } from "@/lib/history/dates";

const BACK = { href: "/admin/team", label: "Team" };

/* Sign out everywhere, as against one sign-in, which is named by its id. */
const EVERYWHERE = "everywhere";

/* As Account's sign-out says it, for a request that got no answer. */
const NO_ANSWER = "Could not sign out. Check your connection and try again.";

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
  /* From a tap until the list is read again, the list is busy, and the
     control pressed (a sign-in's id, or EVERYWHERE) says it is signing out
     unless that has failed. */
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /*
   * Drawn just above the control pressed, where the admin is looking: at the
   * top of a long list it was off the screen. Not drawn once the list read
   * again no longer has that control, which means it was signed out after
   * all.
   */
  const [failure, setFailure] = useState<{ at: string; message: string } | null>(null);
  /* The failure and the control it is about, scrolled into view together. */
  const failureBlock = useRef<HTMLDivElement>(null);
  /* Only the newest read of the list is shown (D-28-7). */
  const generation = useRef(0);

  /*
   * `keepList` leaves the list as it is when the read fails, as Team keeps its
   * own after a failed change: after an end that failed for want of signal,
   * the read fails too, and the error screen would drop the row and the alert
   * saying why with it.
   */
  const load = useCallback(
    async ({ keepList = false }: { keepList?: boolean } = {}) => {
      const mine = ++generation.current;
      try {
        const [user, signIns] = await Promise.all([
          apiFetch<User>(`/users/${userId}`),
          apiFetch<SignInList>(`/users/${userId}/sign-ins`),
        ]);
        if (mine !== generation.current) return;
        setState({ status: "ready", user, signIns: signIns.data });
      } catch (error) {
        if (mine !== generation.current || keepList) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load this member.",
        });
      }
    },
    [userId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  /* At large text the message and its control can reach below the screen or
     under the nav: brought into view, clear of them, before they are painted.
     Clear of the nav and a banner floating on it, and no further: no Save bar
     docks here (#195, as on Account, D-164-7). */
  useLayoutEffect(() => {
    if (failure !== null) failureBlock.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

  async function end(path: string, pressed: string): Promise<void> {
    setFailure(null);
    setBusy(true);
    setEnding(pressed);
    let failed = false;
    try {
      await apiFetch(path, { method: "DELETE" });
    } catch (error) {
      /* Already ended, on another admin's screen or by its own sign-out:
         what was asked for is done, so the list is simply read again. */
      if (!(error instanceof ApiRequestError && error.status === 404)) {
        failed = true;
        setEnding(null);
        setFailure({
          at: pressed,
          message: error instanceof ApiRequestError ? error.message : NO_ANSWER,
        });
      }
    }
    setConfirming(false);
    /* Busy until the list is read again: a second Sign out meanwhile would act
       on rows that are about to change. Read even after a failure, since an
       end that arrived but lost its answer drops the row. load() never throws. */
    await load({ keepList: failed });
    setEnding(null);
    setBusy(false);
  }

  /* `control`, with the failure about it just above it. */
  const withFailure = (at: string, control: ReactNode, className = "") => {
    const failed = failure?.at === at;
    return (
      <div ref={failed ? failureBlock : null} className={`scroll-clear-nav space-y-3 ${className}`}>
        {failed ? (
          <p role="alert" className="notice-danger">
            {failure.message}
          </p>
        ) : null}
        {control}
      </div>
    );
  };

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
                {signIn.current
                  ? null
                  : withFailure(
                      signIn.id,
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void end(`/users/${userId}/sign-ins/${signIn.id}`, signIn.id)
                        }
                        aria-label={`${ending === signIn.id ? "Signing out" : "Sign out"} ${signIn.device}, last used ${formatDayTime(signIn.lastUsedAt)}`}
                        className="min-h-11 w-full btn-secondary rounded-lg px-3 text-body font-medium"
                      >
                        {ending === signIn.id ? "Signing out…" : "Sign out"}
                      </button>,
                      "mt-3",
                    )}
              </li>
            ))}
          </ul>
        )}

        {others.length === 0
          ? null
          : withFailure(
              EVERYWHERE,
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
              </button>,
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
