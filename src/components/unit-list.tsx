"use client";

import { useState } from "react";
import { AmendVisitSheet } from "@/components/amend-visit-sheet";
import { InterestChip } from "@/components/interest-chip";
import { VisitByline } from "@/components/visit-byline";
import type { HouseholdSummary } from "@/generated/types.gen";
import type { QueuedVisit } from "@/lib/sync/types";
import type { UnitRow as Row } from "@/lib/sync/unit-overlay";
import { filterUnits, groupByFloor, progressLabel, summariseProgress } from "@/lib/unit-list";

type Props = {
  /* The server's units with this phone's unsent records laid over them. */
  rows: Row[];
  /* Records this page is sending right now. */
  inFlight: ReadonlySet<string>;
  /* Units recorded during the running outing, so tonight's work is legible
     against the block's whole history. Null while the session is unknown. */
  sessionId: string | null;
  /* The viewer's current team on the running outing, per the server. */
  teamIds?: readonly string[];
  /* False on the offline shell: amending needs the server (D-33-13). */
  amendable?: boolean;
  onAmended: () => void;
};

/* Worded, not just coloured: the difference between "on the server" and
   "on this phone" is the one a member must be able to read in a stairwell.
   "Sent" only shows on the offline shell, which keeps a sent unit listed
   because it cannot re-read the server's. */
function PendingChip({ pending, sending }: { pending: QueuedVisit | null; sending: boolean }) {
  return (
    <span className="shrink-0 rounded-md border border-dashed border-foreground-muted px-2 py-0.5 text-caption font-medium">
      {pending?.state === "synced" ? "Sent" : sending ? "Sending…" : "Not sent"}
    </span>
  );
}

function ServerRow({
  row,
  entry,
  sending,
  onSelect,
}: {
  row: Row;
  entry: HouseholdSummary;
  sending: boolean;
  /* Null where the unit cannot be opened. */
  onSelect: (() => void) | null;
}) {
  const { household, latestVisit, outstandingFollowUps } = entry;
  const line =
    "flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-2 text-left last:border-b-0";

  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-body font-semibold tabular-nums">{household.unitNumber}</span>
          {row.tonight ? <span className="text-caption text-foreground-muted">tonight</span> : null}
        </span>
        {household.name === null ? null : (
          <span className="block truncate text-caption text-foreground-muted">
            {household.name}
          </span>
        )}
        {latestVisit === null || row.pending !== null ? null : (
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

      {row.pending === null ? null : <PendingChip pending={row.pending} sending={sending} />}
      {row.latestVisit === null ? null : <InterestChip level={row.latestVisit.interestLevel} />}
    </>
  );

  return onSelect === null ? (
    <li className={line}>{content}</li>
  ) : (
    <li>
      <button type="button" onClick={onSelect} className={line}>
        {content}
      </button>
    </li>
  );
}

/*
 * A unit only this phone knows about. Not a button: amending needs the
 * server's row, and amends stay online-only (D-33-13, D-74-19).
 */
function QueuedRow({ row, sending }: { row: Row; sending: boolean }) {
  return (
    <li className="flex min-h-14 w-full items-center gap-3 border-b border-dashed border-border px-4 py-2 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-body font-semibold tabular-nums">{row.household.unitNumber}</span>
          {row.tonight ? <span className="text-caption text-foreground-muted">tonight</span> : null}
        </span>
        {row.household.name === null ? null : (
          <span className="block truncate text-caption text-foreground-muted">
            {row.household.name}
          </span>
        )}
      </span>
      <PendingChip pending={row.pending} sending={sending} />
      {row.latestVisit === null ? null : <InterestChip level={row.latestVisit.interestLevel} />}
    </li>
  );
}

export function UnitList({
  rows,
  inFlight,
  sessionId,
  teamIds = [],
  amendable = true,
  onAmended,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HouseholdSummary | null>(null);

  const visible = filterUnits(rows, query);
  const floors = groupByFloor(visible);
  /* Progress reports the outing, not the block's whole history: what a member
     wants to know is how far tonight has got. Unsent records count: the
     door was knocked whether or not the server has heard yet. */
  const progress = summariseProgress(sessionId === null ? rows : rows.filter((r) => r.tonight));

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
          {rows.length === 0
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
              {floor.units.map((row) => {
                const sending = row.pending !== null && inFlight.has(row.pending.id);
                const { entry } = row;
                return entry === null ? (
                  <QueuedRow key={row.key} row={row} sending={sending} />
                ) : (
                  <ServerRow
                    key={row.key}
                    row={row}
                    entry={entry}
                    sending={sending}
                    onSelect={
                      amendable
                        ? () => {
                            setSelected(entry);
                          }
                        : null
                    }
                  />
                );
              })}
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
