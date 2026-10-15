"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RecordVisitForm } from "@/components/record-visit-form";
import { useSyncQueue } from "@/components/sync-provider";
import { UnitList } from "@/components/unit-list";
import type {
  ActiveSession,
  HouseholdList,
  HouseholdSummary,
  TeamList,
} from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { overlayQueued } from "@/lib/sync/unit-overlay";
import { findMyTeam } from "@/lib/team-ui";
import { useRole } from "@/lib/use-role";

type Tab = "record" | "units";

export function BlockScreen({ blockId }: { blockId: string }) {
  const { userId } = useRole();
  const { records, inFlight, syncedVersion } = useSyncQueue();
  const [known, setKnown] = useState<HouseholdSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("record");

  /*
   * The units already recorded on this block. Held here so the form can show a
   * unit's history the moment its number is typed, without a lookup per
   * keystroke, and so the list and the form never disagree about what exists.
   */
  const load = useCallback(async () => {
    try {
      const households = await apiFetch<HouseholdList>(`/households?blockId=${blockId}&limit=100`);
      setKnown(households.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this block.");
    }
  }, [blockId]);

  /* Separate from the units, and deliberately forgiving: knowing which outing
     is running only marks tonight's rows, so failing to learn it must not
     take the list down with it. */
  const loadSession = useCallback(async () => {
    try {
      const active = await apiFetch<ActiveSession>("/sessions/active");
      setSessionId(active.session.id);
    } catch {
      setSessionId(null);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
      void loadSession();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [load, loadSession]);

  /*
   * Re-read once a queued record reaches the server, not after every save:
   * a save in a dead spot must not try the network and fail just to refresh
   * a list the queue already shows it in.
   */
  const seenSynced = useRef(syncedVersion);
  useEffect(() => {
    if (syncedVersion === seenSynced.current) return;
    seenSynced.current = syncedVersion;
    void load();
  }, [syncedVersion, load]);

  const rows = overlayQueued(known, records, blockId, sessionId);

  /*
   * Which team the viewer is on NOW decides whether a teammate's unit opens
   * for amending (D-74-17). Only an affordance: the server re-checks. Asked
   * once both the outing and the viewer are known, and only the newest answer
   * may land (D-74-45): a late empty reply must not take Amend away.
   */
  const teamsGeneration = useRef(0);
  useEffect(() => {
    if (sessionId === null || userId === undefined) return;
    const mine = ++teamsGeneration.current;
    apiFetch<TeamList>(`/sessions/${sessionId}/teams`).then(
      (teams) => {
        if (mine !== teamsGeneration.current) return;
        const team = findMyTeam(teams.data, userId);
        setTeamIds(team === undefined ? [] : [team.id]);
      },
      () => {
        if (mine === teamsGeneration.current) setTeamIds([]);
      },
    );
    return () => {
      teamsGeneration.current += 1;
    };
  }, [sessionId, userId]);

  return (
    <div className="space-y-5">
      {error === null ? null : (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body"
        >
          {error}
        </p>
      )}

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
            onRecorded={() => void load()}
          />
        </div>
      ) : (
        <div role="tabpanel" id="panel-units" aria-labelledby="tab-units">
          <UnitList
            rows={rows}
            inFlight={inFlight}
            sessionId={sessionId}
            teamIds={teamIds}
            onAmended={() => void load()}
          />
        </div>
      )}
    </div>
  );
}
