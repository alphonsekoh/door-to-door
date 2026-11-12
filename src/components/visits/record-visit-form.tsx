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
import { UnitNumber } from "@/components/ui/unit-number";
import { DockedActions } from "@/components/ui/docked-actions";
import { FollowUpSheet, SUGGESTION_SENT } from "@/components/follow-ups/follow-up-sheet";
import { PromoteButton } from "@/components/follow-ups/promote-button";
import { UndoMarkedButton } from "@/components/follow-ups/undo-marked-button";
import { HouseholdHistoryPanel } from "@/components/households/household-history";
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
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import {
  UNDO_READY,
  type UndoState,
  markedDoneLine,
  owedAt,
  undoMarkedDone,
} from "@/lib/follow-ups/marked-done";
import {
  type RevisitState,
  type UnitGate,
  listedUnitsIn,
  nothingListedHere,
  unitGate,
} from "@/lib/follow-ups/revisits";
import {
  ADD_TO_LIST,
  type HouseholdAction,
  SUGGEST,
  householdAction,
} from "@/lib/follow-ups/rights";
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
import { useRole } from "@/lib/hooks/use-role";
import { useShellState } from "@/lib/offline/shell-state";
import { type VisitFields, buildVisitRequest } from "@/lib/sync/enqueue";
import {
  OUTING_ASK_TIMEOUT_MS,
  type OutingAnswer,
  askOutingWithin,
  within,
} from "@/lib/sync/outing";
import type { QueuedVisit } from "@/lib/sync/types";
import {
  type UnitFault,
  nextUnitNumber,
  normaliseUnitNumber,
  unitNumberFault,
} from "@/lib/units/unit-number";
import { SheetPresence } from "@/components/ui/sheet";

const RELIGIONS: { value: Religion; label: string }[] = [
  { value: "buddhist", label: "Buddhist" },
  { value: "christian", label: "Christian" },
  { value: "hindu", label: "Hindu" },
  { value: "freethinker", label: "Freethinker" },
  { value: "others", label: "Others" },
];

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
};

/*
 * A follow-up session's rule for this form: a member records only at units
 * on its list. `revisits` is undefined while the list is first read, and
 * null when it could not be, which leaves the server to hold an unlisted
 * record until an admin adds it. `recheck` reads it again: a refusal is never
 * made against a list that may be stale, since the member was told to ask an
 * admin to add the unit, and the admin may just have.
 */
export type FollowUpRule = {
  revisits: RevisitEntry[] | null | undefined;
  recheck?: () => Promise<RevisitEntry[] | null>;
};

