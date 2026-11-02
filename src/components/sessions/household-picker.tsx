"use client";

import { UnitNumber } from "@/components/ui/unit-number";
import { type PickGroup, householdIdsOf, moreNotes, pickSummary } from "@/lib/follow-ups/pick";

/*
 * Households on the follow-up list as tickable rows, grouped by block as
 * members will meet them. Each says what the visit is for, so an admin picks
 * from the notes, not from unit numbers alone.
 */
export function HouseholdPicker({
  groups,
  ticked,
  onChange,
}: {
  groups: readonly PickGroup[];
  ticked: ReadonlySet<string>;
  onChange: (ticked: Set<string>) => void;
}) {
  const all = householdIdsOf(groups);
  const count = all.filter((id) => ticked.has(id)).length;
  const everything = count === all.length;

  return (
    <div className="space-y-3">
      {/* At large text the count drops under the toggle rather than squeeze it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p role="status" className="text-caption text-foreground-muted tabular-nums">
          {pickSummary(count, all.length)}
        </p>
        <button
          type="button"
          onClick={() => {
            onChange(new Set(everything ? [] : all));
          }}
          className="min-h-11 shrink-0 text-body font-medium btn-text"
        >
          {everything ? "Untick all" : "Tick all"}
        </button>
      </div>

      {groups.map((group) => (
        <div key={group.blockId}>
          <p className="mb-1 text-caption font-semibold whitespace-nowrap text-foreground-muted">
            Blk {group.blockName}
          </p>
          <ul className="overflow-hidden rounded-xl border border-border bg-surface">
            {group.households.map((household) => {
              const more = moreNotes(household);
              const noteId = `pick-note-${household.householdId}`;
              return (
                <li key={household.householdId} className="border-b border-border last:border-b-0">
                  <label className="flex min-h-14 cursor-pointer gap-3 press-row px-4 py-2">
                    <input
                      type="checkbox"
                      checked={ticked.has(household.householdId)}
                      onChange={(event) => {
                        const next = new Set(ticked);
                        if (event.target.checked) next.add(household.householdId);
                        else next.delete(household.householdId);
                        onChange(next);
                      }}
                      aria-label={`Blk ${group.blockName} · ${household.unitNumber}`}
                      aria-describedby={noteId}
                      className="mt-1 size-5 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold tabular-nums">
                        <UnitNumber value={household.unitNumber} />
                      </span>
                      <span
                        id={noteId}
                        className="line-clamp-2 text-caption break-words text-foreground-muted"
                      >
                        {household.first.note}
                      </span>
                      {more === null ? null : (
                        <span className="block text-caption text-foreground-muted">{more}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
