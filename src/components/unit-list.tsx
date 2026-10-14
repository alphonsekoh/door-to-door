"use client";

import { useState } from "react";
import { AmendVisitSheet } from "@/components/amend-visit-sheet";
import { InterestChip } from "@/components/interest-chip";
import { VisitByline } from "@/components/visit-byline";
import type { HouseholdSummary } from "@/generated/types.gen";
import { filterUnits, groupByFloor, progressLabel, summariseProgress } from "@/lib/unit-list";

type Props = {
  units: HouseholdSummary[];
  /* Units recorded during the running outing, so tonight's work is legible
     against the block's whole history. Null while the session is unknown. */
  sessionId: string | null;
  /* The viewer's current team on the running outing, per the server. */
  teamIds?: readonly string[];
  onAmended: () => void;
};

function UnitRow({
  entry,
  tonight,
  onSelect,
}: {
  entry: HouseholdSummary;
  tonight: boolean;
  onSelect: () => void;
}) {
  const { household, latestVisit, outstandingFollowUps } = entry;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-2 text-left last:border-b-0"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-body font-semibold tabular-nums">{household.unitNumber}</span>
            {tonight ? <span className="text-caption text-foreground-muted">tonight</span> : null}
          </span>
          {household.name === null ? null : (
            <span className="block truncate text-caption text-foreground-muted">
              {household.name}
            </span>
          )}
          {latestVisit === null ? null : (
            <VisitByline visit={latestVisit} prefix="By " withTeam={false} />
          )}
          {outstandingFollowUps !== undefined && outstandingFollowUps > 0 ? (
            <span className="block text-caption font-medium text-interest-medium">
              {outstandingFollowUps === 1
                ? "1 follow-up outstanding"
                : `${String(outstandingFollowUps)} follow-ups outstanding`}
            </span>
          ) : null}
        </span>

        {latestVisit === null ? null : <InterestChip level={latestVisit.interestLevel} />}
      </button>
    </li>
  );
}

export function UnitList({ units, sessionId, teamIds = [], onAmended }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HouseholdSummary | null>(null);

  const visible = filterUnits(units, query);
  const floors = groupByFloor(visible);
  /* Progress reports the outing, not the block's whole history: what a member
     wants to know is how far tonight has got. */
  const progress = summariseProgress(
    sessionId === null ? units : units.filter((e) => e.latestVisit?.sessionId === sessionId),
  );

  return (
    <div className="space-y-4">
      <p className="text-body font-medium tabular-nums">
        {progressLabel(progress, sessionId === null ? "On this block" : "Tonight")}
      </p>

      <div>
        <label htmlFor="unit-search" className="sr-only">
          Search this block
        </label>
        <input
          id="unit-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Unit, name or contact"
          className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
        />
      </div>

      {floors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-body text-foreground-muted">
          {units.length === 0
            ? "No units recorded here yet."
            : `Nothing here matches "${query.trim()}".`}
        </p>
      ) : (
        floors.map((floor) => (
          <section key={floor.key} aria-label={floor.label}>
            <h2 className="mb-1 text-caption font-semibold tracking-wide text-foreground-muted uppercase">
              {floor.label}
            </h2>
            <ul className="overflow-hidden rounded-xl border border-border bg-surface">
              {floor.units.map((entry) => (
                <UnitRow
                  key={entry.household.id}
                  entry={entry}
                  tonight={sessionId !== null && entry.latestVisit?.sessionId === sessionId}
                  onSelect={() => {
                    setSelected(entry);
                  }}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {selected === null ? null : (
        <AmendVisitSheet
          entry={selected}
          teamIds={teamIds}
          onClose={() => {
            setSelected(null);
          }}
          onSaved={() => {
            setSelected(null);
            onAmended();
          }}
        />
      )}
    </div>
  );
}
