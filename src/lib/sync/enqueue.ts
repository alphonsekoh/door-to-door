import type { InterestLevel, Religion, VisitSyncItem } from "@/generated/types.gen";
import type { QueuedVisit } from "@/lib/sync/types";
import { normaliseUnitNumber } from "@/lib/unit-number";
import { uuidv7 } from "@/lib/uuid";

/* What the recording form collects, as typed. */
export type VisitDraft = {
  blockId: string;
  unitNumber: string;
  interestLevel: InterestLevel;
  description: string;
  name: string;
  contact: string;
  religion: Religion | "";
  /* The outing it was recorded in, or null if this page never learnt it. */
  sessionId: string | null;
};

/* Blank means "not learnt", which the server must not store over a value an
   earlier visit recorded (D-25-6). */
function learnt(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/*
 * Both stamps are the moment of saving: this is a new visit, so it was
 * created and last changed at once, and the server judges each against its
 * clock and the outing.
 */
export function buildSyncItem(
  draft: VisitDraft,
  now: number,
  makeId: (now: number) => string = uuidv7,
): VisitSyncItem {
  const stamp = new Date(now).toISOString();
  return {
    id: makeId(now),
    blockId: draft.blockId,
    unitNumber: normaliseUnitNumber(draft.unitNumber),
    interestLevel: draft.interestLevel,
    description: draft.description,
    clientCreatedAt: stamp,
    updatedAt: stamp,
    name: learnt(draft.name),
    contact: learnt(draft.contact),
    religion: draft.religion === "" ? null : draft.religion,
    /* Omitted rather than null: a new item without one joins the running
       outing, the best guess for a page that never learnt which it was. */
    ...(draft.sessionId === null ? {} : { sessionId: draft.sessionId }),
  };
}

export function buildQueuedVisit(
  draft: VisitDraft,
  ownerId: string,
  now: number,
  makeId: (now: number) => string = uuidv7,
): QueuedVisit {
  const item = buildSyncItem(draft, now, makeId);
  return {
    id: item.id,
    ownerId,
    item,
    state: "queued",
    attempts: 0,
    skewCount: 0,
    nextAttemptAt: now,
    lastError: null,
    enqueuedAt: now,
    syncedAt: null,
    serverVisit: null,
  };
}
