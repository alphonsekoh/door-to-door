"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FollowUpItem } from "@/components/follow-ups/follow-up-item";
import { FollowUpSheet } from "@/components/follow-ups/follow-up-sheet";
import { HintCard } from "@/components/ui/hint-card";
import { FollowUpDoor } from "@/components/ui/unit-number";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { removedByline } from "@/lib/history/follow-ups";
import { formatDay } from "@/lib/history/dates";
import { displayName } from "@/lib/teams/team-ui";
import { SheetPresence } from "@/components/ui/sheet";

const PAGE_SIZE = 20;

export type FollowUpTab = "review" | "list" | "dismissed";

/* D-29-4: the URL is editable, so anything but a known value is the default. */
export function parseFollowUpTab(params: URLSearchParams): FollowUpTab {
  const tab = params.get("tab");
  return tab === "list" || tab === "dismissed" ? tab : "review";
}

const QUERY: Record<FollowUpTab, string> = {
  review: "status=suggested",
  list: "status=listed&outstanding=true",
  dismissed: "deleted=true",
};

const EMPTY: Record<FollowUpTab, { title: string; detail: string | null }> = {
  review: {
    title: "No suggestions to review.",
    detail: "When a member suggests a return visit, it appears here.",
  },
  list: {
    title: "The follow-up list is empty.",
    detail: "Add households from Needs a return visit, or from a household's page.",
  },
  dismissed: { title: "Nothing has been dismissed.", detail: null },
};

type State =
  | { status: "loading" }
  | { status: "ready"; notes: FollowUp[]; total: number }
  | { status: "error" };

type Counts = { review: number | null; list: number | null };

/*
 * Where an admin decides what is owed: suggestions to add or dismiss, the
 * list itself, and an audit of everything taken off it. Tabs live in the
 * URL, so Back and a reload keep the place.
 */
export function AdminFollowUps() {
  const router = useRouter();
  const tab = parseFollowUpTab(new URLSearchParams(useSearchParams().toString()));
  const [now] = useState(() => new Date());
  const [state, setState] = useState<State>({ status: "loading" });
  const [counts, setCounts] = useState<Counts>({ review: null, list: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  /* Switching tabs quickly must not let an older answer land last. */
  const generation = useRef(0);

  const count = useCallback(async () => {
    const total = async (query: string) =>
      (await apiFetch<FollowUpList>(`/follow-ups?${query}&limit=1`)).pagination.total;
    try {
      const [review, list] = await Promise.all([total(QUERY.review), total(QUERY.list)]);
      setCounts({ review, list });
    } catch {
      // The tabs read without numbers; the list below still says what failed.
    }
  }, []);

  const load = useCallback(
    async (offset: number) => {
      const mine = ++generation.current;
      try {
        const page = await apiFetch<FollowUpList>(
          `/follow-ups?${QUERY[tab]}&limit=${String(PAGE_SIZE)}&offset=${String(offset)}`,
        );
        if (mine !== generation.current) return;
        setState((current) => ({
          status: "ready",
          notes:
            offset === 0 || current.status !== "ready"
              ? page.data
              : [...current.notes, ...page.data],
          total: page.pagination.total,
        }));
      } catch {
        if (mine === generation.current) setState({ status: "error" });
      }
    },
    [tab],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(0);
      void count();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, count]);

  /* A promotion or removal moves a note between tabs, so both re-read. */
  const reload = () => {
    void load(0);
    void count();
  };

  const label = (value: FollowUpTab): string => {
    switch (value) {
      case "review":
        return counts.review === null ? "To review" : `To review (${String(counts.review)})`;
      case "list":
        return counts.list === null ? "On the list" : `On the list (${String(counts.list)})`;
      case "dismissed":
        return "Dismissed";
    }
  };

  const empty = EMPTY[tab];

  return (
    <div className="space-y-4">
      <HintCard id="admin-follow-ups" title="How the follow-up list works">
        Members suggest households worth a return visit. You add the good ones to this list. Then
        create a Follow-up session and attach their blocks; members can record visits only at listed
        households.
      </HintCard>

      {/* Wraps onto rows at large text rather than overlap (D-111-25). */}
      <div role="group" aria-label="Follow-up list views" className="flex flex-wrap gap-2">
        {(["review", "list", "dismissed"] as const).map((value) => {
          const on = value === tab;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                if (on) return;
                setState({ status: "loading" });
                router.replace(`/admin/follow-ups?tab=${value}`);
              }}
              className={`min-h-11 flex-[1_1_9ch] press rounded-lg border px-2 text-body font-medium tabular-nums ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
              }`}
            >
              {label(value)}
            </button>
          );
        })}
      </div>

      {state.status === "loading" ? (
        <p className="text-body text-foreground-muted">Loading…</p>
      ) : state.status === "error" ? (
        <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body">Could not load the list. Check your connection.</p>
          <button
            type="button"
            onClick={reload}
            className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
          >
            Try again
          </button>
        </div>
      ) : state.notes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
          <p className="text-body font-medium">{empty.title}</p>
          {empty.detail === null ? null : (
            <p className="mt-1 text-body text-foreground-muted">{empty.detail}</p>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {state.notes.map((note) => (
              <li key={note.id}>
                {tab === "dismissed" ? (
                  <RemovedNote note={note} />
                ) : (
                  <FollowUpItem
                    note={note}
                    now={now}
                    active={null}
                    showUnit
                    onChanged={reload}
                    onEdit={setEditing}
                  />
                )}
              </li>
            ))}
          </ul>
          {state.notes.length < state.total ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void load(state.notes.length).finally(() => {
                  setLoadingMore(false);
                });
              }}
              className="min-h-11 w-full btn-secondary rounded-xl text-body font-medium"
            >
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          ) : null}
        </>
      )}

      <SheetPresence>
        {editing === null ? null : (
          <FollowUpSheet
            mode={{ kind: "edit", note: editing }}
            onClose={() => {
              setEditing(null);
            }}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        )}
      </SheetPresence>
    </div>
  );
}

/* Read-only: a removed note is history, kept so nobody wonders where it went. */
function RemovedNote({ note }: { note: FollowUp }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <p className="text-body font-semibold tabular-nums">
        <FollowUpDoor note={note} />
      </p>
      <p className="text-body break-words whitespace-pre-wrap">{note.note}</p>
      <p className="mt-1 text-caption text-foreground-muted">
        {note.status === "suggested" ? "Suggested" : "Added"} by {displayName(note.author.name)} ·{" "}
        {formatDay(note.createdAt)}
      </p>
      <p className="text-caption font-medium">{removedByline(note)}</p>
      {note.deleteReason === null ? null : (
        <p className="text-caption break-words">Reason: {note.deleteReason}</p>
      )}
    </div>
  );
}
