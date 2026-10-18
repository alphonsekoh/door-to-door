"use client";

import { useState } from "react";
import { FollowUpItem } from "@/components/follow-up-item";
import { FollowUpSheet, type FollowUpSheetMode } from "@/components/follow-up-sheet";
import { VisitByline } from "@/components/visit-byline";
import type { FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";
import { buildTimeline, sortOutstanding } from "@/lib/follow-ups";

const INTEREST_LABEL: Record<string, string> = {
  no_response: "No response",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/*
 * What is already known about this unit, shown before the member knocks.
 *
 * This is the reason the household/visit split exists: arriving at a door
 * already knowing what was said last time, and what was promised. What is
 * still owed sits on top; below it, visits and resolved notes read in one
 * line, oldest first. An outstanding note appears only on top: repeating it
 * in the timeline pushed the interest picker screens below the fold at the
 * door.
 *
 * At the door (`atDoor`) a resolved note shrinks to one line with no
 * controls: resolved notes accumulate without limit, and full cards pushed
 * the required interest picker far below the fold. Reopening and editing
 * stay on the unit's own screen.
 *
 * After any change the parent re-reads the unit from the server rather than
 * patching it here: the server stamps who resolved a note and when.
 */
export function HouseholdHistoryPanel({
  history,
  onChanged,
  anchorVisits = false,
  atDoor = false,
}: {
  history: HouseholdHistory;
  onChanged: () => void;
  /* Offer "Follow up on this visit" on each visit row. */
  anchorVisits?: boolean;
  atDoor?: boolean;
}) {
  const { household, visits, followUps } = history;
  const [now] = useState(() => new Date());
  const [sheet, setSheet] = useState<FollowUpSheetMode | null>(null);
  const outstanding = sortOutstanding(followUps);
  const timeline = buildTimeline(
    visits,
    followUps.filter((note) => note.doneAt !== null),
  );

  const edit = (note: FollowUp) => {
    setSheet({ kind: "edit", note });
  };
  const anchor = (visit: Visit) => {
    setSheet({
      kind: "create",
      householdId: household.id,
      visitId: visit.id,
      unitNumber: household.unitNumber,
    });
  };

  return (
    <section
      aria-label="What we know about this unit"
      className="rounded-xl border border-border bg-surface-muted p-4"
    >
      <p className="text-body font-semibold">{household.name ?? "Nobody has answered here yet"}</p>
      {household.contact === null ? null : (
        <p className="text-caption text-foreground-muted">{household.contact}</p>
      )}

      {outstanding.length > 0 ? (
        <div className="mt-3">
          <p className="text-caption font-semibold tracking-wide uppercase">
            {outstanding.length === 1 ? "Outstanding follow-up" : "Outstanding follow-ups"}
          </p>
          <ul aria-label="Outstanding follow-ups" className="mt-1 space-y-2">
            {outstanding.map((note) => (
              <li key={note.id}>
                <FollowUpItem note={note} now={now} onChanged={onChanged} onEdit={edit} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {timeline.length > 0 ? (
        <ol aria-label="Timeline" className="mt-3 space-y-3">
          {timeline.map((entry) =>
            entry.kind === "visit" ? (
              <li key={entry.item.id} className="text-caption">
                <span className="font-medium">
                  {INTEREST_LABEL[entry.item.interestLevel] ?? entry.item.interestLevel}
                </span>
                <span className="text-foreground-muted">
                  {" · "}
                  {new Date(entry.item.createdAt).toLocaleDateString()}
                </span>
                <VisitByline visit={entry.item} />
                {entry.item.description === "" ? null : (
                  <p className="text-body text-foreground-muted">{entry.item.description}</p>
                )}
                {anchorVisits ? (
                  <button
                    type="button"
                    onClick={() => {
                      anchor(entry.item);
                    }}
                    className="min-h-11 text-body font-medium text-primary"
                  >
                    Follow up on this visit
                  </button>
                ) : null}
              </li>
            ) : atDoor ? (
              <li key={entry.item.id} className="truncate text-caption text-foreground-muted">
                <span className="font-medium">Follow-up done</span>
                {" · "}
                {entry.item.note}
              </li>
            ) : (
              <li key={entry.item.id}>
                <p className="mb-1 text-caption font-medium text-foreground-muted">Follow-up</p>
                <FollowUpItem note={entry.item} now={now} onChanged={onChanged} onEdit={edit} />
              </li>
            ),
          )}
        </ol>
      ) : null}

      {sheet === null ? null : (
        <FollowUpSheet
          mode={sheet}
          onClose={() => {
            setSheet(null);
          }}
          onSaved={() => {
            setSheet(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
