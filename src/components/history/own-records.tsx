"use client";

import Link from "next/link";
import { useState } from "react";
import { AmendVisitSheet } from "@/components/visits/amend-visit-sheet";
import { InterestChip } from "@/components/ui/interest-chip";
import { VisitByline } from "@/components/visits/visit-byline";
import type { HistoryEntry } from "@/generated/types.gen";
import { mayAmendVisit } from "@/lib/amend";
import { asHouseholdSummary } from "@/lib/history";
import { vouchedTeamIds } from "@/lib/team-view";
import { useRole } from "@/lib/use-role";
import { formatDay } from "@/lib/dates";
import { SheetPresence } from "@/components/ui/sheet";
import { UnitNumber } from "@/components/ui/unit-number";

/* What a team view adds, and its one limit (D-74-1). */
export const TEAM_VIEW_NOTE =
  "Includes records made by teams you are on now. A record still waiting on a teammate's phone appears once it syncs.";

/*
 * A member's records as rows: the row opens the unit's timeline, and Amend
 * opens the sheet where the server will allow it. Members can only amend on a
 * running session, so Amend is not offered on an ended one.
 */
export function OwnRecords({
  entries,
  showOuting = false,
  onAmended,
}: {
  entries: HistoryEntry[];
  showOuting?: boolean;
  onAmended: () => void;
}) {
  const { userId, isAdmin } = useRole();
  const [amending, setAmending] = useState<HistoryEntry | null>(null);
  const teamIds = vouchedTeamIds(entries, userId);

  return (
    <>
      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {entries.map((entry) => {
          const { visit, household, block, session } = entry;
          const own = visit.member.id === userId;
          const amendable =
            session.status === "active" && mayAmendVisit(visit, { userId, isAdmin, teamIds });
          return (
            <li
              key={visit.id}
              className="flex flex-wrap items-center gap-x-2 border-b border-border pr-3 last:border-b-0"
            >
              {/* At large text Amend drops under the record, and the chip
                  under the unit, rather than squeeze the record to a sliver
                  that Amend is drawn over. The record's 12ch is past its
                  own padding. */}
              <Link
                href={`/households/${household.id}`}
                className="flex min-h-14 min-w-0 flex-[1_1_calc(12ch+--spacing(4))] flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-4"
              >
                <span className="min-w-0 flex-[1_1_12ch]">
                  <span className="block text-body font-semibold tabular-nums">
                    <UnitNumber value={household.unitNumber} />
                  </span>
                  <span className="block truncate text-caption text-foreground-muted">
                    Blk {block.name}
                    {household.name === null ? "" : ` · ${household.name}`}
                  </span>
                  {showOuting ? (
                    <span className="block text-caption break-words text-foreground-muted">
                      {session.title} · {formatDay(visit.createdAt)}
                    </span>
                  ) : null}
                  {own && visit.team === null ? null : <VisitByline visit={visit} prefix="By " />}
                  {visit.description === "" ? null : (
                    <span className="mt-0.5 block truncate text-caption text-foreground-muted">
                      {visit.description}
                    </span>
                  )}
                </span>
                <InterestChip level={visit.interestLevel} />
              </Link>
              {amendable ? (
                <button
                  type="button"
                  aria-label={`Amend ${household.unitNumber}`}
                  onClick={() => {
                    setAmending(entry);
                  }}
                  className="my-1.5 ml-auto min-h-11 shrink-0 btn-secondary rounded-lg px-3 text-body font-medium"
                >
                  Amend
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <SheetPresence>
        {amending === null ? null : (
          <AmendVisitSheet
            entry={asHouseholdSummary(amending)}
            teamIds={teamIds}
            onClose={() => {
              setAmending(null);
            }}
            onSaved={() => {
              setAmending(null);
              onAmended();
            }}
          />
        )}
      </SheetPresence>
    </>
  );
}
