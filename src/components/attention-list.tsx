"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { InterestChip } from "@/components/interest-chip";
import type { HouseholdAttention, HouseholdAttentionList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

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

export function AttentionList() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [wide, setWide] = useState(false);

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

      {state.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
          <p className="text-body font-medium">Nothing is waiting.</p>
          <p className="mt-1 text-body text-foreground-muted">
            Every door that showed interest either has a follow-up open or has been back to.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {state.rows.map((row) => (
            <li key={row.household.id}>
              <Link
                href={`/households/${row.household.id}`}
                className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold tabular-nums">
                    Blk {row.block.name}, {row.household.unitNumber}
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
            </li>
          ))}
        </ul>
      )}

      {state.total > state.rows.length ? (
        <p className="text-caption text-foreground-muted">
          Showing the {state.rows.length} longest-waiting of {state.total}.
        </p>
      ) : null}
    </div>
  );
}
