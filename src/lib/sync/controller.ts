import {
  type Block,
  type EngineState,
  INITIAL_STATE,
  canRetry,
  clearForRetry,
  retryRecord,
} from "@/lib/sync/classify";
import { type VisitDraft, buildQueuedVisit } from "@/lib/sync/enqueue";
import { flushOnce } from "@/lib/sync/engine";
import type { QueuedVisit, Send, SyncQueue } from "@/lib/sync/types";

/*
 * When the queue sends, and who sends it. One controller per signed-in member
 * per page; everything it touches is injected so the timing can be tested
 * without a browser.
 */

export const SYNCED_KEPT_MS = 24 * 60 * 60 * 1000;

export type SyncSnapshot = {
  /* The owner's records, oldest first, sent ones included until purged. */
  records: readonly QueuedVisit[];
  /* Being sent by this page right now. */
  inFlight: ReadonlySet<string>;
  /* Saved on this page and not yet through a first send. */
  justSaved: ReadonlySet<string>;
  block: Block | null;
  /* Bumped whenever one of the owner's records reaches the server, so a
     screen knows to re-read what the server now holds. */
  syncedVersion: number;
};

export type ControllerDeps = {
  queue: SyncQueue;
  ownerId: string;
  send: Send;
  now: () => number;
  random: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /* Holds the origin-wide sending lock while `run` runs (D-33-7). */
  exclusive?: (run: () => Promise<void>) => Promise<void>;
  /* Tells other tabs the queue changed. */
  announce?: () => void;
  /* Asks the browser not to evict the queue; asked once, answer ignored. */
  persist?: () => Promise<unknown>;
  onChange: (snapshot: SyncSnapshot) => void;
};

export type SyncController = {
  start: () => Promise<void>;
  enqueue: (draft: VisitDraft) => Promise<QueuedVisit>;
  flush: () => Promise<void>;
  /* Signal is back or the app is in front again: lift any wait chosen for
     a lost connection, then send. */
  wake: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  retryAll: () => Promise<void>;
  /* Another tab changed the queue. */
  refresh: () => Promise<void>;
  dispose: () => void;
};

const inline = (run: () => Promise<void>) => run();

export function createSyncController(deps: ControllerDeps): SyncController {
  const { queue, ownerId } = deps;
  const exclusive = deps.exclusive ?? inline;
  const announce = deps.announce ?? (() => undefined);

  let state: EngineState = INITIAL_STATE;
  let records: readonly QueuedVisit[] = [];
  const inFlight = new Set<string>();
  const justSaved = new Set<string>();
  let syncedVersion = 0;
  let knownSynced: Set<string> | null = null;
  let running: Promise<void> | null = null;
  let dirty = false;
  let timer: unknown;
  let persisted = false;
  let disposed = false;

  function emit(): void {
    if (disposed) return;
    deps.onChange({
      records,
      inFlight: new Set(inFlight),
      justSaved: new Set(justSaved),
      block: state.block,
      syncedVersion,
    });
  }

  /* Never rejects: a failed read keeps what is already on screen. */
  async function refresh(): Promise<void> {
    let fresh: QueuedVisit[];
    try {
      fresh = await queue.listByOwner(ownerId);
    } catch {
      return;
    }
    const synced = new Set(fresh.filter((r) => r.state === "synced").map((r) => r.id));
    if (knownSynced !== null && [...synced].some((id) => !knownSynced?.has(id))) {
      syncedVersion += 1;
    }
    knownSynced = synced;
    records = fresh.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    emit();
  }

  /* The next moment anything could go out: the earliest record due, but not
     before a wait the queue is under. */
  function schedule(): void {
    deps.clearTimer(timer);
    timer = undefined;
    if (disposed) return;
    const times = records
      .filter((r) => r.state === "queued" || r.state === "failed" || r.state === "held")
      .flatMap((r) => (r.nextAttemptAt === null ? [] : [r.nextAttemptAt]));
    if (times.length === 0 || state.block?.until === null) return;
    const at = Math.max(Math.min(...times), state.block?.until ?? 0);
    timer = deps.setTimer(() => void flush(), Math.max(0, at - deps.now()));
  }

  /* Read through calls: TypeScript cannot see that a trigger or dispose()
     may land while a run is awaiting. */
  const alive = () => !disposed;
  const runAgain = () => dirty && !disposed;

  const tracked: Send = async (items) => {
    /* Disposed means another member may now hold the cookie: nothing of this
       owner's may go out under it (D-33-1). Reported as no signal, which
       changes no record. */
    if (!alive()) return { kind: "network" };
    for (const item of items) inFlight.add(item.id);
    emit();
    try {
      return await deps.send(items);
    } finally {
      for (const item of items) inFlight.delete(item.id);
    }
  };

  async function run(): Promise<void> {
    try {
      do {
        dirty = false;
        await exclusive(async () => {
          const result = await flushOnce(queue, ownerId, state, {
            send: tracked,
            now: deps.now,
            random: deps.random,
          });
          state = result.state;
        });
        await refresh();
        announce();
      } while (runAgain());
    } catch {
      /* Storage failed mid-run. Nothing was lost; the next trigger tries again. */
    } finally {
      inFlight.clear();
      justSaved.clear();
      running = null;
      emit();
      schedule();
    }
  }

  /* A trigger during a run is not dropped: the run goes round once more. */
  function flush(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running !== null) {
      dirty = true;
      return running;
    }
    running = run();
    return running;
  }

  function wake(): Promise<void> {
    if (state.block?.reason === "offline") state = { ...state, block: null };
    return flush();
  }

  async function enqueue(draft: VisitDraft): Promise<QueuedVisit> {
    const record = buildQueuedVisit(draft, ownerId, deps.now());
    await queue.put(record);
    if (!persisted) {
      persisted = true;
      void deps.persist?.().catch(() => undefined);
    }
    /* Shown as sending from the start, so an online save does not flash
       "waiting" in the moment before the request goes out. */
    inFlight.add(record.id);
    justSaved.add(record.id);
    await refresh();
    announce();
    void wake();
    return record;
  }

  async function retryMany(chosen: readonly QueuedVisit[]): Promise<void> {
    const now = deps.now();
    await queue.putMany(chosen.map((record) => retryRecord(record, now)));
    state = clearForRetry(state, now);
    await refresh();
    announce();
    return flush();
  }

  return {
    async start() {
      await queue.deleteSyncedBefore(deps.now() - SYNCED_KEPT_MS).catch(() => 0);
      await refresh();
      return flush();
    },
    enqueue,
    flush,
    wake,
    async retry(id) {
      const record = await queue.get(id);
      if (record?.ownerId !== ownerId || !canRetry(record)) return;
      return retryMany([record]);
    },
    async retryAll() {
      return retryMany((await queue.listByOwner(ownerId)).filter(canRetry));
    },
    refresh,
    dispose() {
      disposed = true;
      deps.clearTimer(timer);
    },
  };
}
