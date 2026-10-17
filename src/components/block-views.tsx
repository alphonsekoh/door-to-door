"use client";

import { useState } from "react";
import { RecordVisitForm } from "@/components/record-visit-form";
import { useSyncQueue } from "@/components/sync-provider";
import { UnitList } from "@/components/unit-list";
import type { HouseholdSummary } from "@/generated/types.gen";
import type { OutingAnswer } from "@/lib/sync/outing";
import type { UnitRow } from "@/lib/sync/unit-overlay";

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
}: Props) {
  const { inFlight } = useSyncQueue();
  const [tab, setTab] = useState<Tab>("record");

  return (
    <>
      {/*
        Two views, one tap apart. The list must not push the recording form
        down the page: at a door the form is the whole job, and the list is
        what you check between floors.
      */}
      <div role="tablist" aria-label="Block views" className="flex gap-2">
        <button
          type="button"
          role="tab"
          id="tab-record"
          aria-selected={tab === "record"}
          aria-controls="panel-record"
          onClick={() => {
            setTab("record");
          }}
          className={`min-h-11 flex-1 rounded-lg border text-body font-medium ${
            tab === "record" ? "border-primary bg-primary text-primary-foreground" : "border-border"
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
          className={`min-h-11 flex-1 rounded-lg border text-body font-medium ${
            tab === "units" ? "border-primary bg-primary text-primary-foreground" : "border-border"
          }`}
        >
          Units ({rows.length})
        </button>
      </div>

      {tab === "record" ? (
        <div role="tabpanel" id="panel-record" aria-labelledby="tab-record">
          <RecordVisitForm
            blockId={blockId}
            known={known}
            sessionId={sessionId}
            loadSession={loadSession}
            onRecorded={onRecorded}
            {...(onDirtyChange === undefined ? {} : { onDirtyChange })}
          />
        </div>
      ) : (
        <div role="tabpanel" id="panel-units" aria-labelledby="tab-units">
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
