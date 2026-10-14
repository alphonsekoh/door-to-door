"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OwnRecords, TEAM_VIEW_NOTE } from "@/components/own-records";
import { ScopeToggle } from "@/components/scope-toggle";
import type { Block, HistoryEntry, HistoryList, InterestLevel } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { ownHistoryRequest, parseScope, scopeHref, type RecordScope } from "@/lib/team-view";

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
  const router = useRouter();
  const scope = parseScope(new URLSearchParams(useSearchParams().toString()));
  const [state, setState] = useState<State>({ status: "loading" });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [blockId, setBlockId] = useState("");
  const [interestLevel, setInterestLevel] = useState<InterestLevel | "">("");
  /* Filters and the toggle each refetch; on a slow line only the newest
     answer may land. */
  const generation = useRef(0);

  const load = useCallback(
    async (view: RecordScope, filters: { blockId: string; interestLevel: InterestLevel | "" }) => {
      const mine = ++generation.current;
      const query = ownHistoryRequest(
        view,
        { sessionId, ...filters },
        { limit: PAGE_SIZE, offset: 0 },
      );

      try {
        const page = await apiFetch<HistoryList>(`/history/mine?${query}`);
        if (mine !== generation.current) return;
        setState({ status: "ready", entries: page.data, total: page.pagination.total });
        /* Only an unfiltered load can see every block; a filtered one would
           narrow the picker to whatever is already selected. */
        if (filters.blockId === "" && filters.interestLevel === "") {
          setBlocks(blocksIn(page.data));
        }
      } catch (error) {
        if (mine !== generation.current) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load these records.",
        });
      }
    },
    [sessionId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(scope, { blockId, interestLevel }), 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load, scope, blockId, interestLevel]);

  /* In the URL, so the choice survives opening a unit and coming back. */
  const toggle = (
    <ScopeToggle
      scope={scope}
      onChange={(next) => {
        router.replace(scopeHref(`/history/${sessionId}`, next));
      }}
    />
  );

  if (state.status === "loading") {
    return (
      <div className="space-y-4">
        {toggle}
        <p className="text-body text-foreground-muted">Loading…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-4">
        {toggle}
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body"
        >
          {state.message}
        </p>
      </div>
    );
  }

  const { entries, total } = state;

  return (
    <div className="space-y-4">
      {toggle}
      {scope === "team" ? (
        <p className="text-caption text-foreground-muted">{TEAM_VIEW_NOTE}</p>
      ) : null}

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
        <OwnRecords
          entries={entries}
          onAmended={() => void load(scope, { blockId, interestLevel })}
        />
      )}

      {total > entries.length ? (
        <p className="text-caption text-foreground-muted">
          Showing the first {entries.length} of {total} records.
        </p>
      ) : null}
    </div>
  );
}
