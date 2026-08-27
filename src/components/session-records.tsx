"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { InterestChip } from "@/components/interest-chip";
import type { Block, HistoryEntry, HistoryList, InterestLevel } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

const PAGE_SIZE = 50;

const LEVELS: { value: InterestLevel; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "no_response", label: "No answer" },
];

type State =
  | { status: "loading" }
  | { status: "ready"; entries: HistoryEntry[]; total: number }
  | { status: "error"; message: string };

/* Derived from the records themselves rather than fetched: the only blocks
   worth offering are the ones this member actually worked that evening. */
function blocksIn(entries: HistoryEntry[]): Block[] {
  const seen = new Map<string, Block>();
  for (const entry of entries) {
    seen.set(entry.block.id, entry.block);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function SessionRecords({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [blockId, setBlockId] = useState("");
  const [interestLevel, setInterestLevel] = useState<InterestLevel | "">("");

  const load = useCallback(
    async (filters: { blockId: string; interestLevel: string }) => {
      const query = new URLSearchParams({
        sessionId,
        limit: String(PAGE_SIZE),
      });
      if (filters.blockId !== "") query.set("blockId", filters.blockId);
      if (filters.interestLevel !== "") query.set("interestLevel", filters.interestLevel);

      try {
        const page = await apiFetch<HistoryList>(`/history/mine?${query.toString()}`);
        setState({ status: "ready", entries: page.data, total: page.pagination.total });
        /* Only an unfiltered load can see every block; a filtered one would
           narrow the picker to whatever is already selected. */
        if (filters.blockId === "" && filters.interestLevel === "") {
          setBlocks(blocksIn(page.data));
        }
      } catch (error) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load these records.",
        });
      }
    },
    [sessionId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load({ blockId, interestLevel }), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, blockId, interestLevel]);

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

  const { entries, total } = state;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor="filter-block" className="sr-only">
            Filter by block
          </label>
          <select
            id="filter-block"
            value={blockId}
            onChange={(event) => {
              setBlockId(event.target.value);
            }}
            className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
          >
            <option value="">All blocks</option>
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                Blk {block.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label htmlFor="filter-interest" className="sr-only">
            Filter by interest level
          </label>
          <select
            id="filter-interest"
            value={interestLevel}
            onChange={(event) => {
              setInterestLevel(event.target.value as InterestLevel | "");
            }}
            className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
          >
            <option value="">Any interest</option>
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
          Nothing here matches those filters.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {entries.map((entry) => (
            <li key={entry.visit.id}>
              <Link
                href={`/households/${entry.household.id}`}
                className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold tabular-nums">
                    {entry.household.unitNumber}
                  </span>
                  <span className="block truncate text-caption text-foreground-muted">
                    Blk {entry.block.name}
                    {entry.household.name === null ? "" : ` · ${entry.household.name}`}
                  </span>
                  {entry.visit.description === "" ? null : (
                    <span className="mt-0.5 block truncate text-caption text-foreground-muted">
                      {entry.visit.description}
                    </span>
                  )}
                </span>
                <InterestChip level={entry.visit.interestLevel} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {total > entries.length ? (
        <p className="text-caption text-foreground-muted">
          Showing the first {entries.length} of {total} records.
        </p>
      ) : null}
    </div>
  );
}
