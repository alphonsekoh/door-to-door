"use client";

import { useState } from "react";
import { InterestPicker } from "@/components/interest-picker";
import type { HouseholdSummary, InterestLevel, Religion, Visit } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { useRole } from "@/lib/use-role";

const RELIGIONS: { value: Religion; label: string }[] = [
  { value: "buddhist", label: "Buddhist" },
  { value: "christian", label: "Christian" },
  { value: "hindu", label: "Hindu" },
  { value: "freethinker", label: "Freethinker" },
  { value: "others", label: "Others" },
];

export type VisitChanges = {
  interestLevel?: InterestLevel;
  description?: string;
  name?: string;
  contact?: string;
  religion?: Religion;
};

type Draft = {
  interestLevel: InterestLevel;
  description: string;
  name: string;
  contact: string;
  religion: Religion | "";
};

/*
 * Only what actually moved. The contract requires at least one property, and
 * sending an untouched field would bump updatedAt for nothing - which then
 * loses a real edit that arrives later from a queued device.
 *
 * Identity fields are never sent as null: clearing a name is not something the
 * model allows, because a later visit that learns nothing must not erase what
 * an earlier one recorded.
 */
export function diffVisit(before: Draft, after: Draft): VisitChanges {
  const changes: VisitChanges = {};
  if (after.interestLevel !== before.interestLevel) changes.interestLevel = after.interestLevel;
  if (after.description !== before.description) changes.description = after.description;

  const name = after.name.trim();
  if (name !== "" && name !== before.name) changes.name = name;
  const contact = after.contact.trim();
  if (contact !== "" && contact !== before.contact) changes.contact = contact;
  if (after.religion !== "" && after.religion !== before.religion)
    changes.religion = after.religion;

  return changes;
}

function draftFrom(entry: HouseholdSummary): Draft {
  return {
    interestLevel: entry.latestVisit?.interestLevel ?? "no_response",
    description: entry.latestVisit?.description ?? "",
    name: entry.household.name ?? "",
    contact: entry.household.contact ?? "",
    religion: entry.household.religion ?? "",
  };
}

type Props = {
  entry: HouseholdSummary;
  onClose: () => void;
  onSaved: () => void;
};

export function AmendVisitSheet({ entry, onClose, onSaved }: Props) {
  const { userId, isAdmin } = useRole();
  const original = draftFrom(entry);
  const [draft, setDraft] = useState<Draft>(original);
  const [details, setDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const visit = entry.latestVisit;
  /*
   * Affordance only - the handler re-checks. Showing the refusal here saves a
   * member filling in a form that was always going to be rejected.
   */
  const mayAmend = visit !== null && (isAdmin || visit.member.id === userId);

  function set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /* The visit is passed in rather than read from scope: it is only ever
     non-null where the form renders, and taking it as an argument keeps that
     fact in the type system instead of behind a guard no caller can trip. */
  async function save(target: Visit): Promise<void> {
    const changes = diffVisit(original, draft);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    setFailure(null);
    setSaving(true);
    try {
      await apiFetch(`/visits/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      onSaved();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not save this change.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      {/* Tapping the backdrop closes; it is a plain button so it is reachable
          by keyboard and screen reader rather than being a click trap. */}
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Amend ${entry.household.unitNumber}`}
        className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background px-4 pt-4 inset-safe-bottom"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-title font-semibold">{entry.household.unitNumber}</p>
          <button type="button" onClick={onClose} className="min-h-11 text-body text-primary">
            Cancel
          </button>
        </div>

        {visit === null ? (
          <p className="py-6 text-body text-foreground-muted">
            Nothing has been recorded here yet. Record a visit first.
          </p>
        ) : !mayAmend ? (
          <div className="py-4">
            <p className="text-body">
              Recorded by {visit.member.name ?? "another member"}. Only they or an admin can amend
              it.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(visit);
            }}
            noValidate
            className="space-y-4 py-4"
          >
            {failure === null ? null : (
              <p
                role="alert"
                className="rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
              >
                {failure}
              </p>
            )}

            {/* Interest first: a mistap on the picker is the correction this
                screen exists for, and it should need no scrolling. */}
            <div>
              <p className="mb-1 text-body font-medium">Interest level</p>
              <InterestPicker
                value={draft.interestLevel}
                onChange={(value) => {
                  set("interestLevel", value);
                }}
              />
            </div>

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
                  <label htmlFor="amend-name" className="mb-1 block text-body font-medium">
                    Name
                  </label>
                  <input
                    id="amend-name"
                    value={draft.name}
                    onChange={(event) => {
                      set("name", event.target.value);
                    }}
                    className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
                  />
                </div>

                <div>
                  <label htmlFor="amend-contact" className="mb-1 block text-body font-medium">
                    Contact
                  </label>
                  <input
                    id="amend-contact"
                    value={draft.contact}
                    inputMode="tel"
                    onChange={(event) => {
                      set("contact", event.target.value);
                    }}
                    className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
                  />
                </div>

                <div>
                  <label htmlFor="amend-religion" className="mb-1 block text-body font-medium">
                    Religion
                  </label>
                  <select
                    id="amend-religion"
                    value={draft.religion}
                    onChange={(event) => {
                      set("religion", event.target.value as Religion | "");
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
              </div>
            ) : null}

            <div>
              <label htmlFor="amend-description" className="mb-1 block text-body font-medium">
                Notes
              </label>
              <textarea
                id="amend-description"
                rows={3}
                value={draft.description}
                onChange={(event) => {
                  set("description", event.target.value);
                }}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body"
              />
            </div>

            {/* Sticky inside the sheet: with details open the form runs past
                the sheet's height, and a Save you have to scroll for is a Save
                that does not get pressed. */}
            <div className="sticky bottom-0 -mx-4 bg-background/95 px-4 py-3 backdrop-blur">
              <button
                type="submit"
                disabled={saving}
                className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
