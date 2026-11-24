"use client";

import {
  type Ref,
  startTransition,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FollowUpItem } from "@/components/follow-ups/follow-up-item";
import { FollowUpSheet, type FollowUpSheetMode } from "@/components/follow-ups/follow-up-sheet";
import { ThreadQueued, ThreadVisit } from "@/components/households/thread-entry";
import { VisitByline } from "@/components/visits/visit-byline";
import type { ActiveSession, FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import {
  ADD_TO_LIST,
  ON_THE_LIST,
  SUGGEST,
  WAITING_FOR_REVIEW,
  awaitsReview,
  householdAction,
  isOwed,
  marksDoneOnSave,
} from "@/lib/follow-ups/rights";
import { buildTimeline, sortOutstanding } from "@/lib/history/follow-ups";
import {
  type EarlierVisits,
  addEarlier,
  historyPath,
  holdVisits,
  keepFirstPage,
  timelineNotes,
} from "@/lib/households/history-pages";
import { formatDay, formatDayTime } from "@/lib/history/dates";
import { RELIGION_LABEL } from "@/lib/households/religion";
import type { QueuedVisit } from "@/lib/sync/types";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { useRole } from "@/lib/hooks/use-role";
import { stillAt } from "@/lib/still-at";
import { SheetPresence } from "@/components/ui/sheet";
import { WholeWords } from "@/components/ui/unit-number";

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
 * top: repeated in the timeline, it was read twice at the door.
 *
 * At the door (`atDoor`) a resolved note shrinks to one line with no
 * controls: resolved notes accumulate without limit, and full cards ran the
 * panel on for screen after screen. Reopening and editing stay on the unit's
 * own screen. In a follow-up session, saving the visit
 * marks what is owed on the session's list done, so those notes offer no
 * Mark done there, and one line says why.
 *
 * After any change the parent re-reads the unit from the server rather than
 * patching it here: the server stamps who resolved a note and when.
 *
 * The parent reads only the newest page of visits (#160). Older pages are
 * read here, on request, and held across the parent's re-reads of that first
 * page; parents key the panel by unit, so they never cross to another door.
 *
 * At the door it is last in the form, and the line under the unit field
 * leads down to it (See history, `show`), except as a thread (below).
 *
 * At a unit on a follow-up session's list the panel is the unit's thread
 * (#275): above the interest picker, newest first, with the religion when it
 * is known, this phone's own records on top, and older visits asked for below
 * the oldest shown. `cachedAt` is set when what is shown is the copy from the
 * phone's last read with signal, and the read for now did not come.
 */
export type Thread = { cachedAt: number | null; queued: readonly QueuedVisit[] };

export type HistoryPanelHandle = {
  /* Its top into view, clear of the pinned sync row, and focus on its first
     line, so a screen reader reads on from there. That line, not the
     panel: in WebKit a tap on anything in a focusable panel that is not
     itself focusable, every button among it, focused the panel and
     scrolled the page to it, away from the line Show earlier visits says. */
  show: () => void;
};

export function HouseholdHistoryPanel({
  history,
  active,
  onChanged,
  anchorVisits = false,
  atDoor = false,
  thread,
  ref,
}: {
  history: HouseholdHistory;
  /* The running session, which decides what a member may change. */
  active: ActiveSession | null;
  onChanged: () => void;
  /* Offer a follow-up anchored to each visit row. */
  anchorVisits?: boolean;
  atDoor?: boolean;
  thread?: Thread;
  ref?: Ref<HistoryPanelHandle>;
}) {
  const { household, followUps } = history;
  const { userId, isAdmin } = useRole();
  const [now] = useState(() => new Date());
  const [sheet, setSheet] = useState<FollowUpSheetMode | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<EarlierVisits | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const earlierControl = useRef<HTMLButtonElement>(null);
  /* Show earlier visits is disabled while it reads. A failed read gives it
     focus back, before the line is brought into view (D-208-4). */
  const earlierFocus = useRefusalFocus();
  const panel = useRef<HTMLElement>(null);
  const firstLine = useRef<HTMLParagraphElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      show: () => {
        firstLine.current?.focus({ preventScroll: true });
        panel.current?.scrollIntoView({ block: "start" });
      },
    }),
    [],
  );
  const earlierFailure = useRef<HTMLParagraphElement>(null);
  /* The first page shown last. When the parent reads it again, its visits
     join the older ones, so a visit stored in between leaves no gap. */
  const [shownFirst, setShownFirst] = useState(history);
  if (shownFirst !== history) {
    setShownFirst(history);
    setEarlier((current) => keepFirstPage(current, shownFirst));
  }
  const owed = sortOutstanding(followUps.filter(isOwed));
  const markedOnSave = atDoor ? owed.filter((note) => marksDoneOnSave(note, active)).length : 0;
  const waiting = followUps.filter(awaitsReview);
  const held = holdVisits(history, earlier);
  /* Still oldest first, so the trajectory reads down to the newest knock. */
  const timeline = buildTimeline(
    [...held.visits].reverse(),
    timelineNotes(
      followUps.filter((note) => note.status === "listed" && note.doneAt !== null),
      held,
    ),
  );
  /* Only when the member could act on it: a door already on the list, or
     waiting for review, says so in the sections above instead. */
  const action = householdAction(followUps, { userId, isAdmin });
  const anchorLabel =
    action.kind === "add_to_list" ? ADD_TO_LIST : action.kind === "suggest" ? SUGGEST : null;

  /* Drawn under the control, the failure landed under the docked Save at the
     door on an iPhone 13, and under a floating banner elsewhere, so the tap
     seemed to do nothing. It is brought into view clear of them before it is
     painted, as the Saved line is (#113), but only while the member is still
     at the control: one landing late, on poor signal, pulled the page 1,500px
     up from the note being typed. Only the line: at large text the control
     alone can fill the room left. */
  useLayoutEffect(() => {
    const line = earlierFailure.current;
    const control = earlierControl.current;
    if (line !== null && control !== null && stillAt(control)) {
      line.scrollIntoView({ block: "nearest" });
    }
  }, [earlierFailed]);

  const edit = (note: FollowUp) => {
    setSheet({ kind: "edit", note });
  };
  /* Lands in a transition, as the recording form's answers do: at the door,
     one landing as the next unit is typed must not put the unit back (#155).
     A failure keeps what is shown and never stands between the member and
     Save. */
  const showEarlier = () => {
    earlierFocus.notePress();
    setLoadingEarlier(true);
    setEarlierFailed(false);
    apiFetch<HouseholdHistory>(historyPath(household.id, held.next)).then(
      (page) => {
        startTransition(() => {
          setEarlier((current) => addEarlier(current, page));
          setLoadingEarlier(false);
        });
      },
      () => {
        /* In the same transition, so focus goes back as it is enabled. */
        startTransition(() => {
          setEarlierFailed(true);
          setLoadingEarlier(false);
          earlierFocus.refused();
        });
      },
    );
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

  const earlierVisits = held.more ? (
    <div className="mt-3">
      <button
        ref={earlierControl}
        type="button"
        disabled={loadingEarlier}
        onClick={showEarlier}
        className="min-h-11 w-full btn-secondary rounded-lg px-3 text-body font-medium"
      >
        {loadingEarlier ? "Loading…" : "Show earlier visits"}
      </button>
      {/* Only the door has a Save pinned over the page. */}
      {earlierFailed ? (
        <p
          ref={earlierFailure}
          role="status"
          className={`mt-1 text-caption text-foreground-muted ${atDoor ? "scroll-clear-chrome" : "scroll-clear-nav"}`}
        >
          Could not load earlier visits.
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <section
      ref={panel}
      aria-label="What we know about this unit"
      className={`rounded-xl border border-border bg-surface-muted p-4 ${atDoor ? "scroll-clear-chrome" : ""}`}
    >
      {/* A door that has answered without giving a name is not one nobody answered. */}
      <p ref={firstLine} tabIndex={atDoor ? -1 : undefined} className="text-body font-semibold">
        {household.name ?? (history.answered ? "Name not known" : "Nobody has answered here yet")}
      </p>
      {household.contact === null ? null : (
        <p className="text-caption text-foreground-muted">{household.contact}</p>
      )}
      {thread === undefined || household.religion === null ? null : (
        <p className="text-caption text-foreground-muted">
          Religion: {RELIGION_LABEL[household.religion]}
        </p>
      )}
      {thread?.cachedAt == null ? null : (
        <p className="text-caption text-foreground-muted">
          As last read with signal, {formatDayTime(thread.cachedAt)}.
        </p>
      )}

      {sent === null ? null : (
        <p role="status" className="mt-3 notice-success">
          {sent}
        </p>
      )}

      {owed.length > 0 ? (
        <div className="mt-3">
          <p className="text-caption font-semibold tracking-wide uppercase">
            <WholeWords text={ON_THE_LIST} />
          </p>
          <ul aria-label={ON_THE_LIST} className="mt-1 space-y-2">
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
          <p className="text-caption font-semibold tracking-wide uppercase">{WAITING_FOR_REVIEW}</p>
          <ul aria-label={WAITING_FOR_REVIEW} className="mt-1 space-y-2">
            {waiting.map((note) => (
              <li key={note.id}>{item(note)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Above the oldest visit shown, where the older ones will go. */}
      {thread === undefined ? earlierVisits : null}

      {thread === undefined ? null : (
        <>
          {thread.queued.length + timeline.length === 0 ? null : (
            <ol aria-label="Timeline" className="mt-3 space-y-3">
              {thread.queued.map((record) => (
                <ThreadQueued key={record.id} record={record} />
              ))}
              {[...timeline].reverse().map((entry) =>
                entry.kind === "visit" ? (
                  <ThreadVisit key={entry.item.id} visit={entry.item} />
                ) : (
                  <li key={entry.item.id} className="truncate text-caption text-foreground-muted">
                    <span className="font-medium">Follow-up done</span>
                    {" · "}
                    {entry.item.note}
                  </li>
                ),
              )}
            </ol>
          )}
          {earlierVisits}
        </>
      )}

      {thread !== undefined || timeline.length === 0 ? null : (
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
                    <WholeWords text={anchorLabel} />
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
      )}

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
