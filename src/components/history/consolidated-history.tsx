"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AmendVisitSheet } from "@/components/visits/amend-visit-sheet";
import { InterestChip } from "@/components/ui/interest-chip";
import { VisitByline } from "@/components/visits/visit-byline";
import type {
  Block,
  BlockList,
  HistoryEntry,
  HistoryList,
  InterestLevel,
  OutingSession,
  Religion,
  SessionList,
  Team,
  TeamList,
  User,
} from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { historyToCsv } from "@/lib/csv";
import { asHouseholdSummary } from "@/lib/history/history";
import { loadAllUsers } from "@/lib/session/users";
import { formatDay } from "@/lib/history/dates";
import {
  groupByHousehold,
  hasHistoryFilter,
  matchesHistorySearch,
  parseHistoryFilters,
  toHistoryRequest,
  toHistorySearch,
  type HistoryFilters,
} from "@/lib/history/history-filters";
import { SheetPresence } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";

const PAGE_SIZE = 100;
/* An export walks the whole filtered set a page at a time. The cap stops a
   careless filter turning into a hundred round trips; the screen says when it
   bites, so the file is never quietly short. */
const EXPORT_MAX_PAGES = 20;

const LEVELS: { value: InterestLevel; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "no_response", label: "No answer" },
];

const RELIGIONS: { value: Religion; label: string }[] = [
  { value: "buddhist", label: "Buddhist" },
  { value: "christian", label: "Christian" },
  { value: "hindu", label: "Hindu" },
  { value: "freethinker", label: "Freethinker" },
  { value: "others", label: "Others" },
];

type State =
  | { status: "loading" }
  | { status: "ready"; entries: HistoryEntry[]; total: number }
  | { status: "error"; message: string };

