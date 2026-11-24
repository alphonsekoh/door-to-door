import type { HouseholdHistory, RevisitEntry, Visit, VisitSyncItem } from "@/generated/types.gen";
import type { LocalThread } from "@/lib/offline/local-copy";
import type { QueuedVisit } from "@/lib/sync/types";

/* Shared by the tests of a follow-up session's unit threads (#275). */

export const STAMP = "2026-10-15T09:00:00.000Z";
export const BLOCK_ID = "0190a000-0000-7000-8000-000000000123";
export const OUTING_ID = "0190a000-0000-7000-8000-0000000000cc";
export const BLOCK = {
  id: BLOCK_ID,
  name: "123",
  street: "Ang Mo Kio Ave 3",
  postalCode: null,
  createdAt: STAMP,
};

export function householdId(unit: string): string {
  return `0190a000-0000-7000-8000-${unit.padStart(12, "0")}`;
}

export function visit(id: string, overrides: Partial<Visit> = {}): Visit {
  return {
    id,
    householdId: householdId("1"),
    sessionId: "0190a000-0000-7000-8000-0000000000dd",
    member: { id: "0190a000-0000-7000-8000-00000000000b", name: "Ben Lim" },
    team: null,
    interestLevel: "medium",
    description: "Come back on Sunday",
    clientCreatedAt: STAMP,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

/* Unit `#05-0<n>`'s history, newest visit first. */
export function history(
  n: number,
  visits: Visit[] = [visit(`0190a000-0000-7000-8000-00000000009${String(n)}`)],
  religion: HouseholdHistory["household"]["religion"] = null,
): HouseholdHistory {
  return {
    household: {
      id: householdId(String(n)),
      blockId: BLOCK_ID,
      unitNumber: `#05-0${String(n)}`,
      name: "Mrs Tan",
      contact: null,
      religion,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    block: BLOCK,
    visits,
    answered: true,
    pagination: { total: visits.length, limit: 20, offset: 0, hasMore: false },
    followUps: [],
  };
}

export const thread = (n: number, savedAt: number, extra: Partial<HouseholdHistory> = {}) =>
  ({ history: { ...history(n), ...extra }, savedAt }) satisfies LocalThread;

/* The list's entry for a history, its latest visit the history's newest. */
export function entryFor(h: HouseholdHistory): RevisitEntry {
  return {
    household: h.household,
    block: h.block,
    notes: [],
    latestVisit: h.visits[0] ?? null,
    visitedInSession: false,
  };
}

export function queuedRecord(
  unit: string,
  overrides: Partial<QueuedVisit> = {},
  item: Partial<VisitSyncItem> = {},
): QueuedVisit {
  return {
    id: "0190a000-0000-7000-8000-0000000000a1",
    ownerId: "0190a000-0000-7000-8000-00000000000a",
    item: {
      id: "0190a000-0000-7000-8000-0000000000a1",
      blockId: BLOCK_ID,
      unitNumber: unit,
      sessionId: OUTING_ID,
      interestLevel: "high",
      description: "Asked us in",
      clientCreatedAt: STAMP,
      updatedAt: STAMP,
      ...item,
    },
    state: "queued",
    attempts: 0,
    skewCount: 0,
    nextAttemptAt: null,
    lastError: null,
    enqueuedAt: 1000,
    syncedAt: null,
    serverVisit: null,
    ...overrides,
  };
}
