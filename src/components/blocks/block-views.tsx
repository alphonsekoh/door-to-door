"use client";

import { useState } from "react";
import { type FollowUpRule, RecordVisitForm } from "@/components/visits/record-visit-form";
import { useSyncQueue } from "@/components/sync/sync-provider";
import { UnitList } from "@/components/ui/unit-list";
import type { ActiveSession, HouseholdSummary } from "@/generated/types.gen";
import type { OutingAnswer } from "@/lib/sync/outing";
import type { UnitRow } from "@/lib/sync/unit-overlay";
import { useRole } from "@/lib/hooks/use-role";

type Tab = "record" | "units";

type Props = {
  blockId: string;
  known: HouseholdSummary[];
  rows: UnitRow[];
  sessionId: string | null;
  loadSession: () => Promise<OutingAnswer>;
  /* After a save straight to the server, or an amend. */
  onRecorded: () => void;
  teamIds: readonly string[];
  /* The offline shell: nothing that needs the server's row is offered. */
  offline?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  /* A follow-up session's list rule; null for door-to-door. */
  followUp?: FollowUpRule | null;
  active?: ActiveSession | null;
  initialUnit?: string;
  guessNext?: boolean;
  /* Said above the units, where they are not all of the block's. */
  unitsNote?: string | null;
};

/* A block's two views, the form and its units, for the block screen and the
   offline shell alike. */
export function BlockViews({
  blockId,
  known,
  rows,
  sessionId,
  loadSession,
  onRecorded,
  teamIds,
  offline = false,
  onDirtyChange,
  followUp = null,
  active = null,
  initialUnit = "",
  guessNext = true,
  unitsNote = null,
}: Props) {
  const { inFlight } = useSyncQueue();
  const { isAdmin } = useRole();
  const [tab, setTab] = useState<Tab>("record");

  return (
    <>
      {/* Online and in the offline shell alike, so the chips below never
          turn up unexplained. */}
      {followUp === null ? null : (
        <p className="notice-info text-caption">
          <span className="font-semibold">Follow-up session</span> · Only units on the list can be
          recorded.{isAdmin ? " As an admin you can record any unit." : ""}
        </p>
      )}

      {/*
        Two views, one tap apart. The list must not push the recording form
        down the page: at a door the form is the whole job, and the list is
        what you check between floors. On a short screen they are compact,
        so the form's unit number is in view as the screen opens.
      */}
      <div role="tablist" aria-label="Block views" className="space-under-tabs flex gap-2">
        <button
          type="button"
          role="tab"
          id="tab-record"
          aria-selected={tab === "record"}
          aria-controls="panel-record"
          onClick={() => {
            setTab("record");
          }}
          className={`control-compact flex-1 press rounded-lg border font-medium ${
            tab === "record"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border-strong"
          }`}
        >
          Record
        </button>
        <button
          type="button"
          role="tab"
          id="tab-units"
          aria-selected={tab === "units"}
          aria-controls="panel-units"
          onClick={() => {
            setTab("units");
          }}
          className={`control-compact flex-1 press rounded-lg border font-medium ${
            tab === "units"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border-strong"
          }`}
        >
          All units ({rows.length})
        </button>
      </div>

      {tab === "record" ? (
        <div role="tabpanel" id="panel-record" aria-labelledby="tab-record">
          <RecordVisitForm
            blockId={blockId}
            known={known}
            followUp={followUp}
            active={active}
            initialUnit={initialUnit}
            guessNext={guessNext}
            sessionId={sessionId}
            loadSession={loadSession}
            onRecorded={onRecorded}
            {...(onDirtyChange === undefined ? {} : { onDirtyChange })}
          />
        </div>
      ) : (
        <div role="tabpanel" id="panel-units" aria-labelledby="tab-units">
          {unitsNote === null ? null : (
            <p className="mb-2 text-caption text-foreground-muted">{unitsNote}</p>
          )}
          <UnitList
            rows={rows}
            inFlight={inFlight}
            sessionId={sessionId}
            teamIds={teamIds}
            amendable={!offline}
            onAmended={onRecorded}
          />
        </div>
      )}
    </>
  );
}
