"use client";

import { useRef, useState, type RefObject } from "react";
import { InterestPicker } from "@/components/ui/interest-picker";
import { NotSavedDialog } from "@/components/ui/not-saved-dialog";
import { Sheet, SheetActions, SheetPresence } from "@/components/ui/sheet";
import type { Block, InterestLevel, RecordedVisit, User } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import {
  type NotSaved,
  type NotSavedField,
  type Refusal,
  UNIT_REFUSAL,
  VISIT_NOT_SAVED,
  notSavedByForm,
  notSavedFromServer,
  notSavedLine,
} from "@/lib/not-saved";
import { normaliseUnitNumber, unitNumberFault } from "@/lib/units/unit-number";
import { uuidv7 } from "@/lib/uuid";

/* In the order the form shows them. */
const FIELDS = [
  "memberId",
  "blockId",
  "unitNumber",
  "interestLevel",
] as const satisfies readonly NotSavedField[];

/*
 * An admin entering a record someone else made - phoned in from a corridor, or
 * written on paper because the phone was dead.
 *
 * The member is named explicitly rather than defaulting to the admin. A record
 * filed under the wrong person is worse than no record: it sends the next
 * visitor to ask the wrong colleague what happened at that door.
 */
export function RecordOnBehalfForm({
  members,
  blocks,
  onRecorded,
  onClose,
}: {
  members: User[];
  blocks: Block[];
  /* With the unit as sent: the answer names the household by id only. */
  onRecorded: (visit: RecordedVisit, unitNumber: string) => void;
  onClose: () => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [blockId, setBlockId] = useState(blocks[0]?.id ?? "");
  const [unitNumber, setUnitNumber] = useState("");
  const [interestLevel, setInterestLevel] = useState<InterestLevel | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState<NotSaved | null>(null);
  /* Where OK on the Not saved dialog sends focus. */
  const memberField = useRef<HTMLSelectElement>(null);
  const blockField = useRef<HTMLSelectElement>(null);
  const unitField = useRef<HTMLInputElement>(null);
  const firstInterest = useRef<HTMLButtonElement>(null);
  const fieldRefs: Partial<Record<NotSavedField, RefObject<HTMLElement | null>>> = {
    memberId: memberField,
    blockId: blockField,
    unitNumber: unitField,
    interestLevel: firstInterest,
  };

  /* Asked before a flick or a stray tap loses a record typed in from paper. */
  const discard =
    unitNumber.trim() === "" && description.trim() === ""
      ? undefined
      : { title: "Discard this visit?", detail: "What you typed has not been saved." };

  async function save(): Promise<void> {
    const unitFault = unitNumberFault(unitNumber);
    if (memberId === "" || blockId === "" || unitFault !== null || interestLevel === null) {
      const refused: Refusal[] = [];
      if (memberId === "") refused.push("memberId");
      if (blockId === "") refused.push("blockId");
      if (unitFault !== null) refused.push(UNIT_REFUSAL[unitFault]);
      if (interestLevel === null) refused.push("interestLevel");
      const found = notSavedByForm(refused, FIELDS);
      // A unit too long was given, so asking for one would not say why.
      setFailure(
        found === null || unitFault !== "too_long"
          ? "Choose a member, a block, a unit and an interest level."
          : notSavedLine(found),
      );
      setNotSaved(found);
      return;
    }

    setFailure(null);
    setSaving(true);
    const unit = normaliseUnitNumber(unitNumber);
    try {
      const visit = await apiFetch<RecordedVisit>("/visits", {
        method: "POST",
        body: JSON.stringify({
          id: uuidv7(),
          blockId,
          unitNumber: unit,
          interestLevel,
          description,
          memberId,
          clientCreatedAt: new Date().toISOString(),
        }),
      });
      onRecorded(visit, unit);
    } catch (error) {
      const refused = notSavedFromServer(error, FIELDS);
      setFailure(
        refused !== null
          ? notSavedLine(refused)
          : error instanceof Error
            ? error.message
            : "Could not record that visit.",
      );
      setNotSaved(refused);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Sheet
        label="Record on behalf of a member"
        title="Record for a member"
        onClose={onClose}
        discard={discard}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          noValidate
          className="space-y-4 pt-2"
        >
          {failure === null ? null : (
            <p role="alert" className="notice-danger">
              {failure}
            </p>
          )}

          <div>
            <label htmlFor="behalf-member" className="mb-1 block text-body font-medium">
              Recorded by
            </label>
            <select
              ref={memberField}
              id="behalf-member"
              value={memberId}
              onChange={(event) => {
                setMemberId(event.target.value);
              }}
              className="h-12 min-h-12 field"
            >
              <option value="">Choose a member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name ?? member.email}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="behalf-block" className="mb-1 block text-body font-medium">
              Block
            </label>
            <select
              ref={blockField}
              id="behalf-block"
              value={blockId}
              onChange={(event) => {
                setBlockId(event.target.value);
              }}
              className="h-12 min-h-12 field"
            >
              {blocks.map((block) => (
                <option key={block.id} value={block.id}>
                  Blk {block.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="behalf-unit" className="mb-1 block text-body font-medium">
              Unit number
            </label>
            <input
              ref={unitField}
              id="behalf-unit"
              value={unitNumber}
              onChange={(event) => {
                setUnitNumber(event.target.value);
              }}
              placeholder="#05-123"
              autoComplete="off"
              className="min-h-12 field"
            />
          </div>

          <div>
            <p className="mb-1 text-body font-medium">Interest level</p>
            <InterestPicker
              value={interestLevel}
              onChange={setInterestLevel}
              firstRef={firstInterest}
            />
          </div>

          <div>
            <label htmlFor="behalf-notes" className="mb-1 block text-body font-medium">
              Notes
            </label>
            <textarea
              id="behalf-notes"
              rows={3}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              className="field py-2"
            />
          </div>

          <SheetActions>
            <button
              type="submit"
              disabled={saving}
              className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
            >
              {saving ? "Saving…" : "Save the record"}
            </button>
          </SheetActions>
        </form>
      </Sheet>
      {/* Beside the sheet, not in it, as Sheet keeps its own confirmation. */}
      <SheetPresence>
        {notSaved === null ? null : (
          <NotSavedDialog
            lead={VISIT_NOT_SAVED}
            reasons={notSaved.reasons}
            returnFocus={notSaved.field === null ? undefined : fieldRefs[notSaved.field]}
            onDismiss={() => {
              setNotSaved(null);
            }}
          />
        )}
      </SheetPresence>
    </>
  );
}
