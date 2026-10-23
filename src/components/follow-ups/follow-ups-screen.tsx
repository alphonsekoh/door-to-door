"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DeclinedNotice } from "@/components/follow-ups/declined-notice";
import { FollowUpItem } from "@/components/follow-ups/follow-up-item";
import { FollowUpSheet } from "@/components/follow-ups/follow-up-sheet";
import { HintCard } from "@/components/ui/hint-card";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { useActiveSession } from "@/lib/hooks/use-active-session";
import { useRole } from "@/lib/hooks/use-role";
import { SheetPresence } from "@/components/ui/sheet";

const PAGE_SIZE = 20;

export type FollowUpView = "list" | "review" | "mine";

/* D-29-4: the URL is editable, so anything but a known value is the default. */
export function parseFollowUpView(params: URLSearchParams): FollowUpView {
  const view = params.get("view");
  return view === "review" || view === "mine" ? view : "list";
}

const VIEWS: { value: FollowUpView; label: string }[] = [
  { value: "list", label: "On the list" },
  { value: "review", label: "Waiting for review" },
  { value: "mine", label: "Mine" },
];

const EMPTY: Record<FollowUpView, { title: string; detail: string | null }> = {
  list: {
    title: "Nothing is on the follow-up list.",
    detail: "Admins add households here for follow-up sessions.",
  },
  review: { title: "No suggestions waiting.", detail: null },
  mine: {
    title: "You have no follow-ups or suggestions.",
    detail: "Open a household and tap Suggest a return visit.",
  },
};

/* What each view asks the server for; Mine needs the viewer's id. */
function queryFor(view: FollowUpView, userId: string): URLSearchParams {
  switch (view) {
    case "list":
      return new URLSearchParams({ status: "listed", outstanding: "true" });
    case "review":
      return new URLSearchParams({ status: "suggested" });
    case "mine":
      return new URLSearchParams({ authorId: userId, outstanding: "true" });
  }
}

type State =
  | { status: "loading" }
  | { status: "ready"; notes: FollowUp[]; total: number }
  | { status: "error" };

/*
 * Households worth a return visit, in the server's order: soonest due first,
 * undated last. The list admins decide comes first; suggestions waiting for
 * review are a tap away, so every member sees what is already asked for.
 */
export function FollowUpsScreen() {
  const router = useRouter();
  const view = parseFollowUpView(new URLSearchParams(useSearchParams().toString()));
  const { userId } = useRole();
  const active = useActiveSession();
  const [now] = useState(() => new Date());
  const [state, setState] = useState<State>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  /* Switching views quickly must not let an older answer land last. */
  const generation = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      if (userId === undefined) return;
      const mine = ++generation.current;
      const params = queryFor(view, userId);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      try {
        const page = await apiFetch<FollowUpList>(`/follow-ups?${params.toString()}`);
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
    [view, userId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(0), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  /* Re-read from the top after a change: a resolved note leaves this list. */
  const reload = () => {
    void load(0);
  };

  const empty = EMPTY[view];

  return (
    <div className="space-y-4">
      <HintCard id="follow-ups" title="What are follow-ups?">
        Households worth a return visit. Admins choose which go on the follow-up list. In a
        follow-up session you visit them and mark each one done. Think a household should be
        revisited? Open it and tap Suggest a return visit.
      </HintCard>

      {userId === undefined ? null : <DeclinedNotice userId={userId} />}

      {/* Three short labels: they wrap onto two rows at large text rather
          than cut a label (D-111-25). */}
      <div role="group" aria-label="Which follow-ups" className="flex flex-wrap gap-2">
        {VIEWS.map((option) => {
          const on = option.value === view;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                if (on) return;
                setState({ status: "loading" });
                router.replace(
                  option.value === "list" ? "/follow-ups" : `/follow-ups?view=${option.value}`,
                );
              }}
              className={`min-h-11 flex-[1_1_8ch] press rounded-lg border px-2 text-body font-medium ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {state.status === "loading" ? (
        <p className="text-body text-foreground-muted">Loading…</p>
      ) : state.status === "error" ? (
        <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body">You seem to be offline, or the list could not be read.</p>
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
                <FollowUpItem
                  note={note}
                  now={now}
                  active={active}
                  showUnit
                  onChanged={reload}
                  onEdit={setEditing}
                />
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
