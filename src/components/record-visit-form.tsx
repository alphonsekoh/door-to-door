"use client";

import { useCallback, useEffect, useState } from "react";
import { FollowUpSheet } from "@/components/follow-up-sheet";
import { HouseholdHistoryPanel } from "@/components/household-history";
import { InterestPicker } from "@/components/interest-picker";
import { useSyncQueue } from "@/components/sync-provider";
import type {
  HouseholdHistory,
  HouseholdSummary,
  InterestLevel,
  Religion,
  Visit,
} from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { type VisitFields, buildVisitRequest } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";
import { normaliseUnitNumber, nextUnitNumber } from "@/lib/unit-number";

const RELIGIONS: { value: Religion; label: string }[] = [
  { value: "buddhist", label: "Buddhist" },
  { value: "christian", label: "Christian" },
  { value: "hindu", label: "Hindu" },
  { value: "freethinker", label: "Freethinker" },
  { value: "others", label: "Others" },
];

export type FormErrors = { unitNumber?: string; interestLevel?: string };

/* Validated here so a member sees the problem before a round trip; the
 * contract's generated schema still validates it on arrival. */
export function validateVisit(unitNumber: string, interestLevel: InterestLevel | null): FormErrors {
  const errors: FormErrors = {};
  if (unitNumber.trim() === "") {
    errors.unitNumber = "Enter the unit number.";
  }
  if (interestLevel === null) {
    errors.interestLevel = "Choose an interest level.";
  }
  return errors;
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
  noted: boolean;
};

type Props = {
  blockId: string;
  known: HouseholdSummary[];
  /* The running outing, so a queued record names the one it was saved in. */
  sessionId: string | null;
  /* Asks the server again which outing is running, for a save made before
     the page learnt it. */
  loadSession: () => Promise<string | null>;
  /* Called after a save that went straight to the server; a queued save is
     announced by the queue once it is sent. */
  onRecorded: () => void;
};

/* The status line for a save that went into the queue. */
function queuedStatus(unitNumber: string, record: QueuedVisit | undefined, sending: boolean) {
  if (sending) return `Sending ${unitNumber}…`;
  /* One line at phone width, so the form below does not move when this
     changes; the bar above says what happens next. */
  if (record?.state === "held" || record?.state === "quarantined") {
    return `Saved ${unitNumber} on this phone. Not sent.`;
  }
  return `Saved ${unitNumber} on this phone.`;
}

const NO_OUTING =
  "Could not load the outing, so this visit is not saved yet. Check your signal and try again.";

