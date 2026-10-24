"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ADDED_TO_LIST,
  FollowUpSheet,
  SUGGESTION_SENT,
} from "@/components/follow-ups/follow-up-sheet";
import { PromoteButton } from "@/components/follow-ups/promote-button";
import { BackLink } from "@/components/ui/back-link";
import { HouseholdHistoryPanel } from "@/components/households/household-history";
import { VisitByline } from "@/components/visits/visit-byline";
import type { HouseholdHistory } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import {
  ADD_TO_LIST,
  ON_THE_LIST,
  SUGGEST,
  householdAction,
  waitingLabel,
} from "@/lib/follow-ups/rights";
import { useActiveSession } from "@/lib/hooks/use-active-session";
import { useRole } from "@/lib/hooks/use-role";
import { SheetPresence } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";

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
  const [sent, setSent] = useState<string | null>(null);
  const { userId, isAdmin } = useRole();
  const active = useActiveSession();
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

  /* Reached from history, follow-ups and the admin lists alike, so back goes
     the way the member came, in every state: a failed load is no trap. */
  const back = <BackLink href="/follow-ups" label="Back" retrace />;

  if (state.status === "loading") {
    return (
      <>
        {back}
        <p className="text-body text-foreground-muted">Loading…</p>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        {back}
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body"
        >
          {state.message}
        </p>
      </>
    );
  }

  const { household, block, visits, followUps } = state.history;
  /* Oldest first, so the last one is the latest knock. */
  const latest = visits.at(-1);
  const action = householdAction(followUps, { userId, isAdmin });

  return (
    <div className="space-y-4">
      <div>
        {back}
        {/* At large text the action drops under the unit rather than push
            past the edge, and the unit number never breaks at its hyphen. */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h1 className="text-heading font-semibold tabular-nums">
            <UnitNumber value={household.unitNumber} />
          </h1>
          {action.kind === "add_to_list" || action.kind === "suggest" ? (
            <button
              type="button"
              onClick={() => {
                setSent(null);
                setAdding(true);
              }}
              className="min-h-11 btn-secondary rounded-lg px-3 text-body font-medium text-primary"
            >
              {action.kind === "add_to_list" ? ADD_TO_LIST : SUGGEST}
            </button>
          ) : action.kind === "promote" ? (
            /* The same as Add to list on the suggestion below: one door, one
               note on the list, and its author is not told it was declined. */
            <PromoteButton
              suggestionId={action.suggestionId}
              onPromoted={() => {
                setSent(ADDED_TO_LIST);
                reload();
              }}
              className="min-h-11 btn-secondary rounded-lg px-3 text-body font-medium text-primary"
            />
          ) : (
            /* Said instead of offered: the server would refuse a second one. */
            <p className="inline-flex min-h-11 items-center rounded-lg bg-primary/10 px-3 text-caption font-medium">
              {action.kind === "listed" ? ON_THE_LIST : waitingLabel(action.by)}
            </p>
          )}
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

      {sent === null ? null : (
        <p role="status" className="notice-success">
          {sent}
        </p>
      )}

      <HouseholdHistoryPanel
        history={state.history}
        active={active}
        onChanged={reload}
        anchorVisits
      />

      <SheetPresence>
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
              setSent(isAdmin ? ADDED_TO_LIST : SUGGESTION_SENT);
              reload();
            }}
          />
        ) : null}
      </SheetPresence>
    </div>
  );
}
