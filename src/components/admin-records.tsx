"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AmendVisitSheet } from "@/components/amend-visit-sheet";
import { InterestChip } from "@/components/interest-chip";
import { RecordOnBehalfForm } from "@/components/record-on-behalf-form";
import type {
  ActiveSession,
  HistoryEntry,
  HistoryList,
  HouseholdSummary,
  InterestLevel,
  User,
  UserList,
} from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import {
  hasAnyFilter,
  matchesSearch,
  parseFilters,
  toHistoryQuery,
  toSearchParams,
  type RecordFilters,
} from "@/lib/record-filters";

const PAGE_SIZE = 100;
const POLL_INTERVAL_MS = 30_000;

const LEVELS: { value: InterestLevel; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "no_response", label: "No answer" },
];

type State =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; session: ActiveSession; entries: HistoryEntry[]; total: number }
  | { status: "error"; message: string };

/*
 * An amendment patches the household's latest visit, and here the record in
 * hand is that visit - so the sheet is handed the same shape the block list
 * gives it rather than growing a second way in.
 */
function asSummary(entry: HistoryEntry): HouseholdSummary {
  return {
    household: entry.household,
    visitCount: 1,
    latestVisit: entry.visit,
    outstandingFollowUps: 0,
  };
}

export function AdminRecords() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = parseFilters(new URLSearchParams(params.toString()));

  const [state, setState] = useState<State>({ status: "loading" });
  const [members, setMembers] = useState<User[]>([]);
  const [amending, setAmending] = useState<HistoryEntry | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async (current: RecordFilters) => {
    try {
      const session = await apiFetch<ActiveSession>("/sessions/active");
      const page = await apiFetch<HistoryList>(
        `/history?${toHistoryQuery(current, session.session.id, PAGE_SIZE)}`,
      );
      setState({ status: "ready", session, entries: page.data, total: page.pagination.total });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        // No outing is running: an ordinary state, not a failure.
        setState({ status: "none" });
        return;
      }
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load the records.",
      });
    }
  }, []);

  /* Deliberately forgiving: the picker is a convenience, and losing it must
     not take the records with it. */
  const loadMembers = useCallback(async () => {
    try {
      const page = await apiFetch<UserList>("/users?limit=100");
      setMembers(page.data);
    } catch {
      setMembers([]);
    }
  }, []);

  const search = toSearchParams(filters);

  useEffect(() => {
    const current = parseFilters(new URLSearchParams(search));
    const initial = setTimeout(() => {
      void load(current);
      void loadMembers();
    }, 0);
    const timer = setInterval(() => void load(current), POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load, loadMembers, search]);

  /* Written to the URL rather than to state, so the view can be sent to
     someone else and survives a reload. */
  function setFilter<K extends keyof RecordFilters>(key: K, value: RecordFilters[K]): void {
    const next = toSearchParams({ ...filters, [key]: value });
    router.replace(next === "" ? "/admin/records" : `/admin/records?${next}`);
  }

  if (state.status === "loading") {
    return <p className="text-body text-foreground-muted">Loading…</p>;
  }

  if (state.status === "none") {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
        <p className="text-body font-medium">No outing is running.</p>
        <p className="mt-1 text-body text-foreground-muted">
          Start one from Outings, then the records will appear here as members knock.
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-border bg-surface-muted p-4">
        <p className="text-body">{state.message}</p>
        <button
          type="button"
          onClick={() => void load(filters)}
          className="mt-3 min-h-11 rounded-lg bg-primary px-4 text-body font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  const { session, entries, total } = state;
  const visible = entries.filter((entry) => matchesSearch(entry, filters.q));
  const blocks = session.blocks.map((entry) => entry.block);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-body font-medium">{session.session.title}</p>
        <button
          type="button"
          onClick={() => {
            setRecording(true);
          }}
          className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-body font-medium"
        >
          Record for a member
        </button>
      </div>

      <div className="space-y-2">
        <div>
          <label htmlFor="records-search" className="sr-only">
            Search by unit, name or contact
          </label>
          <input
            id="records-search"
            type="search"
            value={filters.q}
            onChange={(event) => {
              setFilter("q", event.target.value);
            }}
            placeholder="Unit, name or contact"
            className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
          />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="records-block" className="sr-only">
              Filter by block
            </label>
            <select
              id="records-block"
              value={filters.blockId}
              onChange={(event) => {
                setFilter("blockId", event.target.value);
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
            <label htmlFor="records-member" className="sr-only">
              Filter by member
            </label>
            <select
              id="records-member"
              value={filters.memberId}
              onChange={(event) => {
                setFilter("memberId", event.target.value);
              }}
              className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
            >
              <option value="">Everyone</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name ?? member.email}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label htmlFor="records-interest" className="sr-only">
              Filter by interest level
            </label>
            <select
              id="records-interest"
              value={filters.interestLevel}
              onChange={(event) => {
                setFilter("interestLevel", event.target.value as InterestLevel | "");
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

        {hasAnyFilter(filters) ? (
          <button
            type="button"
            onClick={() => {
              router.replace("/admin/records");
            }}
            className="min-h-11 text-body font-medium text-primary"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
          {entries.length === 0
            ? "Nothing has been recorded on this outing yet."
            : "Nothing here matches those filters."}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {visible.map((entry) => (
            <li key={entry.visit.id}>
              <button
                type="button"
                onClick={() => {
                  setAmending(entry);
                }}
                className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-2 text-left last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold tabular-nums">
                    {entry.household.unitNumber}
                  </span>
                  <span className="block truncate text-caption text-foreground-muted">
                    Blk {entry.block.name} · {entry.visit.member.name ?? "a member"}
                    {entry.household.name === null ? "" : ` · ${entry.household.name}`}
                  </span>
                  {entry.visit.description === "" ? null : (
                    <span className="mt-0.5 block truncate text-caption text-foreground-muted">
                      {entry.visit.description}
                    </span>
                  )}
                </span>
                <InterestChip level={entry.visit.interestLevel} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > entries.length ? (
        <p className="text-caption text-foreground-muted">
          Showing the first {entries.length} of {total} records.
        </p>
      ) : null}

      {amending === null ? null : (
        <AmendVisitSheet
          entry={asSummary(amending)}
          onClose={() => {
            setAmending(null);
          }}
          onSaved={() => {
            setAmending(null);
            void load(filters);
          }}
        />
      )}

      {recording ? (
        <RecordOnBehalfForm
          members={members}
          blocks={blocks}
          onRecorded={() => {
            setRecording(false);
            void load(filters);
          }}
          onClose={() => {
            setRecording(false);
          }}
        />
      ) : null}
    </div>
  );
}
