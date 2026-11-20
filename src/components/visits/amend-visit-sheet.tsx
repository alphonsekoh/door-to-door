"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { InterestPicker } from "@/components/ui/interest-picker";
import { VisitByline } from "@/components/visits/visit-byline";
import type { HouseholdSummary, InterestLevel, Religion, Visit } from "@/generated/types.gen";
import { amendRoute, describeAmendFailure } from "@/lib/history/amend";
import { apiFetch } from "@/lib/api-client";
import { useRefusalFocus } from "@/lib/hooks/use-refusal-focus";
import { useRole } from "@/lib/hooks/use-role";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";

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
  /* Teams the server has said the viewer is on now (D-74-17); never read off
     the visit's own snapshot, which is display-only. */
  teamIds?: readonly string[];
  onClose: () => void;
  onSaved: () => void;
};

export function AmendVisitSheet({ entry, teamIds = [], onClose, onSaved }: Props) {
  const { userId, isAdmin } = useRole();
  const original = draftFrom(entry);
  const [draft, setDraft] = useState<Draft>(original);
  const [details, setDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* Synchronous, so two taps in one frame send one request (D-74-44). */
  const sending = useRef(false);
  /* Back on Save changes, inside the sheet, from the page it fell to. Above
     the failure's scroll, which comes after focus is back (D-208-4). */
  const { notePress, refused } = useRefusalFocus();
  const said = useRef<HTMLParagraphElement>(null);

  /*
   * Before it is painted, and clear of the bar Save changes is pinned in:
   * the body's scroll padding counts the bar as covered. Drawn at the top of
   * the form, a failure was said above the view, and bringing it there would
   * pull the form back from Notes or the details by up to its whole length
   * (#225). The alert takes no focus.
   */
  useLayoutEffect(() => {
    if (failure !== null) said.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

  const visit = entry.latestVisit;
  /*
   * Affordance only - the handler re-checks. Showing the refusal here saves a
   * member filling in a form that was always going to be rejected.
   */
  const route = visit === null ? null : amendRoute(visit, { userId, isAdmin, teamIds });
  const mayAmend = route !== null;
  const othersRecord = visit !== null && visit.member.id !== userId;

  /* Asked before a flick or a stray tap loses a correction. */
  const discard =
    Object.keys(diffVisit(original, draft)).length === 0
      ? undefined
      : { title: "Discard your changes?", detail: "The visit stays as it was recorded." };

  function set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /* The visit is passed in rather than read from scope: it is only ever
     non-null where the form renders, and taking it as an argument keeps that
     fact in the type system instead of behind a guard no caller can trip. */
  async function save(target: Visit): Promise<void> {
    if (sending.current) return;
    const changes = diffVisit(original, draft);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    notePress();
    sending.current = true;
    setFailure(null);
    setSaving(true);
    try {
      await apiFetch(`/visits/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      onSaved();
    } catch (error) {
      setFailure(describeAmendFailure(error, route));
      refused();
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  return (
    <Sheet
      label={`Amend ${entry.household.unitNumber}`}
      title={<UnitNumber value={entry.household.unitNumber} />}
      onClose={onClose}
      discard={discard}
    >
      {visit === null ? (
        <p className="py-6 text-body text-foreground-muted">
          Nothing has been recorded here yet. Record a visit first.
        </p>
      ) : !mayAmend ? (
        <div className="space-y-2 py-4">
          <VisitByline visit={visit} prefix="Recorded by " />
          <p className="text-body">Only they, their current teammates or an admin can amend it.</p>
        </div>
      ) : (
        /* Nothing under the bar, as in the other sheets: padding there let
           the pinned bar rest a rem higher at the end of the scroll than
           anywhere else, so bringing a failure into view dropped Save
           changes by that rem under the thumb. */
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(visit);
          }}
          noValidate
          className="space-y-4 pt-4"
        >
          {othersRecord ? <VisitByline visit={visit} prefix="Recorded by " /> : null}

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
            className="min-h-11 text-body font-medium btn-text"
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
                  className="min-h-12 field"
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
                  className="min-h-12 field"
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
              className="field py-2"
            />
          </div>

          {/* Beside Save changes rather than atop the form, as on the record
              form: with the details open or the text large, the top is
              scrolled away from where Save is pressed. Out of the bar, which
              is chrome-sized and pinned: a reader-sized failure in it could
              outgrow a small phone's sheet and lose its top. */}
          {failure === null ? null : (
            <p ref={said} role="alert" className="notice-danger">
              {failure}
            </p>
          )}

          {/* Sticky inside the sheet: with details open the form runs past
                the sheet's height, and a Save you have to scroll for is a Save
                that does not get pressed. */}
          <SheetActions>
            <button
              type="submit"
              disabled={saving}
              className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </SheetActions>
        </form>
      )}
    </Sheet>
  );
}
