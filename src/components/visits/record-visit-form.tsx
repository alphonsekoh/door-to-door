"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { UnitNumber, WholeWords } from "@/components/ui/unit-number";
import { DockedActions } from "@/components/ui/docked-actions";
import { FollowUpSheet } from "@/components/follow-ups/follow-up-sheet";
import { PromoteButton } from "@/components/follow-ups/promote-button";
import { UndoMarkedButton } from "@/components/follow-ups/undo-marked-button";
import {
  type HistoryPanelHandle,
  HouseholdHistoryPanel,
  type Thread,
} from "@/components/households/household-history";
import { InterestPicker } from "@/components/ui/interest-picker";
import { NotSavedDialog } from "@/components/ui/not-saved-dialog";
import { useSyncQueue } from "@/components/sync/sync-provider";
import type {
  ActiveSession,
  HouseholdHistory,
  HouseholdSummary,
  InterestLevel,
  RecordedVisit,
  Religion,
  RevisitEntry,
} from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { failureLine } from "@/lib/failure-line";
import {
  UNDO_READY,
  type UndoState,
  markedDoneLine,
  owedAt,
  undoMarkedDone,
} from "@/lib/follow-ups/marked-done";
import { type RevisitState, listedUnitsIn, unitGate } from "@/lib/follow-ups/revisits";
import { type HouseholdAction, householdAction, offerLabel } from "@/lib/follow-ups/rights";
import { historyPath } from "@/lib/households/history-pages";
import { RELIGIONS } from "@/lib/households/religion";
import {
  HISTORY_UNREAD,
  LONGEST_SUMMARY,
  OVERDUE,
  READING_HISTORY,
  SEE_HISTORY,
  historyLine,
} from "@/lib/households/history-summary";
import { useOnline } from "@/lib/hooks/use-online";
import {
  type NotSaved,
  type NotSavedField,
  type Refusal,
  UNIT_REFUSAL,
  UNIT_TOO_LONG,
  VISIT_NOT_SAVED,
  notSavedByForm,
  notSavedFromServer,
  notSavedLine,
} from "@/lib/not-saved";
import { useEarlyInput } from "@/lib/hooks/use-early-input";
import { useLive } from "@/lib/hooks/use-live";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { useRole } from "@/lib/hooks/use-role";
import type { LocalThread } from "@/lib/offline/local-copy";
import { useShellState } from "@/lib/offline/shell-state";
import { newerThread, queuedInThread, threadAt } from "@/lib/offline/threads";
import { type VisitFields, buildVisitRequest } from "@/lib/sync/enqueue";
import { isEntryField } from "@/lib/whole-control";
import { type OutingAnswer, askOutingWithin } from "@/lib/sync/outing";
import type { QueuedVisit } from "@/lib/sync/types";
import {
  type UnitFault,
  nextUnitNumber,
  normaliseUnitNumber,
  unitNumberFault,
} from "@/lib/units/unit-number";
import { SheetPresence } from "@/components/ui/sheet";

export type FormErrors = { unitNumber?: string; interestLevel?: string };

/* The form's fields that can refuse a Save, in the order they are shown. */
const FIELDS = ["unitNumber", "interestLevel"] as const satisfies readonly NotSavedField[];

const UNIT_ERRORS: Record<UnitFault, string> = {
  blank: "Enter the unit number.",
  too_long: UNIT_TOO_LONG,
};

/* Validated here so a member sees the problem before a round trip; the
 * contract's generated schema still validates it on arrival. */
export function validateVisit(unitNumber: string, interestLevel: InterestLevel | null): FormErrors {
  const errors: FormErrors = {};
  const fault = unitNumberFault(unitNumber);
  if (fault !== null) {
    errors.unitNumber = UNIT_ERRORS[fault];
  }
  if (interestLevel === null) {
    errors.interestLevel = "Choose an interest level.";
  }
  return errors;
}

/*
 * One line beside Save when it refused, because with the details open the
 * fields at fault are scrolled away and a Save that silently does nothing is
 * a visit lost at the next door (D-33-29's slot, for validation too).
 */
export function blockedMessage(errors: FormErrors): string | null {
  if (errors.unitNumber === UNIT_ERRORS.blank) {
    return errors.interestLevel === undefined
      ? "Not saved. Enter the unit number."
      : "Not saved. Enter the unit number and choose an interest level.";
  }
  const said = [errors.unitNumber, errors.interestLevel].filter((error) => error !== undefined);
  return said.length === 0 ? null : `Not saved. ${said.join(" ")}`;
}

/*
 * The visit just saved. Its household is known once the server has it: at
 * once for a direct save, and for a queued one when it has been sent. Until
 * then no note can be anchored to it (D-33-11).
 */
