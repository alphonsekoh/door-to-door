"use client";

import { useState } from "react";
import { InterestPicker } from "@/components/interest-picker";
import type { Block, InterestLevel, User } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { normaliseUnitNumber } from "@/lib/unit-number";
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
  onRecorded: () => void;
  onClose: () => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [blockId, setBlockId] = useState(blocks[0]?.id ?? "");
  const [unitNumber, setUnitNumber] = useState("");
  const [interestLevel, setInterestLevel] = useState<InterestLevel | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (memberId === "" || blockId === "" || unitNumber.trim() === "" || interestLevel === null) {
      setFailure("Choose a member, a block, a unit and an interest level.");
      return;
    }

    setFailure(null);
    setSaving(true);
    try {
      await apiFetch("/visits", {
        method: "POST",
        body: JSON.stringify({
          id: uuidv7(),
          blockId,
          unitNumber: normaliseUnitNumber(unitNumber),
          interestLevel,
          description,
          memberId,
          clientCreatedAt: new Date().toISOString(),
        }),
      });
      onRecorded();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not record that visit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1" />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
        aria-label="Record on behalf of a member"
        className="max-h-[85vh] space-y-4 overflow-y-auto rounded-t-2xl border-t border-border bg-background px-4 pt-4 inset-safe-bottom pb-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-title font-semibold">Record for a member</p>
          <button type="button" onClick={onClose} className="min-h-11 text-body text-primary">
            Cancel
          </button>
        </div>

        {failure === null ? null : (
          <p
            role="alert"
            className="rounded-lg border border-interest-low/40 bg-interest-low/10 px-3 py-2 text-body"
          >
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
            className="h-12 min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
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
            className="h-12 min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
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
            className="min-h-12 w-full rounded-lg border border-border bg-surface px-3 text-body"
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
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body"
          />
        </div>

        <div className="sticky bottom-0 -mx-4 bg-background/95 px-4 py-3 backdrop-blur">
          <button
            type="submit"
            disabled={saving}
            className="min-h-14 w-full rounded-xl bg-primary text-title font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save the record"}
          </button>
        </div>
      </form>
    </div>
  );
}
