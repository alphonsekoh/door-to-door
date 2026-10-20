"use client";

import { useCallback, useEffect, useState } from "react";
import { BlockCard } from "@/components/block-card";
import { useLocalCopyWriter } from "@/components/local-copy-writer";
import { OutingTeam } from "@/components/outing-team";
import type { ActiveSession } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";

/* Long enough not to drain a phone, short enough that a block added
 * mid-outing appears without anyone being told to refresh. */
const POLL_INTERVAL_MS = 30_000;

type State =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; data: ActiveSession }
  | { status: "error"; message: string };

export function ActiveSessionScreen() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  /* Tells the team card to re-read along with every load. */
  const [tick, setTick] = useState(0);

  const { noteOuting } = useLocalCopyWriter();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await apiFetch<ActiveSession>("/sessions/active");
      setState({ status: "ready", data });
      setTick((current) => current + 1);
    } catch (error) {
      // No active session is an ordinary state, not a failure.
      if (error instanceof ApiRequestError && error.status === 404) {
        setState({ status: "none" });
      } else {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load the session.",
        });
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    /*
     * Deferred rather than called inline: load() sets state, and React warns
     * that doing so synchronously inside an effect triggers a cascading render.
     */
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(true), POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);

  /* Each answer goes into the offline copy; a failure says nothing about
     the outing, so it changes nothing there. */
  useEffect(() => {
    if (state.status === "ready") noteOuting(state.data);
    else if (state.status === "none") noteOuting(null);
  }, [state, noteOuting]);

  if (state.status === "loading") {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  if (state.status === "error") {
    return (
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
    );
  }

  if (state.status === "none") {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
        <p className="text-body font-medium">No session is running.</p>
        <p className="mt-1 text-body text-foreground-muted">
          An admin starts a session before you can record visits.
        </p>
      </div>
    );
  }

  const { session, blocks } = state.data;

  return (
    <div className="space-y-4">
      {/* Wraps at large text sizes, so the title is not squeezed into a
          one-word column beside Refresh. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-body font-medium break-words">{session.title}</p>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-caption font-medium"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
          <p className="text-body font-medium">No blocks yet.</p>
          <p className="mt-1 text-body text-foreground-muted">
            An admin can add blocks while the session is running — refresh to see them.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {blocks.map((entry) => (
            <BlockCard key={entry.block.id} entry={entry} />
          ))}
        </ul>
      )}

      <OutingTeam sessionId={session.id} tick={tick} />
    </div>
  );
}
