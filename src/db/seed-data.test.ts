import { describe, expect, it } from "vitest";
import {
  SEED_PASSWORD,
  seedAdmin,
  seedBlocks,
  seedFollowUps,
  seedHouseholds,
  seedSessions,
  seedUsers,
  seedVisits,
} from "@/db/seed-data";

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

describe("determinism", () => {
  it("gives every record a fixed id", () => {
    for (const rows of [seedUsers, seedBlocks, seedSessions, seedHouseholds, seedVisits]) {
      for (const id of ids(rows)) {
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
      }
    }
  });

  it("uses unique ids within every collection", () => {
    for (const rows of [seedUsers, seedBlocks, seedSessions, seedHouseholds, seedVisits]) {
      expect(new Set(ids(rows)).size).toBe(rows.length);
    }
  });

  it("shapes visit ids as UUIDv7, matching what the client generates", () => {
    // Version nibble is the first character of the third group.
    for (const visit of seedVisits) {
      expect(visit.id.split("-")[2]?.[0]).toBe("7");
    }
  });
});

describe("users", () => {
  it("has exactly one admin", () => {
    expect(seedUsers.filter((u) => u.role === "admin")).toHaveLength(1);
  });

  it("has several members to demonstrate multi-member sessions", () => {
    expect(seedUsers.filter((u) => u.role === "member").length).toBeGreaterThanOrEqual(3);
  });

  it("uses a password long enough for the credentials provider to accept", () => {
    expect(SEED_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });

  it("names the admin who owns the seeded sessions", () => {
    expect(seedAdmin.role).toBe("admin");
  });
});

describe("sessions", () => {
  it("has no active session, so an admin can start one on a fresh install", () => {
    // The partial unique index allows only one; leaving none avoids a clash.
    expect(seedSessions.filter((s) => s.status === "active")).toHaveLength(0);
  });

  it("leaves a draft ready to start", () => {
    expect(seedSessions.filter((s) => s.status === "draft").length).toBeGreaterThanOrEqual(1);
  });

  it("includes ended sessions so history is not empty", () => {
    expect(seedSessions.filter((s) => s.status === "ended").length).toBeGreaterThanOrEqual(2);
  });

  it("gives ended sessions both a start and an end time", () => {
    for (const session of seedSessions.filter((s) => s.status === "ended")) {
      expect(session.startedAt).toBeInstanceOf(Date);
      expect(session.endedAt).toBeInstanceOf(Date);
    }
  });

  it("leaves drafts without timestamps", () => {
    for (const session of seedSessions.filter((s) => s.status === "draft")) {
      expect(session.startedAt).toBeNull();
      expect(session.endedAt).toBeNull();
    }
  });

  it("attaches at least one block to every session", () => {
    for (const session of seedSessions) {
      expect(session.blockIds.length).toBeGreaterThan(0);
    }
  });
});

describe("households", () => {
  it("keeps block plus unit number unique", () => {
    const keys = seedHouseholds.map((h) => `${h.blockId}:${h.unitNumber}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes a household nobody ever answered, with nothing known", () => {
    // Proves the nullable identity fields are exercised, not just declared.
    const unknown = seedHouseholds.find(
      (h) => h.name === null && h.contact === null && h.religion === null,
    );
    expect(unknown).toBeDefined();
  });

  it("covers a spread of religions", () => {
    const religions = new Set(seedHouseholds.map((h) => h.religion).filter(Boolean));
    expect(religions.size).toBeGreaterThanOrEqual(4);
  });
});

describe("visits", () => {
  it("references only seeded households, sessions and members", () => {
    const householdIds = new Set(ids(seedHouseholds));
    const sessionIds = new Set(ids(seedSessions));
    const userIds = new Set(ids(seedUsers));
    for (const visit of seedVisits) {
      expect(householdIds.has(visit.householdId)).toBe(true);
      expect(sessionIds.has(visit.sessionId)).toBe(true);
      expect(userIds.has(visit.memberId)).toBe(true);
    }
  });

  it("only records visits against blocks attached to that session", () => {
    const blockOf = new Map(seedHouseholds.map((h) => [h.id, h.blockId]));
    const blocksOf = new Map(seedSessions.map((s) => [s.id, new Set(s.blockIds)]));
    for (const visit of seedVisits) {
      const blockId = blockOf.get(visit.householdId);
      expect(blocksOf.get(visit.sessionId)?.has(blockId ?? "")).toBe(true);
    }
  });

  it("uses every interest level, including no_response", () => {
    const levels = new Set(seedVisits.map((v) => v.interestLevel));
    expect(levels).toEqual(new Set(["low", "medium", "high", "no_response"]));
  });

  it("leaves no_response visits without a description", () => {
    // A silent door has nothing to say about it.
    const silent = seedVisits.filter((v) => v.interestLevel === "no_response");
    expect(silent.length).toBeGreaterThan(0);
  });

  it("has at least one household visited more than once", () => {
    const counts = new Map<string, number>();
    for (const visit of seedVisits) {
      counts.set(visit.householdId, (counts.get(visit.householdId) ?? 0) + 1);
    }
    expect([...counts.values()].filter((n) => n > 1).length).toBeGreaterThan(0);
  });

  it("shows a household whose interest level changed between visits", () => {
    /*
     * The acceptance criterion for the seed, and the point of the whole app:
     * a unit warms up over time and the history has to show it.
     */
    const byHousehold = new Map<string, string[]>();
    for (const visit of seedVisits) {
      byHousehold.set(visit.householdId, [
        ...(byHousehold.get(visit.householdId) ?? []),
        visit.interestLevel,
      ]);
    }
    const changed = [...byHousehold.values()].filter(
      (levels) => levels.length > 1 && new Set(levels).size > 1,
    );
    expect(changed.length).toBeGreaterThan(0);
  });

  it("spreads visits across more than one member", () => {
    expect(new Set(seedVisits.map((v) => v.memberId)).size).toBeGreaterThan(1);
  });
});

describe("follow ups", () => {
  it("leaves outstanding notes so the actionable list is not empty", () => {
    expect(seedFollowUps.filter((f) => f.doneAt === null).length).toBeGreaterThan(0);
  });

  it("includes a resolved note, attributed to whoever closed it", () => {
    const done = seedFollowUps.find((f) => f.doneAt !== null);
    expect(done?.doneBy).not.toBeNull();
  });

  it("includes a note that is already overdue", () => {
    /*
     * Compared against now rather than a fixed date: a past due date only
     * recedes further into the past, so this stays true as the app ages.
     */
    const now = new Date();
    const overdue = seedFollowUps.filter(
      (f) => f.doneAt === null && f.dueDate !== null && f.dueDate < now,
    );
    expect(overdue.length).toBeGreaterThan(0);
  });

  it("references only seeded households and visits", () => {
    const householdIds = new Set(ids(seedHouseholds));
    const visitIds = new Set(ids(seedVisits));
    for (const followUp of seedFollowUps) {
      expect(householdIds.has(followUp.householdId)).toBe(true);
      if (followUp.visitId !== null) {
        expect(visitIds.has(followUp.visitId)).toBe(true);
      }
    }
  });
});
