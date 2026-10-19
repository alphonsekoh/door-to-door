"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AmendVisitSheet } from "@/components/amend-visit-sheet";
import { InterestChip } from "@/components/interest-chip";
import { RecordOnBehalfForm } from "@/components/record-on-behalf-form";
import { VisitByline } from "@/components/visit-byline";
import type {
  ActiveSession,
  HistoryEntry,
  HistoryList,
  InterestLevel,
  Team,
  TeamList,
  User,
} from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { asHouseholdSummary } from "@/lib/history";
import { loadAllUsers } from "@/lib/users";
import {
  hasAnyFilter,
  hasServerFilter,
  matchesSearch,
  parseFilters,
  toHistoryQuery,
  toSearchParams,
  type RecordFilters,
} from "@/lib/record-filters";
import { SheetPresence } from "@/components/sheet";

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
  | {
      status: "ready";
      session: ActiveSession;
      /* Null when the list could not be read: then nothing is known about
         which team ids are real. */
      teams: Team[] | null;
      entries: HistoryEntry[];
      total: number;
    }
  | { status: "error"; message: string };

/* The team picker is a convenience; failing to list teams must not take the
   records with it. */
async function teamsOf(sessionId: string): Promise<Team[] | null> {
  try {
    return (await apiFetch<TeamList>(`/sessions/${sessionId}/teams`)).data;
  } catch {
    return null;
  }
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
      const [page, teams] = await Promise.all([
        apiFetch<HistoryList>(`/history?${toHistoryQuery(current, session.session.id, PAGE_SIZE)}`),
        teamsOf(session.session.id),
      ]);
      setState({
        status: "ready",
        session,
        teams,
        entries: page.data,
        total: page.pagination.total,
      });
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
      setMembers(await loadAllUsers());
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

  /*
   * A team id that is not one of this outing's teams - the outing changed, the
   * team was deleted, or the URL was edited - is unknown, and unknown values
   * are dropped rather than forwarded (D-29-4). Kept, it would filter to
   * nothing while the picker claimed "Any team".
   */
  const knownTeams = state.status === "ready" ? state.teams : null;
  const unknownTeam =
    knownTeams !== null &&
    filters.teamId !== "" &&
    !knownTeams.some((team) => team.id === filters.teamId);
  useEffect(() => {
    if (!unknownTeam) return;
    const next = toSearchParams({ ...parseFilters(new URLSearchParams(search)), teamId: "" });
    router.replace(next === "" ? "/admin/records" : `/admin/records?${next}`);
  }, [unknownTeam, search, router]);

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
          className="mt-3 min-h-11 btn-primary rounded-lg px-4 text-body font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  const { session, entries, total } = state;
  const teams = state.teams ?? [];
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
          className="min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-body font-medium"
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
            className="min-h-12 field"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
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
              className="h-12 min-h-12 field"
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
            <label htmlFor="records-team" className="sr-only">
              Filter by team
            </label>
            <select
              id="records-team"
              value={filters.teamId}
              onChange={(event) => {
                setFilter("teamId", event.target.value);
              }}
              className="h-12 min-h-12 field"
            >
              <option value="">Any team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
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
              className="h-12 min-h-12 field"
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
            className="min-h-11 text-body font-medium btn-text"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
          {entries.length === 0 && !hasServerFilter(filters)
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
                className="flex min-h-14 w-full items-center gap-3 border-b border-border press-row px-4 py-2 text-left last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold tabular-nums">
                    {entry.household.unitNumber}
                  </span>
                  <span className="block truncate text-caption text-foreground-muted">
                    Blk {entry.block.name}
                    {entry.household.name === null ? "" : ` · ${entry.household.name}`}
                  </span>
                  <VisitByline visit={entry.visit} prefix="By " />
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

      <SheetPresence>
        {amending === null ? null : (
          <AmendVisitSheet
            entry={asHouseholdSummary(amending)}
            onClose={() => {
              setAmending(null);
            }}
            onSaved={() => {
              setAmending(null);
              void load(filters);
            }}
          />
        )}
      </SheetPresence>

      <SheetPresence>
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
      </SheetPresence>
    </div>
  );
}
