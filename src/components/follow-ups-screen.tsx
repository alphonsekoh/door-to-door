"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FollowUpItem } from "@/components/follow-up-item";
import { FollowUpSheet } from "@/components/follow-up-sheet";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { useRole } from "@/lib/use-role";
import { SheetPresence } from "@/components/sheet";

const PAGE_SIZE = 20;

export type FollowUpView = "everyone" | "mine";

/* D-29-4: the URL is editable, so anything but the one known value is the default. */
export function parseFollowUpView(params: URLSearchParams): FollowUpView {
  return params.get("view") === "mine" ? "mine" : "everyone";
}

const VIEWS: { value: FollowUpView; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "mine", label: "Mine" },
];

const EMPTY: Record<FollowUpView, string> = {
  everyone: "No follow-ups waiting.",
  mine: "You have no follow-ups waiting.",
};

type State =
  | { status: "loading" }
  | { status: "ready"; notes: FollowUp[]; total: number }
  | { status: "error" };

/*
 * Every outstanding note, in the server's order: soonest due first, undated
 * last. The door matters more than who wrote the note, so Everyone is the
 * default and Mine narrows it.
 */
export function FollowUpsScreen() {
  const router = useRouter();
  const view = parseFollowUpView(new URLSearchParams(useSearchParams().toString()));
  const { userId } = useRole();
  const [now] = useState(() => new Date());
  const [state, setState] = useState<State>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  /* Switching views quickly must not let an older answer land last. */
  const generation = useRef(0);

  /* Mine needs the viewer's id before it can ask. */
  const author = view === "mine" ? userId : null;

  const load = useCallback(
    async (offset: number) => {
      if (author === undefined) return;
      const mine = ++generation.current;
      const params = new URLSearchParams({
        outstanding: "true",
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (author !== null) params.set("authorId", author);
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
    [author],
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

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Whose follow-ups" className="flex gap-2">
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
                router.replace(option.value === "mine" ? "/follow-ups?view=mine" : "/follow-ups");
              }}
              className={`min-h-11 flex-1 press rounded-lg border text-body font-medium ${
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
        <p className="text-body text-foreground-muted">{EMPTY[view]}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {state.notes.map((note) => (
              <li key={note.id}>
                <FollowUpItem
                  note={note}
                  now={now}
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
