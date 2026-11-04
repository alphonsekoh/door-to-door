import type { VisitSyncResult } from "@/generated/types.gen";
import { MAX_ATTEMPTS, PROBE_MS, RATE_LIMIT_MS, retryDelay } from "@/lib/sync/backoff";
import { isCorrupt } from "@/lib/sync/record";
import type { QueuedVisit, SendOutcome } from "@/lib/sync/types";

/*
 * What happens to a record, or to the whole queue, after the server answers.
 * Nothing here deletes a record that has not been sent (D-33-2): every path
 * ends in synced, in a retry, or in a state that waits for a tap.
 */

export type BlockReason =
  "offline" | "server" | "rate_limited" | "signed_out" | "deactivated" | "clock";

/* Null `until` lasts until the page is loaded again. */
export type Block = { reason: BlockReason; until: number | null };

export type EngineState = {
  block: Block | null;
  /* Whole-batch failures in a row, of any kind: sets the queue's backoff. */
  streak: number;
  /* Server failures in a row: three switches to one item per request. */
  serverStreak: number;
  /* One item per request, to find a record that breaks the whole batch
     without holding back the good ones (D-33-6). */
  isolation: boolean;
};

export const INITIAL_STATE: EngineState = {
  block: null,
  streak: 0,
  serverStreak: 0,
  isolation: false,
};

const ISOLATE_AFTER = 3;

export function isBlocked(state: EngineState, now: number): boolean {
  return state.block !== null && (state.block.until === null || state.block.until > now);
}

/* Queued, failed and held records each carry their own next attempt; held
   ones have none unless the refusal can lift without anyone tapping. */
export function isDue(
  record: QueuedVisit,
  now: number,
): record is QueuedVisit & { nextAttemptAt: number } {
  return (
    (record.state === "queued" || record.state === "failed" || record.state === "held") &&
    record.nextAttemptAt !== null &&
    record.nextAttemptAt <= now
  );
}

/* Counted towards quarantine: the server failed this record, so try again
   later, but not forever (D-74-30). */
export function failAttempt(
  record: QueuedVisit,
  code: string,
  now: number,
  random: () => number,
): QueuedVisit {
  const attempts = record.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return { ...record, state: "quarantined", attempts, nextAttemptAt: null, lastError: { code } };
  }
  return {
    ...record,
    state: "failed",
    attempts,
    nextAttemptAt: now + retryDelay(attempts, random),
    lastError: { code },
  };
}

function hold(record: QueuedVisit, code: string, nextAttemptAt: number | null): QueuedVisit {
  return { ...record, state: "held", nextAttemptAt, lastError: { code } };
}

/*
 * The original knock time is given up (D-33-3): the server refused it, and a
 * record that can never pass is worse than one stamped a little late. The
 * first restamp goes straight back; after that every five minutes, since the
 * limiter counts these refusals (D-76-7).
 */
function restamp(record: QueuedVisit, now: number): QueuedVisit {
  const stamp = new Date(now).toISOString();
  const skewCount = record.skewCount + 1;
  return {
    ...record,
    item: { ...record.item, clientCreatedAt: stamp, updatedAt: stamp },
    state: "queued",
    skewCount,
    nextAttemptAt: skewCount <= 1 ? now : now + PROBE_MS,
    lastError: { code: "clock_skew" },
  };
}

/* A sent record the response did not mention is treated as failed: the
   server may have stored it, and a replay is answered `unchanged`. */
export function applyResult(
  record: QueuedVisit,
  result: VisitSyncResult | undefined,
  now: number,
  random: () => number,
): QueuedVisit {
  if (result === undefined) return failAttempt(record, "missing_result", now, random);

  if (result.status !== "rejected") {
    return {
      ...record,
      state: "synced",
      nextAttemptAt: null,
      lastError: null,
      syncedAt: now,
      serverVisit: result.visit ?? null,
    };
  }

  const code = result.error?.error.code ?? "unknown";
  switch (code) {
    case "internal_error":
      return failAttempt(record, code, now, random);
    case "clock_skew":
      return restamp(record, now);
    /* An admin reopening the outing lets it through (D-21-4), as an admin
       adding the unit to the follow-up list lets the other through. */
    case "session_not_active":
    case "not_on_follow_up_list":
      return hold(record, code, now + PROBE_MS);
    /* Never retried by itself (D-74-23): nothing will change its answer. */
    default:
      return hold(record, code, null);
  }
}

