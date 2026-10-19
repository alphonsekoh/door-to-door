"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { OutstandingFollowUps } from "@/components/outstanding-follow-ups";
import { PageHeader } from "@/components/page-header";
import { ScopeToggle } from "@/components/scope-toggle";
import { SessionHistoryCard } from "@/components/session-history-card";
import { TeamRecords } from "@/components/team-records";
import type {
  FollowUpList,
  SessionHistoryList,
  SessionHistorySummary,
} from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { parseScope, scopeHref } from "@/lib/team-view";
import { useRole } from "@/lib/use-role";

/* Small enough to stay quick on a phone, large enough that most members never
   reach for "Show more". */
const PAGE_SIZE = 20;

type State =
  | { status: "loading" }
  | { status: "ready"; sessions: SessionHistorySummary[]; total: number }
  | { status: "error"; message: string };

/*
 * "Me" is the outing list, counted from the member's own records only
 * (D-27-1). "My team" is a flat list of records including those made by teams
 * the member is on now: the outing counts never change with it, so the two
 * are not mixed on one screen.
 */
export const HISTORY_SUBTITLE = {
  me: "Outings you have worked, newest first.",
  team: "Records by you and the teams you are on now, newest first.",
} as const;

export function OwnHistoryScreen() {
  const router = useRouter();
  const { userId } = useRole();
  const [notes, setNotes] = useState<FollowUpList["data"]>([]);
  const scope = parseScope(new URLSearchParams(useSearchParams().toString()));
  const toggle = (
    <ScopeToggle
      scope={scope}
      onChange={(next) => {
        router.replace(scopeHref("/history", next));
      }}
    />
  );

  /* Deliberately forgiving: the notes are a bonus on this screen, and failing
     to fetch them must not hide the history itself. Shown in both views: a
     promise owed is the member's whichever list they are reading. */
  useEffect(() => {
    if (userId === undefined) return;
    const timer = setTimeout(() => {
      apiFetch<FollowUpList>(`/follow-ups?authorId=${userId}&outstanding=true&limit=10`).then(
        (page) => {
          setNotes(page.data);
        },
        () => {
          setNotes([]);
        },
      );
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [userId]);

  return (
    <>
      <PageHeader title="History" subtitle={HISTORY_SUBTITLE[scope]} />
      <div className="space-y-4">
        {toggle}
        <OutstandingFollowUps notes={notes} />
        {scope === "team" ? <TeamRecords /> : <OwnOutings />}
      </div>
    </>
  );
}

function OwnOutings() {
  const [state, setState] = useState<State>({ status: "loading" });
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

  useEffect(() => {
    const timer = setTimeout(() => void load(0), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

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

  const { sessions, total } = state;

  return (
    <div className="space-y-4">
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
              className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
            >
              {loadingMore ? "Loading…" : "Show earlier outings"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
