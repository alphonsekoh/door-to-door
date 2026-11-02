"use client";

import { useState } from "react";
import { FollowUpItem } from "@/components/follow-ups/follow-up-item";
import { FollowUpSheet, type FollowUpSheetMode } from "@/components/follow-ups/follow-up-sheet";
import { VisitByline } from "@/components/visits/visit-byline";
import type { ActiveSession, FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";
import { ADD_TO_LIST, SUGGEST, householdAction, marksDoneOnSave } from "@/lib/follow-ups/rights";
import { buildTimeline, sortOutstanding } from "@/lib/history/follow-ups";
import { formatDay } from "@/lib/history/dates";
import { useRole } from "@/lib/hooks/use-role";
import { SheetPresence } from "@/components/ui/sheet";

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
 * owed sits on top, then any suggestion waiting for an admin, which every
 * member sees so nobody suggests the door twice. Below, visits and resolved
 * notes read in one line, oldest first. An outstanding note appears only on
 * top: repeating it in the timeline pushed the interest picker below the
 * fold at the door.
 *
 * At the door (`atDoor`) a resolved note shrinks to one line with no
 * controls: resolved notes accumulate without limit, and full cards pushed
 * the required interest picker far below the fold. Reopening and editing
 * stay on the unit's own screen. In a follow-up session, saving the visit
 * marks what is owed on the session's list done, so those notes offer no
 * Mark done there, and one line says why.
 *
 * After any change the parent re-reads the unit from the server rather than
 * patching it here: the server stamps who resolved a note and when.
 */
export function HouseholdHistoryPanel({
  history,
  active,
  onChanged,
  anchorVisits = false,
  atDoor = false,
}: {
  history: HouseholdHistory;
  /* The running session, which decides what a member may change. */
  active: ActiveSession | null;
  onChanged: () => void;
  /* Offer a follow-up anchored to each visit row. */
  anchorVisits?: boolean;
  atDoor?: boolean;
}) {
  const { household, visits, followUps } = history;
  const { userId, isAdmin } = useRole();
  const [now] = useState(() => new Date());
  const [sheet, setSheet] = useState<FollowUpSheetMode | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const owed = sortOutstanding(followUps.filter((note) => note.status === "listed"));
  const markedOnSave = atDoor ? owed.filter((note) => marksDoneOnSave(note, active)).length : 0;
  const waiting = followUps.filter((note) => note.status === "suggested");
  const timeline = buildTimeline(
    visits,
    followUps.filter((note) => note.status === "listed" && note.doneAt !== null),
  );
  /* Only when the member could act on it: a door already on the list, or
     waiting for review, says so in the sections above instead. */
  const action = householdAction(followUps, { userId, isAdmin });
  const anchorLabel =
    action.kind === "add_to_list" ? ADD_TO_LIST : action.kind === "suggest" ? SUGGEST : null;

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
  const item = (note: FollowUp) => (
    <FollowUpItem
      note={note}
      now={now}
      active={active}
      atDoor={atDoor}
      onChanged={onChanged}
      onEdit={edit}
      onPromoted={setSent}
    />
  );

  return (
    <section
      aria-label="What we know about this unit"
      className="rounded-xl border border-border bg-surface-muted p-4"
    >
      {/* A door that has answered without giving a name is not one nobody answered. */}
      <p className="text-body font-semibold">
        {household.name ??
          (visits.some((visit) => visit.interestLevel !== "no_response")
            ? "Name not known"
            : "Nobody has answered here yet")}
      </p>
      {household.contact === null ? null : (
        <p className="text-caption text-foreground-muted">{household.contact}</p>
      )}

      {sent === null ? null : (
        <p role="status" className="mt-3 notice-success">
          {sent}
        </p>
      )}

      {owed.length > 0 ? (
        <div className="mt-3">
          <p className="text-caption font-semibold tracking-wide uppercase">
            On the follow-up list
          </p>
          <ul aria-label="On the follow-up list" className="mt-1 space-y-2">
            {owed.map((note) => (
              <li key={note.id}>{item(note)}</li>
            ))}
          </ul>
          {markedOnSave === 0 ? null : (
            <p className="mt-1 text-caption text-foreground-muted">
              {markedOnSave === 1
                ? "Saving your visit marks this done."
                : "Saving your visit marks these done."}
            </p>
          )}
        </div>
      ) : null}

      {waiting.length > 0 ? (
        <div className="mt-3">
          <p className="text-caption font-semibold tracking-wide uppercase">Waiting for review</p>
          <ul aria-label="Waiting for review" className="mt-1 space-y-2">
            {waiting.map((note) => (
              <li key={note.id}>{item(note)}</li>
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
                  {formatDay(entry.item.createdAt)}
                </span>
                <VisitByline visit={entry.item} />
                {entry.item.description === "" ? null : (
                  <p className="text-body text-foreground-muted">{entry.item.description}</p>
                )}
                {anchorVisits && anchorLabel !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      anchor(entry.item);
                    }}
                    className="min-h-11 text-body font-medium btn-text"
                  >
                    {anchorLabel}
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
                {item(entry.item)}
              </li>
            ),
          )}
        </ol>
      ) : null}

      <SheetPresence>
        {sheet === null ? null : (
          <FollowUpSheet
            mode={sheet}
            onClose={() => {
              setSheet(null);
            }}
            onSaved={(message) => {
              if (sheet.kind === "create") setSent(message);
              setSheet(null);
              onChanged();
            }}
          />
        )}
      </SheetPresence>
    </section>
  );
}
