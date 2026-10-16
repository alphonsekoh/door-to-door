import {
  type EngineState,
  applyBatchFailure,
  applyResult,
  failedTogether,
  isBlocked,
  isDue,
} from "@/lib/sync/classify";
import type { QueuedVisit, Send, SendOutcome, SyncQueue } from "@/lib/sync/types";

/* The contract's ceiling for one request. */
export const BATCH_SIZE = 100;

/* What an all-`internal_error` answer is treated as (see failedTogether). */
const SERVER_FAILED: Extract<SendOutcome, { kind: "http" }> = {
  kind: "http",
  status: 500,
  code: "internal_error",
};

export type FlushDeps = {
  send: Send;
  now: () => number;
  random: () => number;
};

export type FlushResult = { state: EngineState; synced: string[] };

/*
 * Oldest first, so a long offline stretch arrives in the order it was walked.
 * One at a time, the record that has waited longest goes first instead: one
 * that just failed alone is put back to its next attempt, so it lines up
 * behind the rest rather than in front of them every time.
 */
export function dueRecords(
  records: readonly QueuedVisit[],
  now: number,
  isolation = false,
): QueuedVisit[] {
  const waited = (record: { nextAttemptAt: number }) => (isolation ? record.nextAttemptAt : 0);
  return records
    .filter((record) => isDue(record, now))
    .sort(
      (a, b) => waited(a) - waited(b) || a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id),
    );
}

/*
 * Sends the owner's due records until none is left or the queue is told to
 * wait. Only `ownerId`'s records are ever read, so a phone shared between
 * members never sends one member's work as another's (D-33-1).
 *
 * A record goes out at most once per call; whatever it is due again for is
 * left to the next trigger, so a run always ends.
 */
export async function flushOnce(
  queue: SyncQueue,
  ownerId: string,
  initial: EngineState,
  deps: FlushDeps,
): Promise<FlushResult> {
  let state = initial;
  const sent = new Set<string>();
  const synced: string[] = [];

  for (;;) {
    if (isBlocked(state, deps.now())) break;
    const due = dueRecords(await queue.listByOwner(ownerId), deps.now(), state.isolation);
    if (due.length === 0) {
      state = { ...state, isolation: false };
      break;
    }
    const batch = due
      .filter((record) => !sent.has(record.id))
      .slice(0, state.isolation ? 1 : BATCH_SIZE);
    if (batch.length === 0) break;
    for (const record of batch) sent.add(record.id);

    const outcome = await deps.send(batch.map((record) => record.item));
    const now = deps.now();

    const byId =
      outcome.kind === "ok" ? new Map(outcome.results.map((result) => [result.id, result])) : null;
    if (byId !== null && !failedTogether(batch, byId)) {
      const updated = batch.map((record) =>
        applyResult(record, byId.get(record.id), now, deps.random),
      );
      await queue.putMany(updated);
      synced.push(...updated.filter((r) => r.state === "synced").map((r) => r.id));
      state = { ...state, block: null, streak: 0, serverStreak: 0 };
      continue;
    }

    const failed = applyBatchFailure(
      state,
      outcome.kind === "ok" ? SERVER_FAILED : outcome,
      batch,
      now,
      deps.random,
    );
    /* Just switched to one at a time: this batch goes again, item by item. */
    if (failed.state.isolation && !state.isolation && !isBlocked(failed.state, now)) {
      for (const record of batch) sent.delete(record.id);
    }
    state = failed.state;
    await queue.putMany(failed.records);
  }

  return { state, synced };
}
