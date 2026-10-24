"use client";

import { RevisitPill } from "@/components/follow-ups/revisit-pill";
import { InterestChip } from "@/components/ui/interest-chip";
import { UnitNumber } from "@/components/ui/unit-number";
import type { RevisitEntry } from "@/generated/types.gen";
import { type RevisitState, progress, stateOnPhone } from "@/lib/follow-ups/revisits";
import type { ShellBlock, ShellGroup } from "@/lib/offline/local-copy";
import type { QueuedVisit } from "@/lib/sync/types";

/*
 * A follow-up session's list on the offline shell, laid out as the session
 * screen lays it out: a member reached the shell by tapping a household, so
 * a household is what they tap here too. As last read with signal, with
 * this phone's own records counted in. No Mark done: every follow-up change
 * needs signal (D-35-9).
 */
export function ShellRevisits({
  groups,
  records,
  sessionId,
  onOpen,
}: {
  groups: readonly ShellGroup[];
  records: readonly QueuedVisit[];
  sessionId: string;
  onOpen: (block: ShellBlock, unit: string) => void;
}) {
  const stateOf = (entry: RevisitEntry) => stateOnPhone(entry, records, sessionId);
  const entries = groups.flatMap((group) => group.entries);

  return (
    <section aria-labelledby="shell-revisits-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="shell-revisits-heading" className="text-title font-semibold">
          Households to revisit
        </h2>
        {entries.length === 0 ? null : (
          <p className="text-caption text-foreground-muted tabular-nums">
            {progress(entries, stateOf)}
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-body text-foreground-muted">
          No households are on this session&apos;s list right now.
        </p>
      ) : (
        <>
          <p className="text-caption text-foreground-muted">
            As last read with signal. Tap a household to record your visit.
          </p>
          {groups.map(({ block, entries: here }) => (
            <div key={block.block.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <p className="min-w-0 flex-[1_1_12ch] text-body font-semibold">
                  <span className="whitespace-nowrap">Blk {block.block.name}</span>
                  <span className="font-normal text-foreground-muted"> · {block.block.street}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(block, "");
                  }}
                  className="inline-flex min-h-11 items-center text-body font-medium btn-text"
                >
                  Open block<span className="sr-only">, Blk {block.block.name}</span>
                </button>
              </div>
              <ul className="overflow-hidden rounded-xl border border-border bg-surface">
                {here.map((entry) => (
                  <Row
                    key={entry.household.id}
                    entry={entry}
                    state={stateOf(entry)}
                    onOpen={() => {
                      onOpen(block, entry.household.unitNumber);
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function Row({
  entry,
  state,
  onOpen,
}: {
  entry: RevisitEntry;
  state: RevisitState;
  onOpen: () => void;
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button type="button" onClick={onOpen} className="block w-full press-row px-4 py-3 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-[1_1_12ch] text-body font-semibold tabular-nums">
            <UnitNumber value={entry.household.unitNumber} />
          </span>
          {entry.latestVisit === null ? null : (
            <InterestChip level={entry.latestVisit.interestLevel} />
          )}
          <RevisitPill state={state} />
        </span>
        <span className="block text-caption text-foreground-muted">
          {entry.household.name ?? "Name not known"}
        </span>
        {/* The note that says what the visit is for: outstanding ones come first. */}
        {entry.notes.slice(0, 1).map((note) => (
          <span key={note.id} className="mt-1 line-clamp-2 block text-body break-words">
            {note.note}
          </span>
        ))}
      </button>
    </li>
  );
}
