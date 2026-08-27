"use client";

import { useCallback, useEffect, useState } from "react";
import { OutstandingFollowUps } from "@/components/outstanding-follow-ups";
import { SessionHistoryCard } from "@/components/session-history-card";
import type {
  FollowUpList,
  SessionHistoryList,
  SessionHistorySummary,
} from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { useRole } from "@/lib/use-role";

/* Small enough to stay quick on a phone, large enough that most members never
   reach for "Show more". */
const PAGE_SIZE = 20;

type State =
  | { status: "loading" }
  | { status: "ready"; sessions: SessionHistorySummary[]; total: number }
  | { status: "error"; message: string };

export function OwnHistoryScreen() {
  const { userId } = useRole();
  const [state, setState] = useState<State>({ status: "loading" });
  const [notes, setNotes] = useState<FollowUpList["data"]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (offset: number) => {
    try {
      const page = await apiFetch<SessionHistoryList>(
        `/history/mine/sessions?limit=${String(PAGE_SIZE)}&offset=${String(offset)}`,
      );
      setState((current) => ({
        status: "ready",
        sessions:
          offset === 0 || current.status !== "ready"
            ? page.data
            : [...current.sessions, ...page.data],
        total: page.pagination.total,
      }));
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load your history.",
      });
    }
  }, []);

  /* Deliberately forgiving: the notes are a bonus on this screen, and failing
     to fetch them must not hide the history itself. */
  const loadNotes = useCallback(async (memberId: string) => {
    try {
      const page = await apiFetch<FollowUpList>(
        `/follow-ups?authorId=${memberId}&outstanding=true&limit=10`,
      );
      setNotes(page.data);
    } catch {
      setNotes([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(0);
      if (userId !== undefined) void loadNotes(userId);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, loadNotes, userId]);

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
          className="mt-3 min-h-11 rounded-lg bg-primary px-4 text-body font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  const { sessions, total } = state;

  return (
    <div className="space-y-4">
      <OutstandingFollowUps notes={notes} />

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
          <p className="text-body font-medium">Nothing recorded yet.</p>
          <p className="mt-1 text-body text-foreground-muted">
            Once you knock on your first door, the outing will appear here with what you found.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {sessions.map((summary) => (
              <SessionHistoryCard key={summary.session.id} summary={summary} />
            ))}
          </ul>

          {sessions.length < total ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void load(sessions.length).finally(() => {
                  setLoadingMore(false);
                });
              }}
              className="min-h-12 w-full rounded-xl border border-border text-body font-medium disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Show earlier outings"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
