"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FollowUpItem } from "@/components/follow-ups/follow-up-item";
import { FollowUpSheet } from "@/components/follow-ups/follow-up-sheet";
import { HintCard } from "@/components/ui/hint-card";
import { FollowUpDoor } from "@/components/ui/unit-number";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { groupListedByHousehold, loadAllListed } from "@/lib/follow-ups/listed";
import { removedByline } from "@/lib/history/follow-ups";
import { useAddressFilters } from "@/lib/hooks/use-address-filters";
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

/* The list is read whole, as a session's picker reads it, so it is not here. */
const QUERY: Record<Exclude<FollowUpTab, "list">, string> = {
  review: "status=suggested",
  dismissed: "deleted=true",
};

const TAB_LABEL: Record<FollowUpTab, string> = {
  review: "To review",
  list: "On the list",
  dismissed: "Dismissed",
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
  const params = useSearchParams();
  /* Not router.replace: this page checks the admin on the server, so that
     waited on a round trip, and with no signal left the screen for Offline. */
  const [search, chooseTab] = useAddressFilters(
    "/admin/follow-ups",
    `tab=${parseFollowUpTab(new URLSearchParams(params.toString()))}`,
  );
  const tab = parseFollowUpTab(new URLSearchParams(search));
  const [now] = useState(() => new Date());
  const [state, setState] = useState<State>({ status: "loading" });
  const [counts, setCounts] = useState<Counts>({ review: null, list: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  /* What a promotion said, kept until the next tab or change. */
  const [notice, setNotice] = useState<string | null>(null);
  /* Switching tabs quickly must not let an older answer land last. */
  const generation = useRef(0);
  /* Nor an older count: two quick changes on To review each read the whole list. */
  const counting = useRef(0);

  /*
   * The list counts households, as the New session picker does, so the two
   * agree when a household carries two listed notes. To review needs no
   * grouping: a household has at most one suggestion waiting (D-117-7). On
   * the list tab its own read gives the list's count.
   */
  const count = useCallback(async () => {
    const mine = ++counting.current;
    const total = async (query: string) =>
      (await apiFetch<FollowUpList>(`/follow-ups?${query}&limit=1`)).pagination.total;
    try {
      if (tab === "list") {
        const review = await total(QUERY.review);
        if (mine === counting.current) setCounts((current) => ({ ...current, review }));
        return;
      }
      const [review, listed] = await Promise.all([total(QUERY.review), loadAllListed()]);
      if (mine === counting.current) {
        setCounts({ review, list: groupListedByHousehold(listed).length });
      }
    } catch {
      // The tabs read without numbers; the list below still says what failed.
    }
  }, [tab]);

  const load = useCallback(
    async (offset: number) => {
      const mine = ++generation.current;
      try {
        if (tab === "list") {
          const notes = await loadAllListed();
          if (mine !== generation.current) return;
          setState({ status: "ready", notes, total: notes.length });
          setCounts((current) => ({ ...current, list: groupListedByHousehold(notes).length }));
          return;
        }
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

  const tabCount = (value: FollowUpTab): number | null =>
    value === "dismissed" ? null : counts[value];

  const empty = EMPTY[tab];

  return (
    <div className="space-y-4">
      {/* The count sits under its label, so no tab wraps mid-word at phone
          width; they still wrap onto rows at large text (D-111-25). */}
      <div role="group" aria-label="Follow-up list views" className="flex flex-wrap gap-2">
        {(["review", "list", "dismissed"] as const).map((value) => {
          const on = value === tab;
          const total = tabCount(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              aria-label={
                total === null ? TAB_LABEL[value] : `${TAB_LABEL[value]}, ${String(total)}`
              }
              onClick={() => {
                if (on) return;
                setState({ status: "loading" });
                setNotice(null);
                chooseTab(`tab=${value}`);
              }}
              className={`flex min-h-14 flex-[1_1_9ch] press flex-col items-center justify-center rounded-lg border px-2 py-1 text-body leading-tight font-medium ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
              }`}
            >
              <span>{TAB_LABEL[value]}</span>
              {total === null ? null : (
                <span className="text-caption tabular-nums">{String(total)}</span>
              )}
            </button>
          );
        })}
      </div>

      {notice === null ? null : (
        <p role="status" className="notice-success">
          {notice}
        </p>
      )}

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
      ) : tab === "list" ? (
        <ul className="space-y-4">
          {groupListedByHousehold(state.notes).map((household) => (
            <li key={household.householdId}>
              <Link
                href={`/households/${household.householdId}`}
                className="inline-flex min-h-11 items-center text-body font-semibold btn-text tabular-nums"
              >
                <FollowUpDoor note={household} />
              </Link>
              <div className="space-y-2">
                {household.notes.map((note) => (
                  <FollowUpItem
                    key={note.id}
                    note={note}
                    now={now}
                    active={null}
                    onChanged={() => {
                      setNotice(null);
                      reload();
                    }}
                    onEdit={setEditing}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
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
                    onChanged={() => {
                      setNotice(null);
                      reload();
                    }}
                    onEdit={setEditing}
                    onPromoted={setNotice}
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

      {/* Under the list, so the first Add to list or Dismiss is in view on a
          first visit. */}
      <HintCard id="admin-follow-ups" title="How the follow-up list works">
        Members suggest households worth a return visit. You add the good ones to this list. Then
        create a Follow-up session and pick which of them to visit; members can record visits only
        at the households you pick.
      </HintCard>

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
