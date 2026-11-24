"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HouseholdHistory, RevisitEntry } from "@/generated/types.gen";
import { useRole } from "@/lib/hooks/use-role";
import {
  type LocalCopy,
  type LocalThread,
  noteThreads,
  withThreads,
} from "@/lib/offline/local-copy";
import { loadLocalCopy, updateLocalCopy } from "@/lib/offline/local-copy-store";
import { readThread } from "@/lib/offline/read-thread";
import { PRELOAD_AT_ONCE, staleThreads } from "@/lib/offline/threads";

type Stored = { outingId: string | null; threads: readonly LocalThread[] };

const NONE: Stored = { outingId: null, threads: [] };

export type ThreadCache = {
  /* The stored threads of the households on the session's list. */
  threads: readonly LocalThread[];
  /* A unit's history the form read itself, kept as one read for the thread. */
  noteRead: (history: HouseholdHistory) => void;
};

/*
 * A follow-up session's unit threads as the phone holds them (#275). Read
 * from the copy once, then kept in step: with `preload`, each list read
 * reads the threads that are missing or have moved, three at a time, and
 * keeps them in the copy. Failures are silent: a thread not read is one the
 * form reads itself when the unit is opened. `copy`, when the page already
 * loaded one (the offline shell), saves reading it again.
 */
export function useThreadCache({
  outingId,
  revisits,
  preload,
  copy,
}: {
  outingId: string | null;
  /* Undefined or null while the list is unread or failed. */
  revisits: readonly RevisitEntry[] | null | undefined;
  preload: boolean;
  copy?: LocalCopy;
}): ThreadCache {
  const { userId } = useRole();
  const [stored, setStored] = useState<Stored | null>(
    copy === undefined ? null : { outingId: copy.outing?.id ?? null, threads: copy.threads },
  );
  const storedRef = useRef<Stored>(stored ?? NONE);
  const alive = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    storedRef.current = stored ?? NONE;
  }, [stored]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* Another member's copy is never theirs to read from. */
  useEffect(() => {
    if (copy !== undefined || userId === undefined) return;
    void loadLocalCopy()
      .catch(() => null)
      .then((loaded) => {
        if (!alive.current) return;
        setStored(
          loaded?.member.id === userId
            ? { outingId: loaded.outing?.id ?? null, threads: loaded.threads }
            : NONE,
        );
      });
  }, [copy, userId]);

  const keep = useCallback(
    (histories: readonly HouseholdHistory[]) => {
      if (outingId === null) return;
      const now = Date.now();
      updateLocalCopy((current) => noteThreads(current, outingId, histories, now)).catch(
        () => undefined,
      );
      if (!alive.current) return;
      setStored((current) => ({
        outingId,
        threads: withThreads(current?.outingId === outingId ? current.threads : [], histories, now),
      }));
    },
    [outingId],
  );

  const loaded = stored !== null;
  useEffect(() => {
    if (!preload || !loaded || outingId === null || revisits == null || running.current) return;
    const current = storedRef.current;
    const held = current.outingId === outingId ? current.threads : [];
    const ids = staleThreads(revisits, held, Date.now());
    if (ids.length === 0) return;
    running.current = true;
    void (async () => {
      for (let at = 0; at < ids.length && alive.current; at += PRELOAD_AT_ONCE) {
        const read = await Promise.all(
          ids.slice(at, at + PRELOAD_AT_ONCE).map((id) => readThread(id)),
        );
        const got = read.filter((history) => history !== null);
        if (got.length > 0) keep(got);
      }
      running.current = false;
    })();
  }, [preload, loaded, outingId, revisits, keep]);

  const threads = useMemo(() => {
    if (stored === null || outingId === null || stored.outingId !== outingId) return [];
    if (revisits == null) return stored.threads;
    const listed = new Set(revisits.map((entry) => entry.household.id));
    return stored.threads.filter((thread) => listed.has(thread.history.household.id));
  }, [stored, outingId, revisits]);

  const noteRead = useCallback(
    (history: HouseholdHistory) => {
      keep([history]);
    },
    [keep],
  );

  return { threads, noteRead };
}