export const OFF_THE_LIST = "Not saved. This unit is not on this session's list.";

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
  /* That Save was refused because the server's list, read again just then,
     does not have the unit: held apart from the list on screen, which a
     slower read may not have updated yet. */
  const [offList, setOffList] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Why a Save with a blank unit, or one the server refused, did nothing. */
  const [notSaved, setNotSaved] = useState<NotSaved | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<HouseholdHistory | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [noting, setNoting] = useState(false);
  /* Suggesting the unit just refused, from the notice that refused it. */
  const [suggesting, setSuggesting] = useState(false);
  const [suggestSent, setSuggestSent] = useState(false);
  /* Bumped after a follow-up changes, so the panel re-reads the unit. */
  const [reloadKey, setReloadKey] = useState(0);
  const savedLine = useRef<HTMLDivElement>(null);
  /* Where OK on the Not saved dialog sends focus. */
  const unitField = useRef<HTMLInputElement>(null);
  const firstInterest = useRef<HTMLInputElement>(null);
  /* Synchronous, so two taps in one frame save one visit, even while the
     first waits on the follow-up list (D-74-44). */
  const sending = useRef(false);
  /* The save whose Undo is on its way: a second tap on it sends nothing,
     but the next save's Undo is not held up by it. */
  const undoing = useRef<string | null>(null);
  const savedId = saved?.visitId ?? null;
  const live = useLive();

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
    void apiFetch<HouseholdHistory>(`/households/${matchId}`)
      .then((data) => {
        if (cancelled) return;
        startTransition(() => {
          setHistory(data);
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
        });
      });
    return () => {
      cancelled = true;
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
    setOffList(false);
    setHistory(null);
  }, []);

  function clearError(field: keyof FormErrors): void {
    setErrors((current) => {
      const { [field]: _fixed, ...rest } = current;
      return rest;
    });
  }

  const next = followUp === null && guessNext;
  const gate = followUp === null ? "ok" : unitGate(unitNumber, blockId, followUp.revisits, isAdmin);
  const chips = followUp?.revisits == null ? [] : listedUnitsIn(followUp.revisits, blockId);
  const nothingHere = followUp !== null && nothingListedHere(followUp.revisits, blockId, isAdmin);
  const typed = normaliseUnitNumber(unitNumber);
  /* The typed unit's own history: one still showing for the unit typed
     before must not decide what this one offers. */
  const here = history !== null && history.household.id === matchId ? history : null;
  /* What the refusal says can be done: a suggestion only where the server
     would take one, and never "ask an admin" beside it. */
  const unlistedAction =
    gate !== "unlisted"
      ? null
      : here === null
        ? matchId === null
          ? "ask"
          : null
        : householdAction(here.followUps, { userId, isAdmin }).kind;
  const canSuggestHere = unlistedAction === "suggest";
  const blocked = refused
    ? (blockedMessage(errors) ?? (offList && gate !== "ok" ? OFF_THE_LIST : null))
    : null;

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

  /*
   * The list as the server holds it now, for a unit this screen would
   * refuse or has not been able to judge yet. Within the save's limit: in
   * weak signal the list on screen decides, or the server does once a
   * record is queued.
   */
  async function judgeAgain(rule: FollowUpRule): Promise<UnitGate> {
    const fresh =
      rule.recheck === undefined ? null : await within(rule.recheck(), null, OUTING_ASK_TIMEOUT_MS);
    return unitGate(unitNumber, blockId, fresh ?? rule.revisits ?? null, isAdmin);
  }

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

    sending.current = true;
    setFailure(null);
    setSaving(true);
    const judged =
      followUp !== null && (gate === "unlisted" || gate === "checking")
        ? await judgeAgain(followUp)
        : gate;
    if (judged === "unlisted") {
      setRefused(true);
      setOffList(true);
      setSaving(false);
      sending.current = false;
      return;
    }

    setSaved(null);
    setSuggestSent(false);
    const unit = normaliseUnitNumber(unitNumber);
    const action = householdAction(
      history?.household.unitNumber === unit ? history.followUps : [],
      { userId, isAdmin },
    );
    const owed = followUp === null ? 0 : owedAt(followUp.revisits, blockId, unit);
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
      });
      onRecorded();
    } catch (error) {
      const refused = notSavedFromServer(error, FIELDS);
      if (refused === null) {
        setFailure(
          error instanceof ApiRequestError && error.code === "not_on_follow_up_list"
            ? OFF_THE_LIST
            : error instanceof Error
              ? error.message
              : "Could not save this visit.",
        );
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
    if (undoing.current === visitId) undoing.current = null;
    setSaved(onThisSave(outcome));
    void followUp?.recheck?.();
    onRecorded();
  }

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
     review, gets nothing a second note would be refused for. A member in a
     follow-up session records only listed doors, which have their follow-up. */
  const offer = saved?.action.kind;
  const noteLabel =
    offer === "add_to_list"
      ? ADD_TO_LIST
      : offer === "suggest" && followUp === null
        ? SUGGEST
        : null;

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
      className="space-y-4"
    >
      {/* Until the page is live, Enter in the unit field would submit the
          form natively, reloading the page without the unit (R-68). A form
          whose first submit button is disabled is not submitted by Enter. */}
      {live ? null : <button type="submit" disabled hidden />}
      {status === null ? null : (
        <div
          ref={savedLine}
          role="status"
          className="flex min-h-14 scroll-clear-chrome flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-1 text-body"
        >
          <span className="break-words">{status}</span>
          {householdId === null || saved?.noted !== null ? null : noteLabel !== null ? (
            <button
              type="button"
              onClick={() => {
                setNoting(true);
              }}
              className="min-h-11 font-medium btn-text"
            >
              {noteLabel}
            </button>
          ) : saved.action.kind === "promote" ? (
            <PromoteButton
              suggestion={saved.action.suggestion}
              onPromoted={(message) => {
                setSaved({ ...saved, noted: message });
                setReloadKey((key) => key + 1);
              }}
              className="min-h-11 font-medium btn-text"
            />
          ) : null}
          {/* A row of its own from "Sending…" on, so the line keeps its
                height as the words change, as Back to the list's does. */}
          {saved === null || markedLine === null ? null : (
            <div className="flex min-h-11 basis-full items-center justify-between gap-x-3">
              <span className="min-w-0 break-words">{markedLine.text}</span>
              {undoIds === null ? null : (
                <UndoMarkedButton
                  count={undoIds.length}
                  undoing={saved.undo.kind === "undoing"}
                  disabled={!online}
                  onUndo={() => void undoMarked(saved.visitId, undoIds, saved.undo)}
                />
              )}
            </div>
          )}
          {/* On a row of its own: beside the line, it fitted "Sending…"
                but not "Saved … on this phone.", so the line grew just after
                Save scrolled it into view, and the browser, holding the unit
                field still, pushed it up under the pinned count. */}
          {followUp === null ? null : (
            <div className="basis-full">
              <Link href="/" className="inline-flex min-h-11 items-center font-medium btn-text">
                Back to the list
              </Link>
            </div>
          )}
        </div>
      )}

      {/* The form stays: a re-read that empties the block must not throw
            away a visit already half typed. */}
      {nothingHere ? (
        <div role="status" className="notice-info">
          <p className="break-words">
            Nothing in this block is on this session&apos;s list. Visits can be recorded only at the
            households on the session&apos;s list.
          </p>
          <Link href="/" className="mt-1 inline-flex min-h-11 items-center font-medium btn-text">
            Back to the list
          </Link>
        </div>
      ) : null}

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
            setSuggestSent(false);
            setOffList(false);
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
            errors.unitNumber !== undefined
              ? "unit-error"
              : gate === "ok" || gate === "checking"
                ? undefined
                : "unit-gate"
          }
          className="min-h-12 field scroll-clear-chrome"
        />
        {errors.unitNumber === undefined ? null : (
          <p id="unit-error" className="mt-1 field-error">
            {errors.unitNumber}
          </p>
        )}
        {gate === "unlisted" ? (
          <div id="unit-gate" className="mt-2 notice-info">
            <p className="break-words">
              <UnitNumber value={typed} /> is not on this session&apos;s list, so it can&apos;t be
              recorded in this session.
              {suggestSent
                ? null
                : canSuggestHere
                  ? " Should it be? Suggest it for an admin to review."
                  : unlistedAction === "waiting"
                    ? " A suggestion to add it is waiting for an admin to review."
                    : unlistedAction === "listed"
                      ? " It is on the follow-up list; ask an admin to add it to this session."
                      : unlistedAction === null
                        ? null
                        : " Ask an admin to add it."}
            </p>
            {suggestSent ? (
              <p role="status" className="mt-1 font-medium">
                {SUGGESTION_SENT}
              </p>
            ) : canSuggestHere ? (
              <button
                type="button"
                onClick={() => {
                  setSuggesting(true);
                }}
                className="mt-1 min-h-11 font-medium btn-text"
              >
                {SUGGEST}
              </button>
            ) : null}
          </div>
        ) : gate === "unknown" ? (
          <p id="unit-gate" className="mt-1 text-caption text-foreground-muted">
            Could not check this session&apos;s list. A visit to a unit not on it will wait on this
            phone until an admin adds it.
          </p>
        ) : gate === "admin_override" ? (
          <p id="unit-gate" className="mt-1 text-caption text-foreground-muted">
            Not on this session&apos;s list. You can still record it as an admin.
          </p>
        ) : null}
      </div>

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
                    setSuggestSent(false);
                    setOffList(false);
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

      {history === null ? null : (
        <HouseholdHistoryPanel
          history={history}
          active={active}
          atDoor
          onChanged={() => {
            setReloadKey((key) => key + 1);
          }}
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

      <SheetPresence>
        {suggesting && here !== null ? (
          <FollowUpSheet
            mode={{
              kind: "create",
              householdId: here.household.id,
              visitId: null,
              unitNumber: here.household.unitNumber,
            }}
            onClose={() => {
              setSuggesting(false);
            }}
            onSaved={() => {
              setSuggesting(false);
              setSuggestSent(true);
              setReloadKey((key) => key + 1);
            }}
          />
        ) : null}
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
              className="min-h-12 field"
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
              className="min-h-12 field"
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
              className="h-12 min-h-12 field"
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
              className="field py-2"
            />
          </div>
        </div>
      ) : null}

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

/*
 * The form's Save. With no form named it is the stand-in the block screen
 * draws before the page is live: a plain button, so a tap cannot submit
 * natively and reload the page. Such a tap saves nothing, but what was typed
 * and picked before it is kept (#113), so the next tap saves it.
 */
export function SaveAndNext({
  form,
  saving = false,
  next = true,
}: {
  form?: string;
  saving?: boolean;
  next?: boolean;
}) {
  return (
    <button
      type={form === undefined ? "button" : "submit"}
      form={form}
      disabled={saving}
      className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
    >
      {saving ? "Saving…" : next ? "Save and next" : "Save"}
    </button>
  );
}
