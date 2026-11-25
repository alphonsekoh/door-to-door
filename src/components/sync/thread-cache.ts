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

type Stored = {
  outingId: string | null;
  /* The copy's list: what is on the list while the screen's own is unread. */
  revisits: readonly RevisitEntry[] | null;
  threads: readonly LocalThread[];
};

const NONE: Stored = { outingId: null, revisits: null, threads: [] };

/* What this page last held, for the member it was read for. A screen opened
   from another starts from it: reading the copy from IndexedDB lands a frame
   after the first paint, which on an iPhone is enough to push the form down
   under a thumb. In memory only, so a reload reads the copy as before. */
let remembered: { userId: string; stored: Stored } | null = null;

/* For tests: a fresh page. */
export function forgetThreads(): void {
  remembered = null;
}

function fromCopy(copy: LocalCopy): Stored {
  return { outingId: copy.outing?.id ?? null, revisits: copy.revisits, threads: copy.threads };
}

/* The households on the newest list known: the screen's own once read, else
   the copy's. Null when neither is, and then nothing is kept or shown. */
function listedIn(
  revisits: readonly RevisitEntry[] | null | undefined,
  stored: Stored | null,
): ReadonlySet<string> | null {
  const list = revisits ?? stored?.revisits ?? null;
  return list === null ? null : new Set(list.map((entry) => entry.household.id));
}

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
  outingId: given,
  revisits,
  preload,
  copy,
  assumeCopyOuting = false,
}: {
  /* Null until the session is known. */
  outingId: string | null;
  /* Undefined or null while the list is unread or failed. */
  revisits: readonly RevisitEntry[] | null | undefined;
  preload: boolean;
  copy?: LocalCopy;
  /* Until the session answers, take the copy's outing as the one running, for
     a screen already told it is a follow-up session, so the threads are there
     on the first paint (#275). The answer replaces it. */
  assumeCopyOuting?: boolean;
}): ThreadCache {
  const { userId } = useRole();
  const [stored, setStored] = useState<Stored | null>(() => {
    if (copy !== undefined) return fromCopy(copy);
    return remembered !== null && remembered.userId === userId ? remembered.stored : null;
  });
  const outingId = given ?? (assumeCopyOuting ? (stored?.outingId ?? null) : null);
  const revisitsRef = useRef(revisits);
  const storedRef = useRef<Stored>(stored ?? NONE);
  const alive = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    storedRef.current = stored ?? NONE;
    if (stored !== null && userId !== undefined) remembered = { userId, stored };
  }, [stored, userId]);
  useEffect(() => {
    revisitsRef.current = revisits;
  }, [revisits]);
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
        setStored(loaded?.member.id === userId ? fromCopy(loaded) : NONE);
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
      /* Only a unit on the list, as the copy keeps them: one off it must not
         open as a thread before the list says so. */
      setStored((current) => {
        const listed = listedIn(revisitsRef.current, current);
        const fresh = listed === null ? [] : histories.filter((h) => listed.has(h.household.id));
        if (fresh.length === 0) return current;
        const same = current?.outingId === outingId;
        return {
          outingId,
          revisits: same ? current.revisits : null,
          threads: withThreads(same ? current.threads : [], fresh, now),
        };
      });
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
    const listed = listedIn(revisits, stored);
    if (listed === null) return [];
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
