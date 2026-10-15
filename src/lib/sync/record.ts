import { z } from "zod";
import { zVisit, zVisitSyncItem } from "@/generated/zod.gen";
import type { QueuedVisit } from "@/lib/sync/types";

/*
 * Every record read back from storage is checked, because storage outlives
 * the code that wrote it: an older build, a browser bug or a hand edit in
 * devtools can all leave something that is not a QueuedVisit.
 */

const zEnvelope = z.object({
  id: z.string(),
  ownerId: z.string(),
  state: z.enum(["queued", "failed", "held", "quarantined", "synced"]),
  attempts: z.number().int().min(0),
  skewCount: z.number().int().min(0),
  nextAttemptAt: z.number().nullable(),
  lastError: z.object({ code: z.string() }).nullable(),
  enqueuedAt: z.number(),
  syncedAt: z.number().nullable(),
  serverVisit: zVisit.nullable(),
  item: zVisitSyncItem,
});

export const CORRUPT = "corrupt";

function field(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null ? Reflect.get(raw, key) : undefined;
}

/*
 * A record that fails the check comes back stopped, never thrown and never
 * deleted (D-33-8): one bad row must not take the whole list down, and
 * deleting it would silently drop what may be a real knock. Its item is a
 * placeholder that is never sent, because a corrupt record cannot be retried.
 */
export function readRecord(raw: unknown): QueuedVisit {
  /* The checked value as stored, not zod's copy: zod's output types every
     optional field as possibly undefined, which the contract's types forbid. */
  if (zEnvelope.safeParse(raw).success) return raw as QueuedVisit;

  const id = String(field(raw, "id"));
  const ownerId = field(raw, "ownerId");
  const enqueuedAt = field(raw, "enqueuedAt");
  return {
    id,
    ownerId: typeof ownerId === "string" ? ownerId : "",
    item: {
      id,
      blockId: "",
      unitNumber: "",
      interestLevel: "no_response",
      clientCreatedAt: "",
      updatedAt: "",
    },
    state: "quarantined",
    attempts: 0,
    skewCount: 0,
    nextAttemptAt: null,
    lastError: { code: CORRUPT },
    enqueuedAt: typeof enqueuedAt === "number" ? enqueuedAt : 0,
    syncedAt: null,
    serverVisit: null,
  };
}

export function isCorrupt(record: QueuedVisit): boolean {
  return record.lastError?.code === CORRUPT;
}

/* Kept a while after sending, so the unit list and Add follow-up can still
   find the server's row (D-33-9). Judged on the checked record, so a
   corrupt one is never expired away. */
export function isExpired(record: QueuedVisit, before: number): boolean {
  return record.state === "synced" && record.syncedAt !== null && record.syncedAt < before;
}
