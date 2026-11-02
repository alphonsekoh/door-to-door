import type { RecordedVisit, Visit, VisitSyncItem, VisitSyncResult } from "@/generated/types.gen";

/*
 * The offline write queue (#33).
 *
 * A record is one visit saved on this phone, waiting for /visits/sync to
 * accept it. "Sending" is never stored: whether a request is in flight is a
 * fact about this page, not about the record, and a stored "sending" would
 * outlive the tab that wrote it.
 */

/* Always names its outing (see VisitDraft); the contract allows leaving it
   out, the queue does not. */
export type QueuedItem = VisitSyncItem & { sessionId: string };

export type RecordState = "queued" | "failed" | "held" | "quarantined" | "synced";

/* What a build from before RecordedVisit kept: the row alone. */
type EarlierVisit = Visit & { followUpsMarkedDone?: undefined };

export type QueuedVisit = {
  /* The visit id: a client UUIDv7, which is what makes a replay idempotent. */
  id: string;
  /* The member who saved it. Only they ever see or send it (D-33-1). */
  ownerId: string;
  item: QueuedItem;
  state: RecordState;
  /* Counts towards quarantine. Clock skew does not count. */
  attempts: number;
  skewCount: number;
  /* Null means it waits for a tap on Retry. */
  nextAttemptAt: number | null;
  lastError: { code: string } | null;
  enqueuedAt: number;
  syncedAt: number | null;
  /* The server's row once accepted, for anything that needs its household,
     with what storing it marked done. */
  serverVisit: RecordedVisit | EarlierVisit | null;
};

export type SyncQueue = {
  put: (record: QueuedVisit) => Promise<void>;
  putMany: (records: readonly QueuedVisit[]) => Promise<void>;
  get: (id: string) => Promise<QueuedVisit | undefined>;
  listByOwner: (ownerId: string) => Promise<QueuedVisit[]>;
  listAll: () => Promise<QueuedVisit[]>;
  /* The only delete there is: nothing unsent is ever removed (D-33-2). */
  deleteSyncedBefore: (before: number) => Promise<number>;
};

/* What one POST /visits/sync came to, before anything is decided about it. */
export type SendOutcome =
  | { kind: "ok"; results: VisitSyncResult[] }
  /* fetch itself threw: no signal, or the request was cut. */
  | { kind: "network" }
  | { kind: "http"; status: number; code: string }
  /* A 200 whose body was not JSON or did not match the contract. */
  | { kind: "invalid" };

export type Send = (items: VisitSyncItem[]) => Promise<SendOutcome>;
