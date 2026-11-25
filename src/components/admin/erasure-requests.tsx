"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { UnitNumber } from "@/components/ui/unit-number";
import { ConfirmDialog, SheetPresence } from "@/components/ui/sheet";
import type { ErasureRequest, ErasureRequestList } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import { formatDay } from "@/lib/history/dates";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { eraseBy, isErasureOverdue } from "@/lib/privacy/due";
import { displayName } from "@/lib/teams/team-ui";

const PAGE_SIZE = 50;

type Tab = "open" | "erased";

type State =
  | { status: "loading" }
  | { status: "ready"; list: ErasureRequestList }
  | { status: "error"; message: string };

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "open", label: "Waiting" },
  { id: "erased", label: "Erased" },
];

function subject(request: ErasureRequest) {
  if (request.household !== null && request.block !== null) {
    return (
      <>
        <span className="block text-caption text-foreground-muted">{request.block.name}</span>
        <span className="block text-body font-semibold tabular-nums">
          <UnitNumber value={request.household.unitNumber} />
        </span>
      </>
    );
  }
  return (
    <span className="block text-body font-semibold break-words">
      Account: {displayName(request.account?.name ?? null)}
    </span>
  );
}

/* What the confirmation names: never the household's own name, which may already be gone. */
function called(request: ErasureRequest): string {
  return request.household !== null && request.block !== null
    ? `${request.block.name} ${request.household.unitNumber}`
    : `the account of ${displayName(request.account?.name ?? null)}`;
}

function retentionLine(list: ErasureRequestList): string {
  const run = list.lastRetentionRun;
  if (run === null) {
    return "Retention has never run. Nothing is being erased when its period ends: check the daily job.";
  }
  const households = run.households === 1 ? "1 household" : `${String(run.households)} households`;
  const accounts = run.accounts === 1 ? "1 account" : `${String(run.accounts)} accounts`;
  const signIns = run.signIns === 1 ? "1 sign-in" : `${String(run.signIns)} sign-ins`;
  return `Retention last ran ${formatDay(run.ranAt)}: ${households}, ${accounts}, ${signIns}.`;
}

/*
 * Requests to erase data (#279): waiting, oldest first, each with the date it
 * must be carried out by, and the erased ones for the record. Erasing asks
 * first, since it cannot be undone. A footer says when the retention job last
 * ran, or warns that it never has, so a job that was never set up shows.
 */
export function ErasureRequests() {
  const [tab, setTab] = useState<Tab>("open");
  const [state, setState] = useState<State>({ status: "loading" });
  const [now] = useState(() => new Date());
  const [erasing, setErasing] = useState<ErasureRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ at: string; message: string } | null>(null);
  const failureBlock = useRef<HTMLDivElement>(null);
  const { notePress, refused } = useRefusalFocus();
  /* Only the newest read is drawn: switching tabs while one is out must not
     let its answer land under the other tab (D-28-7). */
  const reads = useRef(0);

  const load = useCallback(async (which: Tab) => {
    reads.current += 1;
    const read = reads.current;
    try {
      const list = await apiFetch<ErasureRequestList>(
        `/erasure-requests?status=${which}&limit=${String(PAGE_SIZE)}`,
      );
      if (read === reads.current) setState({ status: "ready", list });
    } catch (error) {
      if (read === reads.current) {
        setState({
          status: "error",
          message: failureLine(error, "Could not load the requests."),
        });
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(tab), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, tab]);

  useLayoutEffect(() => {
    if (failure !== null) failureBlock.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

  async function erase(request: ErasureRequest): Promise<void> {
    setFailure(null);
    setBusy(true);
    try {
      await apiFetch(`/erasure-requests/${request.id}/erase`, { method: "POST" });
      setErasing(null);
      await load(tab);
    } catch (error) {
      setErasing(null);
      setFailure({ at: request.id, message: failureLine(error, "Could not erase that.") });
      refused();
      /* Another admin got there first, or the retention job: show where it stands. */
      if (error instanceof ApiRequestError && error.status === 409) void load(tab);
    } finally {
      setBusy(false);
    }
  }

  const list = state.status === "ready" ? state.list : null;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Requests" className="flex flex-wrap gap-2">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              if (tab !== id) {
                setState({ status: "loading" });
                setTab(id);
              }
            }}
            className={`${tab === id ? "btn-primary" : "btn-secondary"} min-h-11 flex-1 rounded-lg px-3 text-body font-medium`}
          >
            {label}
          </button>
        ))}
      </div>

      {state.status === "loading" ? (
        <p className="text-body text-foreground-muted">Loading…</p>
      ) : state.status === "error" ? (
        <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body">{state.message}</p>
          <button
            type="button"
            onClick={() => void load(tab)}
            className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
          >
            Try again
          </button>
        </div>
      ) : state.list.data.length === 0 ? (
        <p className="text-body text-foreground-muted">
          {tab === "open" ? "No requests are waiting." : "Nothing has been erased on request."}
        </p>
      ) : (
        <ul className="space-y-2">
          {state.list.data.map((request) => {
            const due = eraseBy(request.requestedAt);
            const overdue = request.erasedAt === null && isErasureOverdue(due, now);
            const failed = failure?.at === request.id;
            return (
              <li key={request.id} className="rounded-xl border border-border bg-surface p-4">
                {subject(request)}
                <p className="mt-1 text-caption text-foreground-muted">
                  Asked {formatDay(request.requestedAt)} · passed on by{" "}
                  {displayName(request.loggedBy.name)}
                </p>
                {request.erasedAt === null ? (
                  <p
                    className={`text-caption ${overdue ? "font-semibold text-danger" : "text-foreground-muted"}`}
                  >
                    Erase by {formatDay(due)}
                    {overdue ? " (overdue)" : ""}
                  </p>
                ) : (
                  <p className="text-caption text-foreground-muted">
                    Erased {formatDay(request.erasedAt)}
                    {request.erasedBy === null
                      ? " by the retention job"
                      : ` by ${displayName(request.erasedBy.name)}`}
                  </p>
                )}
                {request.erasedAt === null ? (
                  <div
                    ref={failed ? failureBlock : null}
                    className="mt-3 scroll-clear-nav space-y-3"
                  >
                    {failed ? (
                      <p role="alert" className="notice-danger">
                        {failure.message}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Erase ${called(request)}`}
                      onClick={() => {
                        notePress();
                        setErasing(request);
                      }}
                      className="min-h-11 w-full btn-danger-outline rounded-lg px-3 text-body font-medium"
                    >
                      Erase…
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {list === null ? null : (
        <p className="scroll-clear-nav text-caption text-foreground-muted">
          {list.pagination.hasMore
            ? `The first ${String(list.data.length)} of ${String(list.pagination.total)} are shown. `
            : ""}
          {retentionLine(list)}
        </p>
      )}

      <SheetPresence>
        {erasing === null ? null : (
          <ConfirmDialog
            title={`Erase ${called(erasing)}?`}
            detail={
              erasing.household === null
                ? "This deletes their name, email, Google link, password and sign-ins, and signs them out. What they recorded stays, under no name. It cannot be undone."
                : "This deletes the name, contact, religion, every visit and every follow-up note. The unit stays. It cannot be undone. Also delete any CSV export that holds this unit."
            }
            confirmLabel="Erase"
            busy={busy}
            onConfirm={() => void erase(erasing)}
            onCancel={() => {
              setErasing(null);
            }}
          />
        )}
      </SheetPresence>
    </div>
  );
}
