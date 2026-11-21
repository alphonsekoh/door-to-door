"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FollowUpSheet, type FollowUpSheetMode } from "@/components/follow-ups/follow-up-sheet";
import { InterestChip } from "@/components/ui/interest-chip";
import type {
  Block,
  BlockList,
  HouseholdAttention,
  HouseholdAttentionList,
} from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import {
  hasAttentionFilter,
  parseAttentionFilters,
  toAttentionRequest,
  toAttentionSearch,
  type AttentionFilters,
} from "@/lib/follow-ups/attention-filters";
import { formatDay } from "@/lib/history/dates";
import { useSearchTerm } from "@/lib/hooks/use-search-term";
import { matchesHouseholdSearch } from "@/lib/households/search";
import { SheetPresence } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";

const PAGE_SIZE = 50;
const PATH = "/admin/attention";

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
  const filters = parseAttentionFilters(new URLSearchParams(useSearchParams().toString()));
  const search = toAttentionSearch(filters);
  /* Held here, never in the address (attention-filters). */
  const [q, setQ] = useSearchTerm(PATH, search);

  const [state, setState] = useState<State>({ status: "loading" });
  /* A read of the list is out. Show more waits for it: pressed under a reload,
     it would ask for the next page of rows about to be replaced. */
  const [busy, setBusy] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [adding, setAdding] = useState<FollowUpSheetMode | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  /* Only the newest read lands: a page for the filters just left, or a Show
     more overtaken by a reload, must not appear under the new ones. */
  const generation = useRef(0);

  const load = useCallback(async (current: AttentionFilters, offset: number) => {
    const mine = ++generation.current;
    setBusy(true);
    try {
      const page = await apiFetch<HouseholdAttentionList>(
        `/households/attention?${toAttentionRequest(current, { limit: PAGE_SIZE, offset })}`,
      );
      if (mine !== generation.current) return;
      setState((previous) => ({
        status: "ready",
        rows:
          previous.status === "ready" && offset > 0 ? [...previous.rows, ...page.data] : page.data,
        total: page.pagination.total,
      }));
    } catch (error) {
      if (mine !== generation.current) return;
      setState({ status: "error", message: failureLine(error, "Could not load the list.") });
    } finally {
      if (mine === generation.current) setBusy(false);
    }
  }, []);

  /* The rows on screen stay while the new ones load, so the controls stay
     mounted and keep focus. Deferred, as React warns on a state change made
     synchronously in an effect. */
  useEffect(() => {
    const current = parseAttentionFilters(new URLSearchParams(search));
    const timer = setTimeout(() => void load(current, 0), 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load, search]);

  /* A convenience: if the blocks cannot be read, All blocks still lists every
     door. */
  useEffect(() => {
    apiFetch<BlockList>("/blocks?limit=100").then(
      (list) => {
        setBlocks(list.data);
      },
      () => undefined,
    );
  }, []);

  /*
   * The History API, not router.replace, which waits on a server round trip
   * this page has no use for: the controls show the filter just left until it
   * answers, and offline it falls back to a page load the worker answers with
   * Offline (D-163-6). Null state, or Next's patch skips telling
   * useSearchParams.
   */
  function show(next: AttentionFilters): void {
    const query = toAttentionSearch(next);
    window.history.replaceState(null, "", query === "" ? PATH : `${PATH}?${query}`);
  }

  if (state.status === "loading") {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
        <p className="text-body">{state.message}</p>
        <button
          type="button"
          onClick={() => void load(filters, 0)}
          className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  const { rows, total } = state;
  /* In the server's order: longest waiting first. */
  const visible = rows.filter((row) => matchesHouseholdSearch(row.household, q));
  const filtered = hasAttentionFilter(filters, q);
  const now = new Date();

  return (
    <div className="space-y-4">
      {/* Stacked full width: at half width a lone select, or the toggle's
          label, wrapped at large text. */}
      <div className="space-y-2">
        <div>
          <label htmlFor="attention-q" className="sr-only">
            Search by unit, name or contact
          </label>
          <input
            id="attention-q"
            type="search"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
            }}
            placeholder="Unit, name or contact"
            className="min-h-12 field"
          />
        </div>

        <div>
          <label htmlFor="attention-block" className="sr-only">
            Filter by block
          </label>
          <select
            id="attention-block"
            value={filters.blockId}
            onChange={(event) => {
              show({ ...filters, blockId: event.target.value });
            }}
            className="h-12 min-h-12 field"
          >
            <option value="">All blocks</option>
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                Blk {block.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          aria-pressed={filters.includeMedium}
          onClick={() => {
            show({ ...filters, includeMedium: !filters.includeMedium });
          }}
          className="min-h-11 w-full btn-secondary rounded-lg text-body font-medium"
        >
          {filters.includeMedium ? "High interest only" : "Include medium interest"}
        </button>

        {/* The toggle stays: it widens the list rather than narrowing it,
            and one tap already undoes it. */}
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              if (filters.blockId !== "") show({ ...filters, blockId: "" });
            }}
            className="min-h-11 text-body font-medium btn-text"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {added === null ? null : (
        <p role="status" className="notice-success">
          {added}
        </p>
      )}

      {visible.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {visible.map((row) => (
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
      ) : filtered ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
          Nothing here matches those filters.
        </p>
      ) : (
        /* Said only of the whole list: an empty filtered one says nothing
           about the doors outside it. */
        <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
          <p className="text-body font-medium">Nothing is waiting.</p>
          <p className="mt-1 text-body text-foreground-muted">
            Every door that showed interest is on the follow-up list, has a suggestion waiting, or
            has been back to.
          </p>
        </div>
      )}

      {/* The search runs over the rows loaded, so this is how it reaches past
          the first page. */}
      {rows.length < total ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(filters, rows.length)}
          className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
        >
          {busy ? "Loading…" : `Show more (${String(rows.length)} of ${String(total)})`}
        </button>
      ) : null}

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
              void load(filters, 0);
            }}
          />
        )}
      </SheetPresence>
    </div>
  );
}
