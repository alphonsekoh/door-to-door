"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BlockViews } from "@/components/block-views";
import { DockHost } from "@/components/docked-actions";
import { useLocalCopyWriter } from "@/components/local-copy-writer";
import { PageHeader } from "@/components/page-header";
import { useSyncQueue } from "@/components/sync-provider";
import type {
  ActiveSession,
  HouseholdList,
  HouseholdSummary,
  TeamList,
} from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import type { OutingAnswer } from "@/lib/sync/outing";
import { overlayQueued } from "@/lib/sync/unit-overlay";
import { findMyTeam } from "@/lib/team-ui";
import { useRole } from "@/lib/use-role";

export function BlockScreen({ blockId }: { blockId: string }) {
  const { userId } = useRole();
  const { records, syncedVersion } = useSyncQueue();
  const { noteBlock } = useLocalCopyWriter();
  /* Null until the first answer, so the copy is never written with a list
     that was merely not loaded yet. */
  const [known, setKnown] = useState<HouseholdSummary[] | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionId = active?.session.id ?? null;
  const units = known ?? [];

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

  /* Separate from the units: the outing marks tonight's rows and is what a
     save is queued under (D-33-25), but failing to learn it must not take the
     list down with it. A save asks again if it is still unknown. */
  const loadSession = useCallback(async (): Promise<OutingAnswer> => {
    try {
      const answer = await apiFetch<ActiveSession>("/sessions/active");
      setActive(answer);
      return { kind: "running", id: answer.session.id };
    } catch (caught) {
      setActive(null);
      // The contract's 404 is the one answer that means no outing is running.
      return caught instanceof ApiRequestError && caught.status === 404
        ? { kind: "none" }
        : { kind: "unknown" };
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

  /* Whichever of the units and the outing arrives second writes the block
     into the offline copy, and every re-read of the units writes it again. */
  useEffect(() => {
    if (active !== null && known !== null) noteBlock(active, blockId, known);
  }, [active, known, blockId, noteBlock]);

  const rows = overlayQueued(units, records, blockId, sessionId);

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

  /* Named for the block, so a member moving between blocks can see where
     the next Save lands. Generic only until the outing has answered. */
  const here = active?.blocks.find((entry) => entry.block.id === blockId)?.block;

  return (
    <DockHost className="space-y-5">
      <PageHeader
        title={here === undefined ? "Record a visit" : `Blk ${here.name}`}
        subtitle={here === undefined ? "One unit at a time." : here.street}
        back={{ href: "/", label: "Session" }}
        inline
      />

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body"
        >
          {error}
        </p>
      )}

      <BlockViews
        blockId={blockId}
        known={units}
        rows={rows}
        sessionId={sessionId}
        loadSession={loadSession}
        onRecorded={() => void load()}
        teamIds={teamIds}
      />
    </DockHost>
  );
}
