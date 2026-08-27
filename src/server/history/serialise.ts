import type { HistoryEntry, SessionHistorySummary } from "@/generated/types.gen";
import { toBlock } from "@/server/blocks/serialise";
import { toOutingSession } from "@/server/sessions/serialise";
import type { HistoryEntryRow, SessionHistoryRow } from "@/server/history/service";
import { toHousehold, toVisit } from "@/server/visits/serialise";

export function toHistoryEntry(row: HistoryEntryRow): HistoryEntry {
  return {
    visit: toVisit(row.visit),
    household: toHousehold(row.household),
    block: toBlock(row.block),
    session: toOutingSession(row.session),
  };
}

export function toSessionHistorySummary(row: SessionHistoryRow): SessionHistorySummary {
  return {
    session: toOutingSession(row.session),
    blocks: row.blocks.map(toBlock),
    visitCount: row.visitCount,
    householdCount: row.householdCount,
    interest: row.interest,
    firstRecordedAt: row.firstRecordedAt.toISOString(),
    lastRecordedAt: row.lastRecordedAt.toISOString(),
  };
}