export function RecordVisitForm({ blockId, known, sessionId, loadSession, onRecorded }: Props) {
  const sync = useSyncQueue();
  const [unitNumber, setUnitNumber] = useState("");
  const [interestLevel, setInterestLevel] = useState<InterestLevel | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [religion, setReligion] = useState<Religion | "">("");
  const [description, setDescription] = useState("");
  const [details, setDetails] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<HouseholdHistory | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [noting, setNoting] = useState(false);
  /* Bumped after a follow-up changes, so the panel re-reads the unit. */
  const [reloadKey, setReloadKey] = useState(0);

  /*
   * Look up what is already known as soon as the unit matches one recorded
   * before, so the member reads it before knocking rather than after.
   */
  const match = known.find(
    (entry) => entry.household.unitNumber === normaliseUnitNumber(unitNumber),
  );
  const matchId = match?.household.id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (matchId === null) {
      /*
       * Deferred rather than set inline: React warns that setting state
       * synchronously inside an effect triggers a cascading render.
       */
      const clear = setTimeout(() => {
        if (!cancelled) setHistory(null);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(clear);
      };
    }
    void apiFetch<HouseholdHistory>(`/households/${matchId}`)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        /*
         * A missing history must never block recording a visit. A failed
         * re-read after a follow-up change keeps what is already shown for
         * this unit rather than blanking it just before the knock.
         */
        if (!cancelled) {
          setHistory((current) => (current?.household.id === matchId ? current : null));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, reloadKey]);

  const reset = useCallback((suggestion: string | null) => {
    setUnitNumber(suggestion ?? "");
    setInterestLevel(null);
    setName("");
    setContact("");
    setReligion("");
    setDescription("");
    setDetails(false);
    setErrors({});
    setHistory(null);
  }, []);

  async function save(): Promise<void> {
    const found = validateVisit(unitNumber, interestLevel);
    setErrors(found);
    if (Object.keys(found).length > 0 || interestLevel === null) {
      return;
    }

    setFailure(null);
    setSaved(null);
    setSaving(true);
    const unit = normaliseUnitNumber(unitNumber);
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
     * Never queued without its outing: sent later, it would join whichever
     * outing is running then, with a new time. Everything typed is kept.
     */
    if (sync.enqueue !== null) {
      const outing = sessionId ?? (await loadSession());
      if (outing === null) {
        setFailure(NO_OUTING);
        setSaving(false);
        return;
      }
      try {
        const record = await sync.enqueue({ ...fields, sessionId: outing });
        reset(nextUnitNumber(unitNumber));
        setSaved({ visitId: record.id, householdId: null, unitNumber: unit, noted: false });
        setSaving(false);
        return;
      } catch {
        // Falls through to the direct save.
      }
    }

    try {
      // Built as a queued one is, so both paths send the same values. The
      // id is generated here: it is what makes a retry idempotent.
      const visitRequest = buildVisitRequest(fields, Date.now());
      const visit = await apiFetch<Visit>("/visits", {
        method: "POST",
        body: JSON.stringify(visitRequest),
      });
      // Straight on to the next door, with the unit already filled in.
      reset(nextUnitNumber(unitNumber));
      setSaved({
        visitId: visit.id,
        householdId: visit.householdId,
        unitNumber: unit,
        noted: false,
      });
      onRecorded();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not save this visit.");
    } finally {
      setSaving(false);
    }
  }

  /* A queued save's household comes from the server's row once sent. */
  const queued = saved === null ? undefined : sync.records.find((r) => r.id === saved.visitId);
  const householdId = saved?.householdId ?? queued?.serverVisit?.householdId ?? null;
  const status =
    saved === null
      ? null
      : householdId !== null
        ? `Saved ${saved.unitNumber}.${saved.noted ? " Follow-up added." : ""}`
        : queuedStatus(saved.unitNumber, queued, sync.inFlight.has(saved.visitId));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
      className="space-y-4"
    >
      {failure === null ? null : (
        <p
          role="alert"
          className="rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
        >
          {failure}
        </p>
      )}

      {status === null ? null : (
        <div
          role="status"
          className="flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-1 text-body"
        >
          <span className="break-words">{status}</span>
          {householdId === null || saved?.noted !== false ? null : (
            <button
              type="button"
              onClick={() => {
                setNoting(true);
              }}
              className="min-h-11 font-medium text-primary"
            >
              Add follow-up
            </button>
          )}
        </div>
      )}

      <div>
        <label htmlFor="unitNumber" className="mb-1 block text-body font-medium">
          Unit number
        </label>
        <input
          id="unitNumber"
          value={unitNumber}
          onChange={(event) => {
            setUnitNumber(event.target.value);
            setSaved(null);
          }}
          inputMode="text"
          autoComplete="off"
          placeholder="#05-123"
          aria-invalid={errors.unitNumber !== undefined}
          aria-describedby={errors.unitNumber === undefined ? undefined : "unit-error"}
          className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
        />
        {errors.unitNumber === undefined ? null : (
          <p id="unit-error" className="mt-1 text-caption text-interest-low">
            {errors.unitNumber}
          </p>
        )}
      </div>

      {history === null ? null : (
        <HouseholdHistoryPanel
          history={history}
          atDoor
          onChanged={() => {
            setReloadKey((key) => key + 1);
          }}
        />
      )}

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
          onSaved={() => {
            setNoting(false);
            setSaved({ ...saved, noted: true });
            setReloadKey((key) => key + 1);
          }}
        />
      )}

      <div>
        <p className="mb-1 text-body font-medium">Interest level</p>
        <InterestPicker
          value={interestLevel}
          onChange={setInterestLevel}
          describedBy={errors.interestLevel === undefined ? undefined : "interest-error"}
        />
        {errors.interestLevel === undefined ? null : (
          <p id="interest-error" className="mt-1 text-caption text-interest-low">
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
        className="min-h-11 text-body font-medium text-primary"
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
              className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
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
              className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
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
              className="h-12 min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
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
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body"
            />
          </div>
        </div>
      ) : null}

      {/*
        Sticky above the nav so the primary action stays reachable one-handed.
        A unit with history pushes the form well past a phone screen, and
        scrolling to find Save at every door is how recording gets skipped.
      */}
      <div className="sticky above-nav -mx-4 bg-background/95 px-4 py-3 backdrop-blur">
        <button
          type="submit"
          disabled={saving}
          className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save and next"}
        </button>
      </div>
    </form>
  );
}
