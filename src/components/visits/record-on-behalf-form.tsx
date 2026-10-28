"use client";

import { useState } from "react";
import { InterestPicker } from "@/components/ui/interest-picker";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import type { Block, InterestLevel, RecordedVisit, User } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { normaliseUnitNumber } from "@/lib/units/unit-number";
import { uuidv7 } from "@/lib/uuid";

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

  /* Asked before a flick or a stray tap loses a record typed in from paper. */
  const discard =
    unitNumber.trim() === "" && description.trim() === ""
      ? undefined
      : { title: "Discard this visit?", detail: "What you typed has not been saved." };

  async function save(): Promise<void> {
    if (memberId === "" || blockId === "" || unitNumber.trim() === "" || interestLevel === null) {
      setFailure("Choose a member, a block, a unit and an interest level.");
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
      setFailure(error instanceof Error ? error.message : "Could not record that visit.");
    } finally {
      setSaving(false);
    }
  }

  return (
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
          <InterestPicker value={interestLevel} onChange={setInterestLevel} />
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
  );
}
