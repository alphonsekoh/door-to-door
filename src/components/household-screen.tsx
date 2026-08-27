"use client";

import { useCallback, useEffect, useState } from "react";
import { HouseholdHistoryPanel } from "@/components/household-history";
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

  const load = useCallback(async () => {
    try {
      setState({
        status: "ready",
        history: await apiFetch<HouseholdHistory>(`/households/${householdId}`),
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load this unit.",
      });
    }
  }, [householdId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);

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

  const { household, block } = state.history;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-heading font-semibold tabular-nums">{household.unitNumber}</p>
        <p className="text-body text-foreground-muted">
          Blk {block.name}, {block.street}
        </p>
      </div>

      <HouseholdHistoryPanel history={state.history} />
    </div>
  );
}