/*
 * Every record in the batch refused with `internal_error`: that is the server
 * failing, not the records. A database outage answers each item this way
 * inside a 200 (D-87-2), and charging each record for it would park the whole
 * queue within minutes. The caller treats it as a whole-batch server failure,
 * which is never charged, so `internal_error` counts against a record only
 * when the server answered others in the same request.
 */
export function failedTogether(
  batch: readonly QueuedVisit[],
  results: ReadonlyMap<string, VisitSyncResult>,
): boolean {
  return batch.every((record) => {
    const result = results.get(record.id);
    return result?.status === "rejected" && result.error?.error.code === "internal_error";
  });
}

/*
 * The server answered for the batch as a whole, so nothing in it was
 * applied, and nothing is charged to a record: not for lost signal, and not
 * for a server failure even with one record sent alone, because a database
 * outage fails every record that way and must not park the good ones
 * (D-87-2). Only a 400 or 413 for a record sent alone is pinned on it.
 */
export function applyBatchFailure(
  state: EngineState,
  outcome: Exclude<SendOutcome, { kind: "ok" }>,
  batch: readonly QueuedVisit[],
  now: number,
  random: () => number,
): { state: EngineState; records: QueuedVisit[] } {
  const until = (ms: number) => now + ms;
  const blocked = (reason: BlockReason, at: number | null) => ({
    state: { ...state, block: { reason, until: at } },
    records: [],
  });

  if (outcome.kind === "network") {
    const streak = state.streak + 1;
    return {
      state: {
        ...state,
        streak,
        block: { reason: "offline", until: until(retryDelay(streak, random)) },
      },
      records: [],
    };
  }

  if (outcome.kind === "http") {
    if (outcome.status === 429) return blocked("rate_limited", until(RATE_LIMIT_MS));
    if (outcome.status === 401) return blocked("signed_out", null);
    if (outcome.status === 403 && outcome.code === "account_deactivated") {
      return blocked("deactivated", until(PROBE_MS));
    }
    if (outcome.status === 422 && outcome.code === "clock_skew") {
      return blocked("clock", until(PROBE_MS));
    }
    if (outcome.status === 400 || outcome.status === 413) {
      /* The contract refused the batch, for its content or its size (D-126-11).
         Alone, the record is the reason. */
      const records = batch.length === 1 ? batch.map((record) => stop(record, "invalid")) : [];
      return { state: { ...state, isolation: true }, records };
    }
  }

  const streak = state.streak + 1;
  const serverStreak = state.serverStreak + 1;
  const resume = until(retryDelay(streak, random));
  /* Sent alone, the record goes to the back of the line (see dueRecords),
     so one that breaks every request it is in cannot hold up the rest. */
  const records = state.isolation
    ? batch.map((record) => ({ ...record, nextAttemptAt: resume }))
    : [];
  return {
    state: {
      block: { reason: "server", until: resume },
      streak,
      serverStreak,
      isolation: state.isolation || serverStreak >= ISOLATE_AFTER,
    },
    records,
  };
}

function stop(record: QueuedVisit, code: string): QueuedVisit {
  return { ...record, state: "quarantined", nextAttemptAt: null, lastError: { code } };
}

/* Retry is the only thing a member can do to a record (D-33-2). A corrupt
   one cannot be sent at all, so it has no retry either. */
export function canRetry(record: QueuedVisit): boolean {
  return record.state !== "synced" && !isCorrupt(record);
}

export function retryRecord(record: QueuedVisit, now: number): QueuedVisit {
  return {
    ...record,
    state: "queued",
    attempts: 0,
    skewCount: 0,
    nextAttemptAt: now,
    lastError: null,
  };
}

/*
 * A tap means "try now": it ends isolation and the gaps the engine chose for
 * itself. Not the wait after a 429, which the server chose, and not a
 * sign-out, which only a new page load can undo.
 */
export function clearForRetry(state: EngineState, now: number): EngineState {
  const keep =
    state.block !== null &&
    (state.block.reason === "signed_out" ||
      (state.block.reason === "rate_limited" && isBlocked(state, now)));
  return { block: keep ? state.block : null, streak: 0, serverStreak: 0, isolation: false };
}
