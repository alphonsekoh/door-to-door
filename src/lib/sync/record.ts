import { z } from "zod";
import { zRecordedVisit, zVisit, zVisitSyncItem } from "@/generated/zod.gen";
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
  serverVisit: z.union([zRecordedVisit, zVisit]).nullable(),
  /* One without its outing is never sent: it could only be filed in the
     wrong one. */
  item: zVisitSyncItem.and(z.object({ sessionId: z.uuid() })),
});

/* Enough to send it as whoever saved it: the knock itself and its owner. */
const zSalvageable = zEnvelope.pick({ id: true, ownerId: true, item: true });

export const CORRUPT = "corrupt";

function field(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null ? Reflect.get(raw, key) : undefined;
}

/*
 * A record that fails the check is never thrown and never deleted (D-33-8):
 * one bad row must not take the whole list down, and deleting it would
 * silently drop what may be a real knock.
 *
 * When only the bookkeeping is damaged, and the item and its owner still
 * pass, it comes back as a fresh queued record and is sent; a replay of one
 * the server already holds is answered unchanged (D-21-1). Anything else
 * comes back stopped, with a placeholder item that is never sent, because a
 * corrupt record cannot be retried.
 *
 * Either way its id must be its item's: the engine files results by the
 * record's id and the server answers by the item's, so a mismatch would be
 * charged a missing result until quarantined for a visit the server holds.
 */
export function readRecord(raw: unknown): QueuedVisit {
  /* The checked value as stored, not zod's copy: zod's output types every
     optional field as possibly undefined, which the contract's types forbid. */
  const whole = zEnvelope.safeParse(raw);
  if (whole.success && whole.data.id === whole.data.item.id) return raw as QueuedVisit;

  const id = String(field(raw, "id"));
  const ownerId = field(raw, "ownerId");
  const stamp = field(raw, "enqueuedAt");
  const enqueuedAt = typeof stamp === "number" ? stamp : 0;

  const salvage = zSalvageable.safeParse(raw);
  if (salvage.success && salvage.data.id === salvage.data.item.id) {
    return {
      id: salvage.data.id,
      ownerId: salvage.data.ownerId,
      item: field(raw, "item") as QueuedVisit["item"],
      state: "queued",
      attempts: 0,
      skewCount: 0,
      nextAttemptAt: 0,
      lastError: null,
      enqueuedAt,
      syncedAt: null,
      serverVisit: null,
    };
  }

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
      sessionId: "",
    },
    state: "quarantined",
    attempts: 0,
    skewCount: 0,
    nextAttemptAt: null,
    lastError: { code: CORRUPT },
    enqueuedAt,
    syncedAt: null,
    serverVisit: null,
  };
}

export const HOUSEHOLD_ERASED = "household_erased";

/*
 * A record the server refused because its unit was erased after it was saved
 * (#279). It is settled, not unsent: it is kept as a stub with no data, in
 * state "synced", so that everything that treats a sent record as done (the
 * 24-hour expiry, sign-out, the update gate, the overlays) treats it so too.
 */
export function isErased(record: QueuedVisit): boolean {
  return record.state === "synced" && record.lastError?.code === HOUSEHOLD_ERASED;
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

/* Sent at any time, judged as above. */
export function isSent(record: QueuedVisit): boolean {
  return isExpired(record, Number.POSITIVE_INFINITY);
}

/* Not sent, whatever it is stuck on: enqueued at or before `before`. */
export function isUnsentBefore(record: QueuedVisit, before: number): boolean {
  return record.state !== "synced" && record.enqueuedAt <= before;
}
