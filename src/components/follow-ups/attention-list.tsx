"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FollowUpSheet, type FollowUpSheetMode } from "@/components/follow-ups/follow-up-sheet";
import { InterestChip } from "@/components/ui/interest-chip";
import type { HouseholdAttention, HouseholdAttentionList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { formatDay } from "@/lib/history/dates";
import { SheetPresence } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";

const PAGE_SIZE = 50;

type State =
  | { status: "loading" }
  | { status: "ready"; rows: HouseholdAttention[]; total: number }
  | { status: "error"; message: string };

/* Whole days, rounded down: "3 days ago" for anything inside the fourth day. */
export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

export function sinceLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 61) return `${String(days)} days ago`;
  return `${String(Math.floor(days / 30))} months ago`;
}

/* Why the door is on this list at all, for the admin writing what the next
   visit should do. The list holds only medium and high interest. */
export function whyHere(row: HouseholdAttention): string {
  const level = row.latestVisit.interestLevel === "medium" ? "medium" : "high";
  return `Showed ${level} interest on ${formatDay(row.latestVisit.createdAt)}.`;
}

function addMode(row: HouseholdAttention): FollowUpSheetMode {
  return {
    kind: "create",
    householdId: row.household.id,
    visitId: row.latestVisit.id,
    unitNumber: row.household.unitNumber,
    context: whyHere(row),
  };
}

export function AttentionList() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [wide, setWide] = useState(false);
  const [adding, setAdding] = useState<FollowUpSheetMode | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const load = useCallback(async (includeMedium: boolean) => {
    try {
      const page = await apiFetch<HouseholdAttentionList>(
        `/households/attention?limit=${String(PAGE_SIZE)}${includeMedium ? "&minimumInterest=medium" : ""}`,
      );
      setState({ status: "ready", rows: page.data, total: page.pagination.total });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load the list.",
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(wide), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, wide]);

  if (state.status === "loading") {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
        <p className="text-body">{state.message}</p>
        <button
          type="button"
          onClick={() => void load(wide)}
          className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      <button
        type="button"
        aria-pressed={wide}
        onClick={() => {
          setWide((open) => !open);
        }}
        className="min-h-11 w-full btn-secondary rounded-lg text-body font-medium"
      >
        {wide ? "High interest only" : "Include medium interest"}
      </button>

      {added === null ? null : (
        <p role="status" className="notice-success">
          {added}
        </p>
      )}

      {state.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
          <p className="text-body font-medium">Nothing is waiting.</p>
          <p className="mt-1 text-body text-foreground-muted">
            Every door that showed interest is on the follow-up list, has a suggestion waiting, or
            has been back to.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {state.rows.map((row) => (
            <li key={row.household.id} className="border-b border-border last:border-b-0">
              {/* At large text the chip drops under the door rather than cut
                  who lives there to a few letters. */}
              <Link
                href={`/households/${row.household.id}`}
                className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pb-1"
              >
                <span className="min-w-0 flex-[1_1_12ch]">
                  <span className="block text-body font-semibold tabular-nums">
                    Blk {row.block.name}, <UnitNumber value={row.household.unitNumber} />
                  </span>
                  <span className="block truncate text-caption text-foreground-muted">
                    {row.household.name ?? "Nobody named yet"} · last visited{" "}
                    {sinceLabel(daysSince(row.lastVisitedAt, now))}
                  </span>
                  {row.latestVisit.description === "" ? null : (
                    <span className="mt-0.5 block truncate text-caption text-foreground-muted">
                      {row.latestVisit.description}
                    </span>
                  )}
                </span>
                <InterestChip level={row.latestVisit.interestLevel} />
              </Link>
              {/* Beside the row, never inside its link. */}
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setAdded(null);
                    setAdding(addMode(row));
                  }}
                  className="min-h-11 btn-secondary rounded-lg px-4 text-body font-medium"
                >
                  Add to list
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SheetPresence>
        {adding === null ? null : (
          <FollowUpSheet
            mode={adding}
            onClose={() => {
              setAdding(null);
            }}
            onSaved={(message) => {
              setAdding(null);
              setAdded(message);
              // Listed now, so it leaves this list.
              void load(wide);
            }}
          />
        )}
      </SheetPresence>

      {state.total > state.rows.length ? (
        <p className="text-caption text-foreground-muted">
          Showing the {state.rows.length} longest-waiting of {state.total}.
        </p>
      ) : null}
    </div>
  );
}
