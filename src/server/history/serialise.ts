import type { HistoryEntry } from "@/generated/types.gen";
import { toBlock } from "@/server/blocks/serialise";
import { toOutingSession } from "@/server/sessions/serialise";
import type { HistoryEntryRow } from "@/server/history/service";
import { toHousehold, toVisit } from "@/server/visits/serialise";

export function toHistoryEntry(row: HistoryEntryRow): HistoryEntry {
  return {
    visit: toVisit(row.visit),
    household: toHousehold(row.household),
    block: toBlock(row.block),
    session: toOutingSession(row.session),
  };
}
