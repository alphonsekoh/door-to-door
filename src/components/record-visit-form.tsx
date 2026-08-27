"use client";

import { useCallback, useEffect, useState } from "react";
import { HouseholdHistoryPanel } from "@/components/household-history";
import { InterestPicker } from "@/components/interest-picker";
import type {
  HouseholdHistory,
  HouseholdSummary,
  InterestLevel,
  Religion,
} from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { normaliseUnitNumber, nextUnitNumber } from "@/lib/unit-number";
import { uuidv7 } from "@/lib/uuid";

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

type Props = {
  blockId: string;
  known: HouseholdSummary[];
  onRecorded: () => void;
};

export function RecordVisitForm({ blockId, known, onRecorded }: Props) {
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
        // A missing history must never block recording a visit.
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

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
    setSaving(true);
    try {
      await apiFetch("/visits", {
        method: "POST",
        body: JSON.stringify({
          // Generated here: the id is what makes a retry idempotent.
          id: uuidv7(),
          blockId,
          unitNumber: normaliseUnitNumber(unitNumber),
          interestLevel,
          description,
          clientCreatedAt: new Date().toISOString(),
          name: name.trim() === "" ? null : name.trim(),
          contact: contact.trim() === "" ? null : contact.trim(),
          religion: religion === "" ? null : religion,
        }),
      });
      // Straight on to the next door, with the unit already filled in.
      reset(nextUnitNumber(unitNumber));
      onRecorded();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not save this visit.");
    } finally {
      setSaving(false);
    }
  }

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

      <div>
        <label htmlFor="unitNumber" className="mb-1 block text-body font-medium">
          Unit number
        </label>
        <input
          id="unitNumber"
          value={unitNumber}
          onChange={(event) => {
            setUnitNumber(event.target.value);
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

      {history === null ? null : <HouseholdHistoryPanel history={history} />}

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
              className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
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