type Saved = {
  visitId: string;
  householdId: string | null;
  unitNumber: string;
  /* What a note added after the save said, once one was. */
  noted: string | null;
  /* What the household offered before the form was cleared for the next
     door, so nothing is offered after the save that the server refuses. */
  action: HouseholdAction;
  /* In a follow-up session the server marks the household's follow-ups
     done with the visit: how many the list said it owed when saved, which
     the server says it marked (null until it has the visit), and Undo. */
  owed: number;
  marked: string[] | null;
  undo: UndoState;
  /* On the session's list as last read when saved: Undo or Reopen is then
     the way to change its follow-up, and no suggestion is offered. */
  onSessionList: boolean;
};

/*
 * A follow-up session's list for this form. Any unit in its blocks may be
 * recorded; the list says which are its revisits, so an off-list unit can be
 * told it is a one-off. `revisits` is undefined while the list is first
 * read, and null when it could not be: nothing is then said of any unit.
 * `recheck` reads it again, for Undo.
 */
export type FollowUpRule = {
  revisits: RevisitEntry[] | null | undefined;
  recheck?: () => Promise<RevisitEntry[] | null>;
};

const CHIP_STATE: Record<RevisitState, string> = {
  to_visit: "",
  visited: " · Visited",
  done: " · Done",
};

type Props = {
  blockId: string;
  known: HouseholdSummary[];
  /* Null in a door-to-door session, where every unit may be recorded. */
  followUp?: FollowUpRule | null;
  /* The running session, for what the history panel lets the member change. */
  active?: ActiveSession | null;
  initialUnit?: string;
  /* False while the session's kind is unknown: Save then promises, and
     guesses, no next unit. A follow-up session never guesses one. */
  guessNext?: boolean;
  /* The running session, so a queued record names the one it was saved in. */
  sessionId: string | null;
  /* Asks the server again which session is running, for a save made before
     the page learnt it. */
  loadSession: () => Promise<OutingAnswer>;
  /* Called after a save that went straight to the server; a queued save is
     announced by the queue once it is sent. */
  onRecorded: () => void;
  /* Whether anything typed would be lost by leaving now. */
  onDirtyChange?: (dirty: boolean) => void;
  /* The line under the unit field that sums up its history. None on the
     offline page: there it said the history could not be read at every
     known door, an error just where there is no signal (owner, 2026-11-18). */
  showHistoryLine?: boolean;
  /* In a follow-up session, the phone's stored threads of the units on the
     list, which open a unit's thread at once; and where a thread this form
     read goes, to be kept. */
  threads?: readonly LocalThread[];
  onThreadRead?: (history: HouseholdHistory) => void;
};

/* The status line for a save that went into the queue. */
function queuedStatus(unitNumber: string, record: QueuedVisit | undefined, sending: boolean) {
  const unit = <UnitNumber value={unitNumber} />;
  if (sending) return <>Sending {unit}…</>;
  /* One line at phone width, so the form below does not move when this
     changes; the bar above says what happens next. */
  if (record?.state === "held" || record?.state === "quarantined") {
    return <>Saved {unit} on this phone. Not sent.</>;
  }
  return <>Saved {unit} on this phone.</>;
}

/*
 * Words the line keeps room for, unseen, with their hyphens held as the
 * words on screen are (UnitNumber, WholeWords). Never drawn, copied or
 * searched, so only these may be non-breaking (D-111-36).
 */
function unbroken(words: string): string {
  return words.replaceAll("-", "\u2011");
}

/*
 * The words the line keeps room for from the save on (hold-text): "Saved …
 * on this phone." is longer than "Sending …" or "Saved …", and at large
 * text it wrapped a row taller just after Save, dropping the unit field
 * 48px.
 */
function heldWords(unitNumber: string): string {
  return `Saved ${unbroken(unitNumber)} on this phone.`;
}

const NO_THREADS: readonly LocalThread[] = [];

const OUTING_UNKNOWN =
  "Could not load the session, so this visit is not saved yet. Check your signal and try again.";
const NO_OUTING = "No session is running, so this visit is not saved yet.";

