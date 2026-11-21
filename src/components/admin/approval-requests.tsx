"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";
import type { User, UserList } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { formatDay } from "@/lib/history/dates";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { approvalCount } from "@/lib/session/approval-count";

const PAGE_SIZE = 100;

export type ApprovalChange = "approved" | "rejected" | "unblocked" | "stale";

type Queue = "pending" | "blocked";

type State =
  { status: "loading" } | { status: "ready"; users: User[]; total: number } | { status: "error" };

const COPY = {
  pending: {
    heading: "Waiting for approval",
    failed: "Could not check who is waiting for approval.",
  },
  blocked: {
    heading: "Not approved",
    failed: "Could not check who wasn't approved.",
  },
} as const;

const named = (user: User) => user.name ?? "No name given";
/* For a control's name and the Reject question: Google names two people
   alike as readily as it leaves them unnamed, so the address goes too. */
const called = (user: User) => (user.name === null ? user.email : `${user.name} (${user.email})`);

/*
 * The people who asked to join with Google and wait for an admin, or whom an
 * admin turned down (#249), on Admin > Team. Hidden while there are none.
 * Approving and unblocking are one tap, as they are undone by rejecting and
 * by rejecting again; rejecting is asked about first, as it shuts the person
 * out. `version` is bumped by Team when a change elsewhere moved someone into
 * this list, and `onChanged` tells it about a change made here.
 */
export function ApprovalRequests({
  approval,
  version,
  onChanged,
}: {
  approval: Queue;
  version: number;
  onChanged: (change: ApprovalChange) => void;
}) {
  const copy = COPY[approval];
  const headingId = useId();
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<User | null>(null);
  const [failure, setFailure] = useState<{ at: string; message: string } | null>(null);
  const failureBlock = useRef<HTMLDivElement>(null);
  const { notePress, refused } = useRefusalFocus();
  /* Only the latest read is drawn: a change reloads while an earlier read
     may still be out. */
  const reads = useRef(0);

  const load = useCallback(async () => {
    reads.current += 1;
    const read = reads.current;
    try {
      const page = await apiFetch<UserList>(
        `/users?approval=${approval}&limit=${String(PAGE_SIZE)}`,
      );
      if (read !== reads.current) return;
      setState({ status: "ready", users: page.data, total: page.pagination.total });
      /* The Admin tab's badge follows what Team last saw. */
      if (approval === "pending") approvalCount.set(page.pagination.total);
    } catch {
      if (read !== reads.current) return;
      setState({ status: "error" });
    }
  }, [approval]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, version]);

  /* In view clear of the nav before it is painted, as on the team list. */
  useLayoutEffect(() => {
    if (failure !== null) failureBlock.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

  async function act(user: User, action: "approve" | "reject" | "unblock"): Promise<void> {
    setFailure(null);
    setBusy(true);
    try {
      await apiFetch(`/users/${user.id}/${action}`, { method: "POST" });
      setRejecting(null);
      await load();
      onChanged(action === "approve" ? "approved" : action === "reject" ? "rejected" : "unblocked");
    } catch (error) {
      setFailure({ at: user.id, message: failureLine(error, "Could not make that change.") });
      setRejecting(null);
      refused();
      /* Another admin got there first: show where everyone now stands. */
      if (error instanceof ApiRequestError && error.status === 409) {
        void load();
        onChanged("stale");
      }
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") return null;

  if (state.status === "error") {
    return <p className="text-caption text-foreground-muted">{copy.failed}</p>;
  }

  /* A refusal about someone no longer listed is said at the top instead,
     rather than going with their row. */
  const orphaned = failure !== null && !state.users.some((user) => user.id === failure.at);
  if (state.users.length === 0 && !orphaned) return null;

  const failureLineFor = (at: string | null) =>
    failure !== null && (at === null ? orphaned : failure.at === at) ? (
      <p role="alert" className="notice-danger">
        {failure.message}
      </p>
    ) : null;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="text-title font-semibold">
        {copy.heading} ({state.total})
      </h2>
      {orphaned ? (
        <div ref={failureBlock} className="scroll-clear-nav">
          {failureLineFor(null)}
        </div>
      ) : null}

      <ul className="space-y-2">
        {state.users.map((user) => {
          const failed = failure?.at === user.id;
          return (
            <li key={user.id} className="rounded-xl border border-border bg-surface p-4">
              {/* Wrapped, never cut: the end of a long address is its
                  domain, what tells a gmail.com account from a Workspace
                  one, and cut short two requests read the same. */}
              <span className="block text-body font-semibold break-words">{named(user)}</span>
              <span className="block text-caption break-words text-foreground-muted">
                {user.email}
              </span>
              <p className="mt-1 text-caption text-foreground-muted">
                Asked {formatDay(user.createdAt)}
              </p>

              <div ref={failed ? failureBlock : null} className="mt-3 scroll-clear-nav space-y-3">
                {failureLineFor(user.id)}
                <div className="flex flex-wrap gap-2">
                  {approval === "pending" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Approve ${called(user)}`}
                        onClick={() => {
                          notePress();
                          void act(user, "approve");
                        }}
                        className="min-h-11 min-w-fit flex-1 btn-primary rounded-lg px-3 text-body font-medium"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Reject ${called(user)}`}
                        onClick={() => {
                          notePress();
                          setRejecting(user);
                        }}
                        className="min-h-11 min-w-fit flex-1 btn-secondary rounded-lg px-3 text-body font-medium"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Unblock ${called(user)}`}
                      onClick={() => {
                        notePress();
                        void act(user, "unblock");
                      }}
                      className="min-h-11 min-w-fit flex-1 btn-secondary rounded-lg px-3 text-body font-medium"
                    >
                      Unblock
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {state.total > state.users.length ? (
        <p className="text-caption text-foreground-muted">
          The oldest {state.users.length} of {state.total} are shown.
        </p>
      ) : null}

      <SheetPresence>
        {rejecting === null ? null : (
          <ConfirmDialog
            title={`Reject ${called(rejecting)}?`}
            detail="They won't be able to use the app or ask again. You can unblock them under Not approved."
            confirmLabel="Reject"
            busy={busy}
            onConfirm={() => void act(rejecting, "reject")}
            onCancel={() => {
              setRejecting(null);
            }}
          />
        )}
      </SheetPresence>
    </section>
  );
}
