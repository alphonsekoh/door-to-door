import type { HouseholdSummary, InterestLevel } from "@/generated/types.gen";
import type { QueuedVisit } from "@/lib/sync/types";
import type { UnitLike } from "@/lib/unit-list";
import { normaliseUnitNumber } from "@/lib/unit-number";

/*
 * The block's units as the server has them, with this phone's unsent records
 * laid over the top: a unit saved in a dead spot must show up in the list
 * straight away, and look different until it has been sent (#26).
 */

export type UnitRow = UnitLike & {
  key: string;
  /* The server's household, or null for a unit only this phone knows. */
  entry: HouseholdSummary | null;
  /* The newest record for this unit not yet on the server (or, on the
     offline shell, sent since its copy was taken). */
  pending: QueuedVisit | null;
  latestVisit: { interestLevel: InterestLevel } | null;
  /* Recorded during the running outing (D-26-2). */
  tonight: boolean;
};

export function overlayQueued(
  units: readonly HouseholdSummary[],
  records: readonly QueuedVisit[],
  blockId: string,
  sessionId: string | null,
  /* Which records to lay over. Online, only unsent ones: a sent record is
     in the server's rows once the screen re-reads them. */
  overlays: (record: QueuedVisit) => boolean = (record) => record.state !== "synced",
): UnitRow[] {
  /* Newest last, so the map keeps the latest record for each unit. */
  const pending = new Map<string, QueuedVisit>();
  for (const record of [...records].sort((a, b) => a.enqueuedAt - b.enqueuedAt)) {
    if (!overlays(record) || record.item.blockId !== blockId) continue;
    pending.set(normaliseUnitNumber(record.item.unitNumber), record);
  }

  const pendingTonight = (record: QueuedVisit | null) =>
    record !== null && record.item.sessionId === sessionId;

  const rows: UnitRow[] = units.map((entry) => {
    const unit = normaliseUnitNumber(entry.household.unitNumber);
    const record = pending.get(unit) ?? null;
    pending.delete(unit);
    return {
      key: entry.household.id,
      household: entry.household,
      entry,
      pending: record,
      latestVisit:
        record === null ? entry.latestVisit : { interestLevel: record.item.interestLevel },
      tonight:
        (sessionId !== null && entry.latestVisit?.sessionId === sessionId) ||
        pendingTonight(record),
    };
  });

  for (const [unitNumber, record] of pending) {
    rows.push({
      key: `queued:${record.id}`,
      household: {
        unitNumber,
        name: record.item.name ?? null,
        contact: record.item.contact ?? null,
      },
      entry: null,
      pending: record,
      latestVisit: { interestLevel: record.item.interestLevel },
      tonight: pendingTonight(record),
    });
  }
  return rows;
}
