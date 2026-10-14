"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FollowUpSheet } from "@/components/follow-up-sheet";
import { HouseholdHistoryPanel } from "@/components/household-history";
import { VisitByline } from "@/components/visit-byline";
import type { HouseholdHistory } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

type State =
  | { status: "loading" }
  | { status: "ready"; history: HouseholdHistory }
  | { status: "error"; message: string };

/*
 * A unit's full timeline, reached from a history record or a follow-up note.
 *
 * Deliberately not scoped to the caller: the whole point of the household/visit
 * split is that you arrive knowing what everyone before you learned. A member's
 * own history is what is private; a door's history is shared.
 */
export function HouseholdScreen({ householdId }: { householdId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [adding, setAdding] = useState(false);
  /* Two quick changes re-read twice; only the newest answer may land. */
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const history = await apiFetch<HouseholdHistory>(`/households/${householdId}`);
      if (mine === generation.current) setState({ status: "ready", history });
    } catch (error) {
      /* A failed re-read after a change keeps the unit on screen, so a late
         failure cannot replace a newer answer either. */
      setState((current) =>
        current.status === "ready"
          ? current
          : {
              status: "error",
              message: error instanceof Error ? error.message : "Could not load this unit.",
            },
      );
    }
  }, [householdId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  const reload = () => {
    void load();
  };

  if (state.status === "loading") {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <p
        role="alert"
        className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body"
      >
        {state.message}
      </p>
    );
  }

  const { household, block, visits } = state.history;
  /* Oldest first, so the last one is the latest knock. */
  const latest = visits.at(-1);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-heading font-semibold tabular-nums">{household.unitNumber}</p>
          <button
            type="button"
            onClick={() => {
              setAdding(true);
            }}
            className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-body font-medium text-primary"
          >
            Add follow-up
          </button>
        </div>
        <p className="text-body text-foreground-muted">
          Blk {block.name}, {block.street}
        </p>
        {latest === undefined ? null : (
          <div className="mt-1">
            <VisitByline visit={latest} prefix="Last visit by " />
          </div>
        )}
      </div>

      <HouseholdHistoryPanel history={state.history} onChanged={reload} anchorVisits />

      {adding ? (
        <FollowUpSheet
          mode={{
            kind: "create",
            householdId: household.id,
            visitId: null,
            unitNumber: household.unitNumber,
          }}
          onClose={() => {
            setAdding(false);
          }}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
