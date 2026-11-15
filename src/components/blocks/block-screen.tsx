"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockViews } from "@/components/blocks/block-views";
import { DockHost } from "@/components/ui/docked-actions";
import { useLocalCopyWriter } from "@/components/sync/local-copy-writer";
import { PageHeader } from "@/components/ui/page-header";
import { SaveNotReady } from "@/components/visits/record-visit-form";
import { useSyncQueue } from "@/components/sync/sync-provider";
import type {
  ActiveSession,
  HouseholdSummary,
  RevisitEntry,
  RevisitList,
  SessionKind,
  TeamList,
} from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { heldOffListKey } from "@/lib/follow-ups/revisits";
import { keepEachOnce, loadAllHouseholds } from "@/lib/households/pages";
import type { OutingAnswer } from "@/lib/sync/outing";
import { overlayQueued } from "@/lib/sync/unit-overlay";
import { findMyTeam } from "@/lib/teams/team-ui";
import { useRole } from "@/lib/hooks/use-role";
import { knownSessionKind, useKnownSessionKind } from "@/lib/session/known-kind";

export function BlockScreen({
  blockId,
  initialUnit = "",
}: {
  blockId: string;
  initialUnit?: string;
}) {
  const { userId } = useRole();
  const { records, syncedVersion } = useSyncQueue();
  const { noteBlock, noteRevisits } = useLocalCopyWriter();
  /* A follow-up session's list: undefined until first read, null if that
     read failed. A later failed read keeps the list already shown. */
  const [revisits, setRevisits] = useState<RevisitEntry[] | null | undefined>(undefined);
  /* The last read that got every page; null until one has, so the copy is
     never written with a list that was merely not loaded yet, or only in part. */
  const [known, setKnown] = useState<HouseholdSummary[] | null>(null);
  /* The pages of the reads that failed since: shown over it, never saved. */
  const [arrived, setArrived] = useState<HouseholdSummary[]>([]);
  const [active, setActive] = useState<ActiveSession | null>(null);
  /* What this screen's own answer said of the session's kind: null when none
     is running, undefined until it has heard. */
  const [heardHere, setHeardHere] = useState<SessionKind | null | undefined>(undefined);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionId = active?.session.id ?? null;
  const units = useMemo(() => keepEachOnce([known ?? [], arrived]), [known, arrived]);

  /*
   * Every answer lands as a transition (#155). WebKit can run an answer's
   * code inside the event of text landing in the unit field: after the field
   * has changed, before React has read it. Set then, an answer is as urgent
   * as the event, so React drew the form again at once with the unit it
   * still held, writing it back over what was typed, which was then never
   * read. A transition is drawn after the event.
   */

  /*
   * The units already recorded on this block. Held here so the form can show a
   * unit's history the moment its number is typed, without a lookup per
   * keystroke, and so the list and the form never disagree about what exists.
   * Every page of them (#127). The offline copy is written only from a read
   * that got them all; a read that failed part way still shows the pages it
   * got, so a dropped page on first open does not hide the units, and their
   * history, that did arrive. Units shown never go until a whole read lands.
   *
   * A save or a sync starts a read while another may still be paging. Each
   * lands unless a newer one already has: on weak signal a whole read outlasts
   * the gap between saves, and letting only the newest land let none land until
   * the member stopped, leaving units just sent shown by nothing. A newer read
   * that failed does not stop an older whole one, still newer than the units it
   * replaces; the failed one's pages stay over it.
   */
  const loadGeneration = useRef(0);
  const landed = useRef({ any: 0, whole: 0 });
  const load = useCallback(async () => {
    const mine = ++loadGeneration.current;
    const read = await loadAllHouseholds(blockId);
    const newest = mine > landed.current.any;
    if (read.complete) {
      if (mine < landed.current.whole) return;
      landed.current.whole = mine;
      if (newest) landed.current.any = mine;
      startTransition(() => {
        setKnown(read.units);
        if (newest) {
          setArrived([]);
          setError(null);
        }
      });
      return;
    }
    if (!newest) return;
    landed.current.any = mine;
    startTransition(() => {
      setArrived((shown) => keepEachOnce([shown, read.units]));
      setError(read.failure instanceof Error ? read.failure.message : "Could not load this block.");
    });
  }, [blockId]);

  /* Separate from the units: the session marks tonight's rows and is what a
     save is queued under (D-33-25), but failing to learn it must not take the
     list down with it. A save asks again if it is still unknown. */
  const loadSession = useCallback(async (): Promise<OutingAnswer> => {
    try {
      const answer = await apiFetch<ActiveSession>("/sessions/active");
      startTransition(() => {
        setActive(answer);
        setHeardHere(answer.session.kind);
      });
      return { kind: "running", id: answer.session.id };
    } catch (caught) {
      // The contract's 404 is the one answer that means no session is running.
      const none = caught instanceof ApiRequestError && caught.status === 404;
      startTransition(() => {
        setActive(null);
        if (none) setHeardHere(null);
      });
      return none ? { kind: "none" } : { kind: "unknown" };
    }
  }, []);

  /* Told to the next screen once drawn here: a store's change is drawn at
     once, transition or not, so told as it lands it could put the unit back
     as an urgent answer did. */
  useEffect(() => {
    if (heardHere !== undefined) knownSessionKind.note(heardHere);
  }, [heardHere]);

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

  /*
   * In a follow-up session, which units may be recorded, kept in the offline
   * copy so the shell can tell a member the same thing in a dead spot. Only
   * the newest answer lands on screen; the answer itself goes back to a save
   * that asked, which judges the unit by it.
   */
  const followUpSession = active?.session.kind === "follow_up" ? active : null;
  const revisitsGeneration = useRef(0);
  const readRevisits = useCallback(async (): Promise<RevisitEntry[] | null> => {
    if (followUpSession === null) return null;
    const mine = ++revisitsGeneration.current;
    try {
      const list = await apiFetch<RevisitList>(`/sessions/${followUpSession.session.id}/revisits`);
      if (mine === revisitsGeneration.current) {
        startTransition(() => {
          setRevisits(list.data);
        });
        noteRevisits(followUpSession, list.data);
      }
      return list.data;
    } catch {
      if (mine === revisitsGeneration.current) {
        startTransition(() => {
          setRevisits((current) => current ?? null);
        });
      }
      return null;
    }
  }, [followUpSession, noteRevisits]);

  /*
   * Read with every answer about the session, and again whenever the list
   * may have moved under the screen: a record reached the server, the server
   * held one as off the list (so a unit an admin removed stops being offered),
   * or the member comes back to the app after an admin was asked to add one.
   */
  const heldOffList = heldOffListKey(records);
  useEffect(() => {
    const timer = setTimeout(() => void readRevisits(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [readRevisits, syncedVersion, heldOffList]);

  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void readRevisits();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [readRevisits]);

  /* Whichever of the units and the session arrives second writes the block
     into the offline copy, and every re-read of the units writes it again. */
  useEffect(() => {
    if (active !== null && known !== null) noteBlock(active, blockId, known);
  }, [active, known, blockId, noteBlock]);

  const rows = overlayQueued(units, records, blockId, sessionId);

  /*
   * Which team the viewer is on NOW decides whether a teammate's unit opens
   * for amending (D-74-17). Only an affordance: the server re-checks. Asked
   * once both the session and the viewer are known, and only the newest answer
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
        startTransition(() => {
          setTeamIds(team === undefined ? [] : [team.id]);
        });
      },
      () => {
        if (mine !== teamsGeneration.current) return;
        startTransition(() => {
          setTeamIds([]);
        });
      },
    );
    return () => {
      teamsGeneration.current += 1;
    };
  }, [sessionId, userId]);

  /* Named for the block, so a member moving between blocks can see where
     the next Save lands. Generic only until the session has answered, and
     until then on one line, so the form holds still as the name arrives. */
  const here = active?.blocks.find((entry) => entry.block.id === blockId)?.block;
  /* Opened from a bookmark or a stale tab, a block the running session does
     not cover: nothing could be saved here, so no form is offered. */
  const outside = active !== null && here === undefined ? active.session.kind : null;

  /*
   * Save promises a next unit only once the session is known to be
   * door-to-door: a follow-up session guesses none, and saying "and next"
   * until its answer came back told a member in weak signal the wrong thing.
   * The kind another screen learnt counts until this one's own answer.
   */
  const heard = useKnownSessionKind();
  const kind = active === null ? heard : active.session.kind;
  const guessNext = kind === "regular" || kind === null;

  /* The form's Save is docked at the end of the screen, so it is drawn
     there on the first paint too, before the form can move it, as not
     ready until this screen's script has run. */
  return (
    <DockHost className="space-y-5" standIn={<SaveNotReady />}>
      <PageHeader
        title={here === undefined ? "Record a visit" : `Blk ${here.name}`}
        subtitle={
          here !== undefined ? here.street : outside === null ? "One unit at a time." : undefined
        }
        back={{ href: "/", label: "Session" }}
        inline
        standIn={active === null}
      />

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body"
        >
          {error}
        </p>
      )}

      {outside === null ? (
        <BlockViews
          blockId={blockId}
          known={units}
          rows={rows}
          sessionId={sessionId}
          loadSession={loadSession}
          onRecorded={() => void load()}
          teamIds={teamIds}
          followUp={followUpSession === null ? null : { revisits, recheck: readRevisits }}
          active={active}
          initialUnit={initialUnit}
          guessNext={guessNext}
          unitsNote={
            known === null && error !== null
              ? "Not every unit of this block could be loaded, so one not listed here may still have been visited."
              : null
          }
        />
      ) : (
        <div role="status" className="rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-body font-medium">This block is not in the running session.</p>
          <p className="mt-1 text-body text-foreground-muted">
            {outside === "follow_up"
              ? "Visits can be recorded only at the households on the session's list. Pick one on the Session screen."
              : "Visits can be recorded only in the session's blocks. Pick one on the Session screen."}
          </p>
          <Link
            href="/"
            className="mt-3 inline-flex min-h-11 btn-primary items-center rounded-lg px-4 text-body font-medium"
          >
            Go to Session
          </Link>
        </div>
      )}
    </DockHost>
  );
}
