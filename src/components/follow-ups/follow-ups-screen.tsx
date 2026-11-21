"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DeclinedNotice } from "@/components/follow-ups/declined-notice";
import { FollowUpItem } from "@/components/follow-ups/follow-up-item";
import { FollowUpSheet } from "@/components/follow-ups/follow-up-sheet";
import { HintCard } from "@/components/ui/hint-card";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { useActiveSession } from "@/lib/hooks/use-active-session";
import { useAddressFilters } from "@/lib/hooks/use-address-filters";
import { useRole } from "@/lib/hooks/use-role";
import { SheetPresence } from "@/components/ui/sheet";

const PAGE_SIZE = 20;

export type FollowUpView = "list" | "review" | "mine";

/* D-29-4: the URL is editable, so anything but a known value is the default. */
export function parseFollowUpView(params: URLSearchParams): FollowUpView {
  const view = params.get("view");
  return view === "review" || view === "mine" ? view : "list";
}

/* As the screen writes it to the address: the list, the default, writes nothing. */
function viewSearch(view: FollowUpView): string {
  return view === "list" ? "" : `view=${view}`;
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

/*
 * What each view asks the server for. Only Mine needs the viewer's id, so
 * only Mine waits for the session to name them; the others ask at once
 * (#252). Null until Mine can ask.
 */
function queryFor(view: FollowUpView, userId: string | undefined): string | null {
  switch (view) {
    case "list":
      return new URLSearchParams({ status: "listed", outstanding: "true" }).toString();
    case "review":
      return new URLSearchParams({ status: "suggested" }).toString();
    case "mine":
      return userId === undefined
        ? null
        : new URLSearchParams({ authorId: userId, outstanding: "true" }).toString();
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
  const params = useSearchParams();
  /* Not router.replace: once Next's copy of this route is five minutes old,
     that asks the server again, and with no signal left for Offline. */
  const [search, chooseView] = useAddressFilters(
    "/follow-ups",
    viewSearch(parseFollowUpView(new URLSearchParams(params.toString()))),
  );
  const view = parseFollowUpView(new URLSearchParams(search));
  const { userId } = useRole();
  /* A string, so the session answering does not ask again for a view that
     never needed it. */
  const query = queryFor(view, userId);
  const active = useActiveSession();
  const [now] = useState(() => new Date());
  const [state, setState] = useState<State>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  /* Switching views quickly must not let an older answer land last. */
  const generation = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      /* Before the wait for the viewer, or the view left behind answers into
         Mine while Mine's own request is still out. */
      const mine = ++generation.current;
      if (query === null) return;
      const params = new URLSearchParams(query);
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
    [query],
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
      {/* First, so they are in reach on arrival whatever is said below them.
          Three short labels: they wrap onto two rows at large text rather
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
                /* The address changes after the tap; an answer landing
                   between them is for the view being left. */
                generation.current += 1;
                setState({ status: "loading" });
                chooseView(viewSearch(option.value));
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

      {userId === undefined ? null : <DeclinedNotice userId={userId} />}

      {/* Each note's controls and bylines are the viewer's, so an answer that
          lands before the session names them waits: drawn as a member's, an
          admin's buttons would appear under a thumb a moment later. */}
      {state.status === "loading" || userId === undefined ? (
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

      {/* Under the list, as on the session screen: above it, with a declined
          suggestion, it pushed the tabs under the nav on a first visit. */}
      <HintCard id="follow-ups" title="What are follow-ups?">
        Admins choose which households go on the follow-up list. In a follow-up session you visit
        them and mark each one done. Think another household should be revisited? Tap Suggest a
        return visit on its page, or after you record a visit there.
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
