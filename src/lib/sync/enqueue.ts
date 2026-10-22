import type { CreateVisitRequest, InterestLevel, Religion } from "@/generated/types.gen";
import type { QueuedItem, QueuedVisit } from "@/lib/sync/types";
import { normaliseUnitNumber } from "@/lib/units/unit-number";
import { uuidv7 } from "@/lib/uuid";

/* What the recording form collects, as typed. */
export type VisitFields = {
  blockId: string;
  unitNumber: string;
  interestLevel: InterestLevel;
  description: string;
  name: string;
  contact: string;
  religion: Religion | "";
};

/* A queued visit always names its outing: sent without one, it would join
   whichever outing is running when it is finally sent, perhaps a later one,
   and be restamped into it (D-76). */
export type VisitDraft = VisitFields & { sessionId: string };

/* Blank means "not learnt", which the server must not store over a value an
   earlier visit recorded (D-25-6). */
function learnt(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/* What a direct POST /visits sends: the server stamps its own outing, at
   once, so none is named. */
export function buildVisitRequest(
  fields: VisitFields,
  now: number,
  makeId: (now: number) => string = uuidv7,
): CreateVisitRequest {
  return {
    id: makeId(now),
    blockId: fields.blockId,
    unitNumber: normaliseUnitNumber(fields.unitNumber),
    interestLevel: fields.interestLevel,
    description: fields.description,
    clientCreatedAt: new Date(now).toISOString(),
    name: learnt(fields.name),
    contact: learnt(fields.contact),
    religion: fields.religion === "" ? null : fields.religion,
  };
}

/* Both stamps are the moment of saving: this is a new visit, so it was
   created and last changed at once. */
function buildSyncItem(
  draft: VisitDraft,
  now: number,
  makeId: (now: number) => string,
): QueuedItem {
  return {
    ...buildVisitRequest(draft, now, makeId),
    clientCreatedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    sessionId: draft.sessionId,
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
