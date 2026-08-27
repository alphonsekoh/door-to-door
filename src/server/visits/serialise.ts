import type {
  FollowUp,
  Household,
  HouseholdHistory,
  HouseholdSummary,
  Visit,
} from "@/generated/types.gen";
import { toBlock } from "@/server/blocks/serialise";
import type {
  FollowUpRow,
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
    interestLevel: row.interestLevel,
    description: row.description,
    clientCreatedAt: row.clientCreatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    householdId: row.householdId,
    visitId: row.visitId,
    author: { id: row.authorId, name: row.authorName, image: row.authorImage },
    note: row.note,
    dueDate: row.dueDate?.toISOString() ?? null,
    doneAt: row.doneAt?.toISOString() ?? null,
    doneBy:
      row.doneById === null
        ? null
        : { id: row.doneById, name: row.doneByName, image: row.doneByImage },
    createdAt: row.createdAt.toISOString(),
  };
}

export function toHouseholdSummary(row: HouseholdSummaryRow): HouseholdSummary {
  return {
    household: toHousehold(row.household),
    visitCount: row.visitCount,
    latestVisit: row.latestVisit === null ? null : toVisit(row.latestVisit),
    outstandingFollowUps: row.outstandingFollowUps,
  };
}

export function toHouseholdHistory(rows: HouseholdHistoryRows): HouseholdHistory {
  return {
    household: toHousehold(rows.household),
    block: toBlock(rows.block),
    visits: rows.visits.map(toVisit),
    followUps: rows.followUps.map(toFollowUp),
  };
}
