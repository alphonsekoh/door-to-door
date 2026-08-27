import type { OutingSession, SessionBlock } from "@/generated/types.gen";
import type { SessionBlockRow, SessionRow } from "@/server/sessions/service";

/*
 * Maps database rows to the contract's shapes. Kept apart from the service so
 * the query layer stays free of presentation concerns, and so withContract's
 * response validation has one obvious place to point at when it complains.
 */

export function toOutingSession(row: SessionRow): OutingSession {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdBy: { id: row.createdById, name: row.createdByName, image: row.createdByImage },
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSessionBlock(row: SessionBlockRow): SessionBlock {
  return {
    block: {
      id: row.blockId,
      name: row.blockName,
      street: row.blockStreet,
      postalCode: row.blockPostalCode,
      createdAt: row.blockCreatedAt.toISOString(),
    },
    visitCount: row.visitCount,
    householdCount: row.householdCount,
    activeMembers: row.activeMembers,
  };
}