export function ConsolidatedHistory() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = parseHistoryFilters(new URLSearchParams(params.toString()));

  const [state, setState] = useState<State>({ status: "loading" });
  const [offset, setOffset] = useState(0);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sessions, setSessions] = useState<OutingSession[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  /* Tagged with the session they belong to; null while unknown (no session,
     still loading, or the list could not be read). */
  const [teamState, setTeamState] = useState<{ outing: string; teams: Team[] } | null>(null);
  /* Switching sessions quickly must not leave the previous session's teams. */
  const teamsGeneration = useRef(0);
  const [amending, setAmending] = useState<HistoryEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const search = toHistorySearch(filters);

  const load = useCallback(async (current: HistoryFilters, at: number) => {
    try {
      const page = await apiFetch<HistoryList>(
        `/history?${toHistoryRequest(current, { limit: PAGE_SIZE, offset: at })}`,
      );
      setState((previous) => ({
        status: "ready",
        entries:
          at === 0 || previous.status !== "ready" ? page.data : [...previous.entries, ...page.data],
        total: page.pagination.total,
      }));
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load the records.",
      });
    }
  }, []);

  /* The three pickers are a convenience; losing any of them must not take the
     records with it. */
  const loadPickers = useCallback(async () => {
    const [block, session, user] = await Promise.allSettled([
      apiFetch<BlockList>("/blocks?limit=100"),
      apiFetch<SessionList>("/sessions?limit=100"),
      loadAllUsers(),
    ]);
    if (block.status === "fulfilled") setBlocks(block.value.data);
    if (session.status === "fulfilled") setSessions(session.value.data);
    if (user.status === "fulfilled") setMembers(user.value);
  }, []);

  useEffect(() => {
    const current = parseHistoryFilters(new URLSearchParams(search));
    /* Deferred with the loads rather than run inline: React warns that setting
       state synchronously in an effect triggers a cascading render. */
    const timer = setTimeout(() => {
      setOffset(0);
      void load(current, 0);
      void loadPickers();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, loadPickers, search]);

  /* Teams belong to one session, so they are listed only once one is chosen,
     and a failure just leaves the picker empty. */
  const outing = filters.sessionId;
  useEffect(() => {
    const mine = ++teamsGeneration.current;
    const timer = setTimeout(() => {
      if (outing === "") {
        setTeamState(null);
        return;
      }
      apiFetch<TeamList>(`/sessions/${outing}/teams`).then(
        (list) => {
          if (mine === teamsGeneration.current) setTeamState({ outing, teams: list.data });
        },
        () => {
          if (mine === teamsGeneration.current) setTeamState(null);
        },
      );
    }, 0);
    return () => {
      clearTimeout(timer);
      teamsGeneration.current += 1;
    };
  }, [outing]);

  const teams = teamState?.outing === outing ? teamState.teams : [];

  /* A team that is not one of the chosen session's - deleted, or an edited or
     old URL - is unknown, and dropped rather than forwarded (D-29-4). */
  const unknownTeam =
    teamState?.outing === outing &&
    filters.teamId !== "" &&
    !teams.some((team) => team.id === filters.teamId);
  useEffect(() => {
    if (!unknownTeam) return;
    const next = toHistorySearch({
      ...parseHistoryFilters(new URLSearchParams(search)),
      teamId: "",
    });
    // Teams are only known once a session is chosen, so the session keeps the query non-empty.
    router.replace(`/admin/history?${next}`);
  }, [unknownTeam, search, router]);

  function setFilter<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]): void {
    /* A team from the old session means nothing in the new one. */
    const reset = key === "sessionId" ? { teamId: "" } : {};
    const next = toHistorySearch({ ...filters, ...reset, [key]: value });
    router.replace(next === "" ? "/admin/history" : `/admin/history?${next}`);
  }

  /*
   * Walks the filtered set rather than exporting what happens to be on screen.
   * "Reflects the active filters" is the whole promise of the button, and a
   * file that quietly held the first hundred rows would break it.
   */
  async function exportCsv(): Promise<void> {
    setExporting(true);
    setNotice(null);
    try {
      const collected: HistoryEntry[] = [];
      let page = 0;
      let more = true;
      while (more && page < EXPORT_MAX_PAGES) {
        const result = await apiFetch<HistoryList>(
          `/history?${toHistoryRequest(filters, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })}`,
        );
        collected.push(...result.data);
        more = result.pagination.hasMore;
        page += 1;
      }

      const rows = collected.filter((entry) => matchesHistorySearch(entry, filters.q));
      const blob = new Blob([historyToCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "door-to-door-records.csv";
      anchor.click();
      URL.revokeObjectURL(url);

      setNotice(
        more
          ? `Exported the first ${String(rows.length)} records. Narrow the filters to get the rest.`
          : `Exported ${String(rows.length)} records.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not export those records.");
    } finally {
      setExporting(false);
    }
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

  const { entries, total } = state;
  const visible = entries.filter((entry) => matchesHistorySearch(entry, filters.q));
  const groups = groupByHousehold(visible);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div>
          <label htmlFor="history-q" className="sr-only">
            Search by unit, name or contact
          </label>
          <input
            id="history-q"
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
          <div>
            <label htmlFor="history-block" className="sr-only">
              Filter by block
            </label>
            <select
              id="history-block"
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

          <div>
            <label htmlFor="history-session" className="sr-only">
              Filter by session
            </label>
            <select
              id="history-session"
              value={filters.sessionId}
              onChange={(event) => {
                setFilter("sessionId", event.target.value);
              }}
              className="h-12 min-h-12 field"
            >
              <option value="">All sessions</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          </div>

          {filters.sessionId === "" ? null : (
            <div>
              <label htmlFor="history-team" className="sr-only">
                Filter by team
              </label>
              <select
                id="history-team"
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
          )}

          <div>
            <label htmlFor="history-member" className="sr-only">
              Filter by member
            </label>
            <select
              id="history-member"
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

          <div>
            <label htmlFor="history-interest" className="sr-only">
              Filter by interest level
            </label>
            <select
              id="history-interest"
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

          <div>
            <label htmlFor="history-religion" className="sr-only">
              Filter by religion
            </label>
            <select
              id="history-religion"
              value={filters.religion}
              onChange={(event) => {
                setFilter("religion", event.target.value as Religion | "");
              }}
              className="h-12 min-h-12 field"
            >
              <option value="">Any religion</option>
              {RELIGIONS.map((religion) => (
                <option key={religion.value} value={religion.value}>
                  {religion.label}
                </option>
              ))}
            </select>
          </div>

          {/* Spans the row: nested in a grid cell each date input lost half
              its width and rendered as a clipped "dd/mm/". */}
          <div className="col-span-2 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="history-from" className="sr-only">
                Recorded from
              </label>
              <input
                id="history-from"
                type="date"
                value={filters.from}
                onChange={(event) => {
                  setFilter("from", event.target.value);
                }}
                className="min-h-12 field"
              />
            </div>
            <div>
              <label htmlFor="history-to" className="sr-only">
                Recorded to
              </label>
              <input
                id="history-to"
                type="date"
                value={filters.to}
                onChange={(event) => {
                  setFilter("to", event.target.value);
                }}
                className="min-h-12 field"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void exportCsv()}
            className="min-h-11 flex-1 btn-secondary rounded-lg text-body font-medium"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
          {hasHistoryFilter(filters) ? (
            <button
              type="button"
              onClick={() => {
                router.replace("/admin/history");
              }}
              className="min-h-11 rounded-lg px-3 text-body font-medium btn-text"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {notice === null ? null : (
          <p role="status" className="text-caption text-foreground-muted">
            {notice}
          </p>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
          {entries.length === 0 && toHistorySearch({ ...filters, q: "" }) === ""
            ? "Nothing has been recorded yet."
            : "Nothing here matches those filters."}
        </p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => {
            const { household, block } = group;
            return (
              <li key={group.key} className="rounded-xl border border-border bg-surface p-4">
                {/* The count drops under, on the right, once the door would
                    have under 12ch: squeezed, the name was cut to a few
                    letters at the largest text. */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link
                    href={`/households/${household.id}`}
                    className="flex min-h-11 min-w-0 flex-[1_1_12ch] flex-col justify-center"
                  >
                    <span className="block text-body font-semibold tabular-nums">
                      Blk {block.name}, <UnitNumber value={household.unitNumber} />
                    </span>
                    {household.name === null ? null : (
                      <span className="block truncate text-caption text-foreground-muted">
                        {household.name}
                      </span>
                    )}
                  </Link>
                  <span className="ml-auto shrink-0 text-caption text-foreground-muted">
                    {group.entries.length} {group.entries.length === 1 ? "visit" : "visits"}
                  </span>
                </div>

                {/* Oldest first, so the trajectory reads left to right. */}
                <ol className="mt-3 space-y-2">
                  {group.entries.map((entry) => (
                    <li key={entry.visit.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAmending(entry);
                        }}
                        className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 press-row py-1 text-left"
                      >
                        <span className="min-w-0 flex-[1_1_12ch]">
                          <span className="block text-caption break-words text-foreground-muted">
                            {formatDay(entry.visit.createdAt)} · {entry.session.title}
                          </span>
                          <VisitByline visit={entry.visit} prefix="By " />
                          {entry.visit.description === "" ? null : (
                            <span className="block truncate text-caption">
                              {entry.visit.description}
                            </span>
                          )}
                        </span>
                        <InterestChip level={entry.visit.interestLevel} />
                      </button>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      )}

      {entries.length < total ? (
        <button
          type="button"
          onClick={() => {
            const next = offset + PAGE_SIZE;
            setOffset(next);
            void load(filters, next);
          }}
          className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
        >
          Show more ({entries.length} of {total})
        </button>
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
              void load(filters, 0);
            }}
          />
        )}
      </SheetPresence>
    </div>
  );
}