export function RecordVisitForm({
  blockId,
  known,
  followUp = null,
  active = null,
  initialUnit = "",
  guessNext = true,
  sessionId,
  loadSession,
  onRecorded,
  onDirtyChange,
  showHistoryLine = true,
  threads = NO_THREADS,
  onThreadRead,
}: Props) {
  const sync = useSyncQueue();
  const { userId, isAdmin } = useRole();
  const online = useOnline();
  const shell = useShellState();
  const formId = useId();
  const [unitNumber, setUnitNumber] = useState(initialUnit);
  /* The next unit filled in after a save, or the one picked from the list,
     is the app's guess, not input. */
  const [suggested, setSuggested] = useState(initialUnit);
  const [interestLevel, setInterestLevel] = useState<InterestLevel | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [religion, setReligion] = useState<Religion | "">("");
  const [description, setDescription] = useState("");
  const [details, setDetails] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  /* The summary beside Save belongs to a Save that was refused, not to a
     field left on blur. */
  const [refused, setRefused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Why a Save with a blank unit, or one the server refused, did nothing. */
  const [notSaved, setNotSaved] = useState<NotSaved | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<HouseholdHistory | null>(null);
  /* When the history last landed, which says whether a note is overdue as
     the panel, drawn as it lands, says it. */
  const [readAt, setReadAt] = useState(() => new Date());
  /* The household whose history could not be read, until another is typed. */
  const [unread, setUnread] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [noting, setNoting] = useState(false);
  /* Bumped after a follow-up changes, so the panel re-reads the unit. */
  const [reloadKey, setReloadKey] = useState(0);
  const savedLine = useRef<HTMLDivElement>(null);
  const historyPanel = useRef<HistoryPanelHandle>(null);
  /* Where OK on the Not saved dialog sends focus. */
  const unitField = useRef<HTMLInputElement>(null);
  const firstInterest = useRef<HTMLInputElement>(null);
  /* Synchronous, so two taps in one frame save one visit, even while the
     first waits on the follow-up list (D-74-44). */
  const sending = useRef(false);
  /* The save whose Undo is on its way: a second tap on it sends nothing,
     but the next save's Undo is not held up by it. */
  const undoing = useRef<string | null>(null);
  /* Save is disabled while it saves, which drops focus to the page. A
     refusal gives it back (#214); the Not saved pop-up opens after, and
     still sends it to the field (D-119-15). */
  const { notePress, refused: saveRefused } = useRefusalFocus();
  /* Undo is disabled while it reopens. One that got no answer stays for a
     second try and has focus back; one refused goes, and its button too. */
  const undoFocus = useRefusalFocus();
  const savedId = saved?.visitId ?? null;
  const live = useLive();
  /* The newest handler, so the read below is not started again when it changes. */
  const threadRead = useRef(onThreadRead);
  useEffect(() => {
    threadRead.current = onThreadRead;
  }, [onThreadRead]);

  /* A unit typed into the server's HTML, on a slow connection, before the
     page was live (#113); the interest level is the picker's own. */
  const typedEarly = useCallback(() => unitField.current?.value, []);
  useEarlyInput(typedEarly, unitNumber, setUnitNumber);

  /*
   * At large text the member scrolls down to the interest level before
   * Save, and the Saved line and the next unit, already filled in, were left
   * above the screen: a second tap then recorded that unit unseen. Each save
   * brings the line back into view, clear of the pinned chrome, before it is
   * painted, with the unit field right under it. Where it is already in
   * view, nothing moves. Only the line: with the block's chips, the top of
   * the form can be taller than the screen, and "nearest" then aligns its
   * bottom, which left the line and its Undo above the screen.
   */
  useLayoutEffect(() => {
    if (savedId !== null) savedLine.current?.scrollIntoView({ block: "nearest" });
  }, [savedId]);

  /*
   * Look up what is already known as soon as the unit matches one recorded
   * before, so the member reads it before knocking rather than after.
   */
  const match = known.find(
    (entry) => entry.household.unitNumber === normaliseUnitNumber(unitNumber),
  );
  const matchId = match?.household.id ?? null;

  useEffect(() => {
    if (matchId === null) {
      /*
       * Deferred rather than set inline: React warns that setting state
       * synchronously inside an effect triggers a cascading render.
       */
      const clear = setTimeout(() => {
        setHistory(null);
      }, 0);
      return () => {
        clearTimeout(clear);
      };
    }
    let cancelled = false;
    /* As a transition, as the block screen's answers are: one landing as a
       unit is typed must not put the unit back (#155). */
    void apiFetch<HouseholdHistory>(historyPath(matchId))
      .then((data) => {
        if (cancelled) return;
        startTransition(() => {
          setHistory(data);
          setReadAt(new Date());
          threadRead.current?.(data);
        });
      })
      .catch(() => {
        /*
         * A missing history must never block recording a visit. A failed
         * re-read after a follow-up change keeps what is already shown for
         * this unit rather than blanking it just before the knock.
         */
        if (cancelled) return;
        startTransition(() => {
          setHistory((current) => (current?.household.id === matchId ? current : null));
          setUnread(matchId);
        });
      });
    return () => {
      cancelled = true;
      /* Read again when typed again: not unread until that read fails. */
      setUnread(null);
    };
  }, [matchId, reloadKey]);

  const reset = useCallback((suggestion: string | null) => {
    setUnitNumber(suggestion ?? "");
    setSuggested(suggestion ?? "");
    setInterestLevel(null);
    setName("");
    setContact("");
    setReligion("");
    setDescription("");
    setDetails(false);
    setErrors({});
    setRefused(false);
    setHistory(null);
  }, []);

  function clearError(field: keyof FormErrors): void {
    setErrors((current) => {
      const { [field]: _fixed, ...rest } = current;
      return rest;
    });
  }

  const next = followUp === null && guessNext;
  const gate = followUp === null ? "ok" : unitGate(unitNumber, blockId, followUp.revisits);
  const chips = followUp?.revisits == null ? [] : listedUnitsIn(followUp.revisits, blockId);
  const typed = normaliseUnitNumber(unitNumber);
  /* The typed unit's own history: one still showing for the unit typed
     before must not decide what this one offers. */
  const here = history !== null && history.household.id === matchId ? history : null;
  /*
   * A unit on the follow-up session's list opens as a thread, above the
   * interest level (#275): at once from the phone's copy when it has one, or
   * once the unit's own read lands. It stays above the picker as the read
   * replaces the copy, so a late arrival can push the picker down (owner, 2026-11-24).
   * Every other unit keeps the history last in the form (D-196-4).
   */
  const cached = threadAt(threads, blockId, typed);
  const readHere: LocalThread | null =
    here === null ? null : { history: here, savedAt: readAt.getTime() };
  const onList = followUp?.revisits != null && gate === "ok";
  const shown =
    cached !== undefined || (onList && here !== null) ? newerThread(readHere, cached) : null;
  const thread: Thread | null =
    shown === null
      ? null
      : {
          cachedAt:
            shown === cached && (shell.active || (matchId !== null && unread === matchId))
              ? shown.savedAt
              : null,
          queued: queuedInThread(
            sync.records,
            blockId,
            typed,
            new Set(shown.history.visits.map((visit) => visit.id)),
            shown.savedAt,
          ),
        };
  /* What the line under the unit field says of its history, from the render
     the unit matches one of the block's. Without the line the history is
     still read, for the panel and for what a refusal off the list offers. */
  const unitLine = showHistoryLine
    ? historyLine(
        {
          matched: matchId !== null,
          history: here,
          unread: matchId !== null && unread === matchId,
        },
        readAt,
      )
    : null;
  /* Down to the history, last in the form. */
  const seeHistory = () => {
    historyPanel.current?.show();
  };
  const blocked = refused ? blockedMessage(errors) : null;

  const dirty =
    unitNumber.trim() !== suggested ||
    interestLevel !== null ||
    [name, contact, description].some((value) => value.trim() !== "") ||
    religion !== "";
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  /* Switching to the unit list unmounts the form, and what was typed goes. */
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  async function save(): Promise<void> {
    if (sending.current) return;
    const fault = unitNumberFault(unitNumber);
    setErrors(validateVisit(unitNumber, interestLevel));
    // Refused before the queue too, so a unit the server would refuse is
    // never held on the phone to fail later.
    if (fault !== null || interestLevel === null) {
      const refused: Refusal[] = [];
      if (fault !== null) refused.push(UNIT_REFUSAL[fault]);
      if (interestLevel === null) refused.push("interestLevel");
      setRefused(true);
      setNotSaved(notSavedByForm(refused, FIELDS));
      return;
    }

    notePress();
    sending.current = true;
    setFailure(null);
    setSaving(true);
    setSaved(null);
    const unit = normaliseUnitNumber(unitNumber);
    const action = householdAction(
      history?.household.unitNumber === unit ? history.followUps : [],
      { userId, isAdmin },
    );
    const owed = followUp === null ? 0 : owedAt(followUp.revisits, blockId, unit);
    const onSessionList = followUp !== null && gate === "ok";
    /* In a follow-up session the next door is the next household on the
       list, not the next number along, so nothing is guessed. */
    const nextUnit = next ? nextUnitNumber(unitNumber) : null;
    const fields: VisitFields = {
      blockId,
      unitNumber: unit,
      interestLevel,
      description,
      name,
      contact,
      religion,
    };

    /*
     * Into the queue first (D-33-10): the save is done the moment it is on
     * the phone, and sending never holds up the next door. Only if the queue
     * cannot take it (no IndexedDB, a full disk) does it go straight to the
     * server, where a failure keeps everything typed (D-25-8).
     *
     * Never queued without its session: sent later, it would join whichever
     * session is running then, with a new time. Everything typed is kept.
     * The ask is time-limited: in weak signal it stalls rather than fails.
     */
    if (sync.enqueue !== null) {
      const outing: OutingAnswer =
        sessionId === null
          ? await askOutingWithin(loadSession)
          : { kind: "running", id: sessionId };
      if (outing.kind !== "running") {
        setFailure(outing.kind === "none" ? NO_OUTING : OUTING_UNKNOWN);
        setSaving(false);
        saveRefused();
        sending.current = false;
        return;
      }
      try {
        const record = await sync.enqueue({ ...fields, sessionId: outing.id });
        reset(nextUnit);
        setSaved({
          visitId: record.id,
          householdId: null,
          unitNumber: unit,
          noted: null,
          action,
          owed,
          marked: null,
          undo: UNDO_READY,
          onSessionList,
        });
        setSaving(false);
        sending.current = false;
        return;
      } catch {
        // Falls through to the direct save.
      }
    }

    try {
      // Built as a queued one is, so both paths send the same values. The
      // id is generated here: it is what makes a retry idempotent.
      const visitRequest = buildVisitRequest(fields, Date.now());
      const visit = await apiFetch<RecordedVisit>("/visits", {
        method: "POST",
        body: JSON.stringify(visitRequest),
      });
      // Straight on to the next door, with the unit already filled in.
      reset(nextUnit);
      setSaved({
        visitId: visit.id,
        householdId: visit.householdId,
        unitNumber: unit,
        noted: null,
        action,
        owed,
        marked: visit.followUpsMarkedDone,
        undo: UNDO_READY,
        onSessionList,
      });
      onRecorded();
    } catch (error) {
      const refused = notSavedFromServer(error, FIELDS);
      if (refused === null) {
        setFailure(failureLine(error, "Could not save this visit."));
      } else {
        const named: FormErrors = {};
        for (const field of FIELDS) {
          const reason = refused.fields[field];
          if (reason !== undefined) named[field] = reason;
        }
        setErrors(named);
        setFailure(notSavedLine(refused));
        setNotSaved(refused);
      }
      saveRefused();
    } finally {
      setSaving(false);
      sending.current = false;
    }
  }

  /*
   * Reopens what this save marked done, and only that: the visit stays as
   * recorded. Its answer is dropped once the member has moved on to another
   * unit or saved again, and the list is read again whatever came of it.
   */
  async function undoMarked(visitId: string, ids: string[], before: UndoState): Promise<void> {
    if (undoing.current === visitId) return;
    undoing.current = visitId;
    const onThisSave = (undo: UndoState) => (current: Saved | null) =>
      current?.visitId === visitId ? { ...current, undo } : current;
    setSaved(onThisSave({ kind: "undoing" }));
    const outcome = await undoMarkedDone(
      visitId,
      ids,
      before.kind === "failed" ? before.reopened : 0,
    );
    /* No newer Undo has gone out since: an older answer landing late would
       spend the press noted for the newer one. */
    const newest = undoing.current === visitId;
    if (newest) undoing.current = null;
    /* The next unit's first keystroke can meet this answer (#155). Focus
       goes back in the same transition, as Undo is enabled again. */
    startTransition(() => {
      setSaved(onThisSave(outcome));
      if (newest && outcome.kind === "failed") undoFocus.refused();
    });
    void followUp?.recheck?.();
    onRecorded();
  }

  const refreshHistory = () => {
    /* Mark done answers while the next unit may be typed (#155). */
    startTransition(() => {
      setReloadKey((key) => key + 1);
    });
  };

  /* A queued save's household comes from the server's row once sent. */
  const queued = saved === null ? undefined : sync.records.find((r) => r.id === saved.visitId);
  const householdId = saved?.householdId ?? queued?.serverVisit?.householdId ?? null;
  const marked =
    saved?.marked ??
    (queued?.serverVisit == null ? null : (queued.serverVisit.followUpsMarkedDone ?? []));
  const markedLine =
    saved === null || followUp === null ? null : markedDoneLine(saved.owed, marked, saved.undo);
  /* Never on the offline shell: every follow-up change needs signal
     (D-35-9), so it waits for the session list's Reopen once there is some. */
  const undoIds = shell.active ? null : (markedLine?.undo ?? null);
  const status =
    saved === null ? null : householdId !== null ? (
      <>
        Saved <UnitNumber value={saved.unitNumber} />.
        {saved.noted === null ? "" : ` ${saved.noted}`}
      </>
    ) : (
      queuedStatus(saved.unitNumber, queued, sync.inFlight.has(saved.visitId))
    );
  /* Only what the household offered: a door already listed, or waiting for
     review, gets nothing a second note would be refused for, nor does a door
     on the follow-up session's list, which has its follow-up. */
  const offer = saved?.noted === null ? offerLabel(saved.action, saved.onSessionList) : null;
  const offerFor = (current: Saved, label: string) =>
    current.action.kind === "promote" ? (
      <PromoteButton
        suggestion={current.action.suggestion}
        onPromoted={(message) => {
          setSaved({ ...current, noted: message });
          setReloadKey((key) => key + 1);
        }}
        className="target-compact font-medium btn-text"
      />
    ) : (
      <button
        type="button"
        onClick={() => {
          setNoting(true);
        }}
        className="target-compact font-medium btn-text"
      >
        <WholeWords text={label} />
      </button>
    );
  /* Offered once the server has the visit, which the note is anchored to. */
  const offered =
    saved === null || householdId === null || offer === null ? null : offerFor(saved, offer);

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      /* A field taking focus comes clear of the docked Save and the nav, as
         in a sheet: a tap scrolls nothing, and Tab reveals only a textarea's
         caret, or in WebKit a text input's, so the field's scroll margins
         went unread (#238). Only the form's own fields: React bubbles focus
         through portals, and a sheet opened from here scrolls its own. A
         tile or the docked Save is where the thumb already is (D-214-9). */
      onFocus={(event) => {
        if (!event.currentTarget.contains(event.target) || !isEntryField(event.target)) return;
        event.target.scrollIntoView({ block: "nearest" });
      }}
      noValidate
      className="space-y-4"
    >
      {/* Until the page is live, Enter in the unit field would submit the
          form natively, reloading the page without the unit (R-68). A form
          whose first submit button is disabled is not submitted by Enter. */}
      {live ? null : <button type="submit" disabled hidden />}
      {saved === null ? null : (
        /* Kept short enough at 32px on an iPhone 13 to leave the unit field
           under it in view. Its rows touch: each action holds its own
           target's height, so a gap between them was height the field gave
           up. Its sides are px-2: with px-3, Linux's wider face set
           "Follow-up marked" a few px past one line. */
        <div
          ref={savedLine}
          role="status"
          className={`flex min-h-14 ${offer !== null && followUp !== null ? "min-h-offer-back" : ""} scroll-clear-chrome flex-wrap items-center justify-between gap-x-2 rounded-lg border border-border bg-surface-muted px-2 py-1 text-body saved-line`}
        >
          {/* Held from the save on, so the line never grows as the words
              change. With an offer coming, only where it has a row of its
              own: beside the words, the held ones would push it there. */}
          <span
            data-hold={heldWords(saved.unitNumber)}
            className={`${offer === null ? "hold-text" : "hold-text-narrow"} break-words`}
          >
            <span>{status}</span>
          </span>
          {/* Where the offer and the words cannot share a row, it has its
                own from the save on, held at the offer's height until the
                server has the visit: turning up as the send landed, it
                dropped the unit field a row at large text. */}
          {offer === null ? null : (
            <div className="flex offer-row">
              {offered ?? (
                <span
                  data-hold={unbroken(offer)}
                  className="offer-pending target-compact font-medium"
                />
              )}
            </div>
          )}
          {/* A row of its own from "Sending…" on, so the line keeps its
                height as the words change, as Back to the list's does.
                Undo follows the words in their line: beside them, at large
                text it squeezed them to a word a line. */}
          {markedLine === null ? null : (
            <div className="flex target-compact basis-full items-center">
              <p className="min-w-0 break-words">
                <WholeWords text={markedLine.text} />
                {undoIds === null ? null : (
                  <>
                    {" "}
                    <UndoMarkedButton
                      count={undoIds.length}
                      undoing={saved.undo.kind === "undoing"}
                      disabled={!online}
                      onUndo={() => {
                        undoFocus.notePress();
                        void undoMarked(saved.visitId, undoIds, saved.undo);
                      }}
                    />
                  </>
                )}
              </p>
            </div>
          )}
          {/* On a row of its own: beside the line, it fitted "Sending…"
                but not "Saved … on this phone.", so the line grew just after
                Save scrolled it into view, and the browser, holding the unit
                field still, pushed it up under the pinned count. */}
          {followUp === null ? null : (
            <div className="basis-full">
              <Link
                href="/"
                className="inline-flex target-compact items-center font-medium btn-text"
              >
                Back to the list
              </Link>
            </div>
          )}
        </div>
      )}

      {/* The form stays: a re-read that empties the block must not throw
            away a visit already half typed. */}
      <div>
        {/* Brought into view with the field after a refused Save (D-119-15),
            so it too must clear the pinned sync row. */}
        <label
          htmlFor="unitNumber"
          className="mb-1 block scroll-clear-chrome text-body font-medium"
        >
          Unit number
        </label>
        <input
          ref={unitField}
          id="unitNumber"
          value={unitNumber}
          onChange={(event) => {
            setUnitNumber(event.target.value);
            setSaved(null);
            // Cleared the moment it is fixed, so no red lingers while typing;
            // until then it says what is wrong with the unit as it now is.
            const now = unitNumberFault(event.target.value);
            if (now === null) clearError("unitNumber");
            else if (errors.unitNumber !== undefined) {
              setErrors((current) => ({ ...current, unitNumber: UNIT_ERRORS[now] }));
            }
          }}
          onBlur={() => {
            if (unitNumber.trim() === "") {
              setErrors((current) => ({ ...current, unitNumber: UNIT_ERRORS.blank }));
            }
          }}
          inputMode="text"
          autoComplete="off"
          placeholder="#05-123"
          aria-invalid={errors.unitNumber !== undefined}
          aria-describedby={
            errors.unitNumber !== undefined ? "unit-error" : gate === "ok" ? undefined : "unit-gate"
          }
          className="min-h-12 field scroll-clear-chrome"
        />
        {errors.unitNumber === undefined ? null : (
          <p id="unit-error" className="mt-1 field-error">
            {errors.unitNumber}
          </p>
        )}
        {gate === "off_list" ? (
          <p id="unit-gate" className="mt-1 text-caption text-foreground-muted">
            Not on this session&apos;s list. You can still record it.
          </p>
        ) : null}
        {/* The history's key facts, before knocking: the history itself is
            last in the form, below Save on a phone (#196). Only for a unit
            with a history to read; held from the render it matches at the
            longest it can say, so nothing below moves as it lands, and
            heard as it changes. Its lines are as tall as See history's
            target, so that target grows none. One weight throughout, as the
            held copy can only be: Overdue in a heavier one held the line a
            row taller than its words, at the default text on the commonest
            phones. */}
        {unitLine === null ? null : (
          <p
            id="unit-history"
            aria-live="polite"
            aria-atomic="true"
            data-hold={unbroken(LONGEST_SUMMARY)}
            className="hold-text leading-target text-caption font-medium tabular-nums"
          >
            <span>
              {unitLine.kind === "read" ? (
                <>
                  {unitLine.summary.followUp === null ? null : (
                    <>
                      <WholeWords text={unitLine.summary.followUp} />
                      {" · "}
                    </>
                  )}
                  {unitLine.summary.overdue ? (
                    <>
                      <span className="text-danger">{OVERDUE}</span>
                      {" · "}
                    </>
                  ) : null}
                  {unitLine.summary.visits}
                  {" · "}
                  <button type="button" onClick={seeHistory} className="btn-text">
                    {SEE_HISTORY}
                  </button>
                </>
              ) : (
                <span className="text-foreground-muted">
                  {unitLine.kind === "reading" ? READING_HISTORY : HISTORY_UNREAD}
                </span>
              )}
            </span>
          </p>
        )}
      </div>

      {/* Online and in the offline shell alike, so the chips below never
          turn up unexplained. Under the unit field, not above it: it comes
          with the session's answer, and drawn above, it dropped the field
          under a tap (#200). */}
      {followUp === null ? null : (
        <p className="notice-info text-caption">
          <span className="font-semibold">
            <WholeWords text="Follow-up session" />
          </span>{" "}
          · You can record any unit in this block, on the list or not.
        </p>
      )}

      {chips.length === 0 ? null : (
        <div>
          <p className="mb-1 text-caption font-medium text-foreground-muted">
            On the list in this block:
          </p>
          {/* Wraps at large text; a unit number never splits (D-111-36). */}
          <ul className="flex flex-wrap gap-2" aria-label="On the list in this block">
            {chips.map((chip) => (
              <li key={chip.householdId}>
                <button
                  type="button"
                  aria-pressed={chip.unitNumber === typed}
                  onClick={() => {
                    setUnitNumber(chip.unitNumber);
                    setSuggested(chip.unitNumber);
                    setSaved(null);
                    clearError("unitNumber");
                  }}
                  className={`min-h-11 press rounded-full border px-3 text-body tabular-nums ${
                    chip.unitNumber === typed
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border-strong bg-surface"
                  }`}
                >
                  <UnitNumber value={chip.unitNumber} />
                  {CHIP_STATE[chip.state]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A unit on the follow-up list: what was said at its door, under the
          chips and above the interest level, where it is read first. */}
      {shown === null || thread === null ? null : (
        <HouseholdHistoryPanel
          ref={historyPanel}
          key={shown.history.household.id}
          history={shown.history}
          active={active}
          atDoor
          onSessionList
          thread={thread}
          onChanged={refreshHistory}
        />
      )}

      <SheetPresence>
        {saved === null || householdId === null || !noting ? null : (
          <FollowUpSheet
            mode={{
              kind: "create",
              householdId,
              visitId: saved.visitId,
              unitNumber: saved.unitNumber,
            }}
            onClose={() => {
              setNoting(false);
            }}
            onSaved={(message) => {
              setNoting(false);
              setSaved({ ...saved, noted: message });
              setReloadKey((key) => key + 1);
            }}
          />
        )}
      </SheetPresence>

      <div>
        <p className="mb-1 text-body font-medium">Interest level</p>
        <InterestPicker
          value={interestLevel}
          onChange={(level) => {
            setInterestLevel(level);
            clearError("interestLevel");
          }}
          describedBy={errors.interestLevel === undefined ? undefined : "interest-error"}
          firstRef={firstInterest}
          optionClassName="scroll-clear-chrome"
        />
        {errors.interestLevel === undefined ? null : (
          <p id="interest-error" className="mt-1 field-error">
            {errors.interestLevel}
          </p>
        )}
      </div>

      {/*
        Everything below is optional and hidden by default. A silent door needs
        none of it, and the two-tap path must not scroll past six empty fields.
      */}
      <button
        type="button"
        onClick={() => {
          setDetails((open) => !open);
        }}
        aria-expanded={details}
        className="min-h-11 text-body font-medium btn-text"
      >
        {details ? "Hide details" : "Add details"}
      </button>

      {details ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="name" className="mb-1 block text-body font-medium">
              Name
            </label>
            <input
              id="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="min-h-12 field scroll-clear-chrome"
            />
          </div>

          <div>
            <label htmlFor="contact" className="mb-1 block text-body font-medium">
              Contact
            </label>
            <input
              id="contact"
              value={contact}
              inputMode="tel"
              onChange={(event) => {
                setContact(event.target.value);
              }}
              className="min-h-12 field scroll-clear-chrome"
            />
          </div>

          <div>
            <label htmlFor="religion" className="mb-1 block text-body font-medium">
              Religion
            </label>
            <select
              id="religion"
              value={religion}
              onChange={(event) => {
                setReligion(event.target.value as Religion | "");
              }}
              className="h-12 min-h-12 field scroll-clear-chrome"
            >
              <option value="">Not known</option>
              {RELIGIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="description" className="mb-1 block text-body font-medium">
              Notes
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              className="field scroll-clear-chrome py-2"
            />
          </div>
        </div>
      ) : null}

      {/* Last, after everything a member taps: it lands once the unit's
          history is read, and above the interest level it pushed the picker
          down under a thumb on its way to it (#196). A thread is the one
          exception, above (#275). */}
      {history === null || thread !== null ? null : (
        <HouseholdHistoryPanel
          ref={historyPanel}
          key={history.household.id}
          history={history}
          active={active}
          atDoor
          onChanged={refreshHistory}
        />
      )}

      <SheetPresence>
        {notSaved === null ? null : (
          <NotSavedDialog
            lead={VISIT_NOT_SAVED}
            reasons={notSaved.reasons}
            returnFocus={
              notSaved.field === "unitNumber"
                ? unitField
                : notSaved.field === "interestLevel"
                  ? firstInterest
                  : undefined
            }
            onDismiss={() => {
              setNotSaved(null);
            }}
          />
        )}
      </SheetPresence>

      {/*
        Sticky above the nav so the primary action stays reachable one-handed.
        A unit with history pushes the form well past a phone screen, and
        scrolling to find Save at every door is how recording gets skipped.
      */}
      <DockedActions>
        {/* Beside the button rather than atop the form: with the details open
            the top is scrolled away, and a failure there went unseen. */}
        {failure === null && blocked === null ? null : (
          <p role="alert" className="mb-2 notice-danger">
            {failure ?? blocked}
          </p>
        )}
        {/* Named, since a DockHost moves the bar out of the form. */}
        <SaveAndNext form={formId} saving={saving} next={next} />
      </DockedActions>
    </form>
  );
}

/* One box for Save and its stand-in, so nothing moves as one replaces the
   other. */
const SAVE_BUTTON = "min-h-14 w-full btn-primary rounded-xl text-title font-semibold";

/* The form's Save, naming its form: a DockHost moves the bar out of it. */
export function SaveAndNext({
  form,
  saving = false,
  next = true,
}: {
  form: string;
  saving?: boolean;
  next?: boolean;
}) {
  return (
    <button type="submit" form={form} disabled={saving} className={SAVE_BUTTON}>
      {saving ? "Saving…" : next ? "Save and next" : "Save"}
    </button>
  );
}

/*
 * What the block screen draws where Save docks until its script has run
 * (D-111-40). It has nothing to save with yet, so it says so, dimmed as a
 * Save that is busy, from the server's HTML alone (#156). A plain button
 * naming no form, so a tap cannot submit natively and reload the page; what
 * was typed and picked is kept (#113) for the Save that replaces it.
 */
export function SaveNotReady() {
  return (
    <button type="button" disabled className={SAVE_BUTTON}>
      Getting ready…
    </button>
  );
}
