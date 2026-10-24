"use client";

import { useCallback, useEffect, useState } from "react";
import { BlockCard } from "@/components/blocks/block-card";
import { RevisitList } from "@/components/follow-ups/revisit-list";
import { KindBadge } from "@/components/sessions/kind-badge";
import { useLocalCopyWriter } from "@/components/sync/local-copy-writer";
import { OutingTeam } from "@/components/teams/outing-team";
import { HintCard } from "@/components/ui/hint-card";
import { PageHeader } from "@/components/ui/page-header";
import type { ActiveSession } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { useRole } from "@/lib/hooks/use-role";

/* Long enough not to drain a phone, short enough that a block added
 * mid-session appears without anyone being told to refresh. */
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
     the session, so it changes nothing there. */
  useEffect(() => {
    if (state.status === "ready") noteOuting(state.data);
    else if (state.status === "none") noteOuting(null);
  }, [state, noteOuting]);

  /* The instruction depends on the kind of session, so it is said only
     once the session is known. */
  const header = (
    <PageHeader
      title="Active session"
      subtitle={
        state.status !== "ready"
          ? undefined
          : state.data.session.kind === "follow_up"
            ? "Tap a household to record your visit."
            : "Pick a block to start recording."
      }
    />
  );

  return (
    <>
      {header}
      {state.status === "loading" ? (
        <p className="text-body text-foreground-muted">Loading…</p>
      ) : (
        <SessionBody state={state} load={load} refreshing={refreshing} tick={tick} />
      )}
    </>
  );
}

function SessionBody({
  state,
  load,
  refreshing,
  tick,
}: {
  state: Exclude<State, { status: "loading" }>;
  load: (isRefresh?: boolean) => Promise<void>;
  refreshing: boolean;
  tick: number;
}) {
  const { isAdmin } = useRole();

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
  const followUp = session.kind === "follow_up";

  return (
    <div className="space-y-4">
      {/* Wraps at large text sizes, so the title is not squeezed into a
          one-word column beside Refresh. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-body font-medium break-words">
          {session.title} <KindBadge kind={session.kind} />
        </p>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-caption font-medium"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {followUp ? (
        <>
          {/* Two lines at phone width, and the hint under the list: on a
              first visit both above it pushed the first household below
              the fold. */}
          <p className="notice-info">
            <span className="font-semibold">Follow-up session.</span> Visits can be recorded only at
            the households below.
            {isAdmin ? " As an admin you can record any unit in this session's blocks." : ""}
          </p>
          {/* The list stands in for the block cards: each group opens its block. */}
          <RevisitList active={state.data} tick={tick} isAdmin={isAdmin} />
          <HintCard id="follow-up-session" title="How a follow-up session works">
            Tap a household to record your visit. When the follow-up is finished, tap Mark done. Met
            someone who should be on the list? Ask an admin.
          </HintCard>
          {/* The list shows only blocks with listed households, so an admin
              recording elsewhere, as an admin may, starts from here. */}
          {isAdmin && blocks.length > 0 ? (
            <section aria-labelledby="session-blocks-heading" className="space-y-2">
              <h2 id="session-blocks-heading" className="text-title font-semibold">
                Blocks in this session
              </h2>
              <p className="text-caption text-foreground-muted">
                For recording a unit that is not on the list.
              </p>
              <ul className="space-y-2">
                {blocks.map((entry) => (
                  <BlockCard key={entry.block.id} entry={entry} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : blocks.length === 0 ? (
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
