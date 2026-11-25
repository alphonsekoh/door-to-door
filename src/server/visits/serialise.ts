import type {
  FollowUp,
  Household,
  HouseholdAttention,
  HouseholdHistory,
  HouseholdSummary,
  PaginationMeta,
  RecordedVisit,
  Visit,
} from "@/generated/types.gen";
import { toBlock } from "@/server/blocks/serialise";
import type {
  FollowUpRow,
  HouseholdAttentionRow,
  HouseholdHistoryRows,
  HouseholdSummaryRow,
} from "@/server/visits/queries";
import type { HouseholdRow, VisitRow } from "@/server/visits/service";

export function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    blockId: row.blockId,
    unitNumber: row.unitNumber,
    name: row.name,
    contact: row.contact,
    religion: row.religion,
    contactWithdrawnAt: row.contactWithdrawnAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    householdId: row.householdId,
    sessionId: row.sessionId,
    member: { id: row.memberId, name: row.memberName, image: row.memberImage },
    team: row.team,
    interestLevel: row.interestLevel,
    description: row.description,
    clientCreatedAt: row.clientCreatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/*
 * The answer to recording a visit, and only that: with the follow-ups
 * recording it marked done, so the client can offer to undo it. Every other
 * read of a visit leaves the field out.
 */
export function toRecordedVisit(row: VisitRow, markedDone: string[]): RecordedVisit {
  return { ...toVisit(row), followUpsMarkedDone: markedDone };
}

/* A left-joined user: all three columns are null together when nobody is named. */
function userOrNull(
  id: string | null,
  name: string | null,
  image: string | null,
): FollowUp["doneBy"] {
  return id === null ? null : { id, name, image };
}

export function toFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    householdId: row.householdId,
    blockId: row.blockId,
    blockName: row.blockName,
    unitNumber: row.unitNumber,
    visitId: row.visitId,
    status: row.status,
    author: { id: row.authorId, name: row.authorName, image: row.authorImage },
    note: row.note,
    dueDate: row.dueDate?.toISOString() ?? null,
    doneAt: row.doneAt?.toISOString() ?? null,
    doneBy: userOrNull(row.doneById, row.doneByName, row.doneByImage),
    listedAt: row.listedAt?.toISOString() ?? null,
    listedBy: userOrNull(row.listedById, row.listedByName, row.listedByImage),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deletedBy: userOrNull(row.deletedById, row.deletedByName, row.deletedByImage),
    deleteReason: row.deleteReason,
    waitingSuggestionBy: userOrNull(row.waitingById, row.waitingByName, row.waitingByImage),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toHouseholdSummary(row: HouseholdSummaryRow): HouseholdSummary {
  return {
    household: toHousehold(row.household),
    visitCount: row.visitCount,
    latestVisit: toVisit(row.latestVisit),
    outstandingFollowUps: row.outstandingFollowUps,
  };
}

export function toHouseholdHistory(
  rows: HouseholdHistoryRows,
  pagination: PaginationMeta,
): HouseholdHistory {
  return {
    household: toHousehold(rows.household),
    block: toBlock(rows.block),
    visits: rows.visits.map(toVisit),
    answered: rows.answered,
    pagination,
    followUps: rows.followUps.map(toFollowUp),
  };
}

export function toHouseholdAttention(row: HouseholdAttentionRow): HouseholdAttention {
  return {
    household: toHousehold(row.household),
    block: toBlock(row.block),
    latestVisit: toVisit(row.latestVisit),
    visitCount: row.visitCount,
    lastVisitedAt: row.lastVisitedAt.toISOString(),
  };
}
