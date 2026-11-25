"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HouseholdHistory, RevisitEntry } from "@/generated/types.gen";
import { useRole } from "@/lib/hooks/use-role";
import {
  type LocalCopy,
  type LocalThread,
  copyTakesThreads,
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

const emptyFor = (outingId: string): Stored => ({ outingId, revisits: null, threads: [] });

/* What this page last held, for the member it was read for. A screen opened
   from another starts from it: reading the copy from IndexedDB lands a frame
   after the first paint, which on an iPhone is enough to push the form down
   under a thumb. In memory only, so a reload reads the copy as before. */
let remembered: { userId: string; stored: Stored } | null = null;

/* For tests: a fresh page. */
export function forgetThreads(): void {
  remembered = null;
}

/* What memory holds beside what the copy read: a thread not yet written stays,
   the newer of the two standing. Only for the same session. */
function merged(memory: Stored | null, disk: Stored): Stored {
  if (memory?.outingId !== disk.outingId) return disk;
  const byHousehold = new Map(disk.threads.map((thread) => [thread.history.household.id, thread]));
  for (const thread of memory.threads) {
    const other = byHousehold.get(thread.history.household.id);
    if (other === undefined || thread.savedAt > other.savedAt) {
      byHousehold.set(thread.history.household.id, thread);
    }
  }
  return {
    outingId: disk.outingId,
    revisits: memory.revisits ?? disk.revisits,
    threads: [...byHousehold.values()],
  };
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
  const outingRef = useRef(outingId);
  const storedRef = useRef<Stored>(stored ?? NONE);
  const alive = useRef(true);
  /* Units the copy took no thread of: kept in memory, and read again once.
     `retried` are those read again already; they wait for the copy to take
     threads (it gains a list for the session) rather than read at every poll. */
  const unwritten = useRef(new Set<string>());
  const retried = useRef(new Set<string>());
  /* Whose copy a thread may be written into. */
  const owner = userId ?? copy?.member.id;
  /* The session whose threads a read is going on for. */
  const running = useRef<string | null>(null);

  /* A session switch: what is held was another session's, and starts over
     for this one. Set while rendering, so no frame draws or hands on the
     old session's threads. */
  if (given !== null && stored !== null && stored.outingId !== given) {
    setStored(emptyFor(given));
  }

  useEffect(() => {
    storedRef.current = stored ?? NONE;
    if (stored === null || userId === undefined) return;
    /* The newest list read for the session this screen runs. With none (a
       read failed or is under way), the list last handed on for the same
       member and session stands, not the copy's older one. */
    const before =
      remembered !== null &&
      remembered.userId === userId &&
      remembered.stored.outingId === stored.outingId
        ? remembered.stored.revisits
        : null;
    const own = given !== null && Array.isArray(revisits) ? revisits : (before ?? stored.revisits);
    remembered = {
      userId,
      stored: own === stored.revisits ? stored : { ...stored, revisits: own },
    };
  }, [stored, userId, given, revisits]);
  useEffect(() => {
    revisitsRef.current = revisits;
    outingRef.current = outingId;
  }, [revisits, outingId]);
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
        setStored((current) =>
          loaded?.member.id === userId ? merged(current, fromCopy(loaded)) : NONE,
        );
      });
  }, [copy, userId]);

  const keep = useCallback(
    (histories: readonly HouseholdHistory[]) => {
      if (outingId === null) return;
      const now = Date.now();
      updateLocalCopy((current) => {
        /* A unit the copy does not take (not this member's, no list for this
           session, or off it) is not held there, though memory shows it. */
        const listed = copyTakesThreads(current, owner, outingId)
          ? new Set(current.revisits.map((entry) => entry.household.id))
          : new Set<string>();
        for (const history of histories) {
          const id = history.household.id;
          if (listed.has(id)) {
            unwritten.current.delete(id);
            retried.current.delete(id);
          } else {
            unwritten.current.add(id);
          }
        }
        return noteThreads(current, owner, outingId, histories, now);
      }).catch(() => undefined);
      if (!alive.current) return;
      /* Only a unit on the list, as the copy keeps them: one off it must not
         open as a thread before the list says so. */
      setStored((current) => {
        const listed = listedIn(revisitsRef.current, current);
        const fresh = listed === null ? [] : histories.filter((h) => listed.has(h.household.id));
        if (fresh.length === 0) return current;
        const same = current?.outingId === outingId;
        /* Callers hand over a list only for the session they tell, so it is
           this session's; with none read, the list held stays. */
        const own =
          given !== null && Array.isArray(revisitsRef.current) ? revisitsRef.current : null;
        return {
          outingId,
          revisits: own ?? (same ? current.revisits : null),
          threads: withThreads(same ? current.threads : [], fresh, now),
        };
      });
    },
    [outingId, given, owner],
  );

  const loaded = stored !== null;
  useEffect(() => {
    if (!preload || !loaded || outingId === null || revisits == null) return;
    if (running.current === outingId) return;
    const current = storedRef.current;
    const held =
      current.outingId === outingId
        ? current.threads.filter((thread) => !unwritten.current.has(thread.history.household.id))
        : [];
    const ids = staleThreads(revisits, held, Date.now());
    if (ids.length === 0) return;
    running.current = outingId;
    void (async () => {
      let todo = ids;
      const waiting = ids.filter((id) => retried.current.has(id));
      if (waiting.length > 0) {
        const onDisk = await loadLocalCopy().catch(() => null);
        if (copyTakesThreads(onDisk, owner, outingId)) {
          for (const id of waiting) retried.current.delete(id);
        } else {
          todo = ids.filter((id) => !retried.current.has(id));
        }
      }
      for (let at = 0; at < todo.length && alive.current; at += PRELOAD_AT_ONCE) {
        const batch = todo.slice(at, at + PRELOAD_AT_ONCE);
        for (const id of batch) if (unwritten.current.has(id)) retried.current.add(id);
        const read = await Promise.all(batch.map((id) => readThread(id)));
        /* Another session since: these are not its units. */
        if (outingRef.current !== outingId) break;
        const got = read.filter((history) => history !== null);
        if (got.length > 0) keep(got);
      }
      if (running.current === outingId) running.current = null;
    })();
  }, [preload, loaded, outingId, revisits, keep, owner]);

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
