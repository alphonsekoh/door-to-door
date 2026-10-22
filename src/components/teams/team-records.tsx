"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OwnRecords, TEAM_VIEW_NOTE } from "@/components/history/own-records";
import type { HistoryEntry, HistoryList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { ownHistoryRequest } from "@/lib/teams/team-view";

const PAGE_SIZE = 20;

type State =
  | { status: "loading" }
  | { status: "ready"; entries: HistoryEntry[]; total: number }
  | { status: "error"; message: string };

/* Every record the member or a team they are on now made, newest first. */
export function TeamRecords() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  /* A reload after an amend can cross a "Show more"; only the newest lands. */
  const generation = useRef(0);

  const load = useCallback(async (offset: number) => {
    const mine = ++generation.current;
    try {
      const page = await apiFetch<HistoryList>(
        `/history/mine?${ownHistoryRequest("team", {}, { limit: PAGE_SIZE, offset })}`,
      );
      if (mine !== generation.current) return;
      setState((current) => ({
        status: "ready",
        entries:
          offset === 0 || current.status !== "ready"
            ? page.data
            : [...current.entries, ...page.data],
        total: page.pagination.total,
      }));
    } catch (error) {
      if (mine !== generation.current) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load your team's records.",
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(0), 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load]);

  const note = (
    <p className="text-caption text-foreground-muted">
      Your session list counts only your own records. {TEAM_VIEW_NOTE}
    </p>
  );

  if (state.status === "loading") {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
        <p className="text-body">{state.message}</p>
        <button
          type="button"
          onClick={() => void load(0)}
          className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  const { entries, total } = state;

  return (
    <div className="space-y-4">
      {note}
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
          Nothing recorded by you or your team yet.
        </p>
      ) : (
        <OwnRecords entries={entries} showOuting onAmended={() => void load(0)} />
      )}

      {entries.length < total ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => {
            setLoadingMore(true);
            void load(entries.length).finally(() => {
              setLoadingMore(false);
            });
          }}
          className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
        >
          {loadingMore ? "Loading…" : "Show earlier records"}
        </button>
      ) : null}
    </div>
  );
}
