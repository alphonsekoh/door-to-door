import { describe, expect, it } from "vitest";
import {
  countStageData,
  createRandom,
  generateStageData,
  STAGE_ADMIN_EMAIL,
  STAGE_MEMBER_EMAIL,
  STAGE_SCALE,
  type StageData,
  type StageScale,
} from "@/db/stage-seed-data";

/*
 * The stage seed (#244) must load into the real schema, so every rule the
 * database or the services hold is held here, at the size the stack loads.
 */

const NOW = new Date("2026-11-21T08:00:00Z");
const data = generateStageData({ now: NOW });

const SMALL: StageScale = {
  blocks: 3,
  unitsPerBlock: { min: 30, max: 30 },
  admins: 1,
  members: 4,
  deactivatedMembers: 0,
  endedSessions: 2,
  blocksPerSession: 2,
  followUpSessions: 1,
  coverage: 0.25,
};

const byId = <T extends { id: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]));
const users = byId(data.users);
const sessions = byId(data.sessions);
const households = byId(data.households);
const visits = byId(data.visits);
const teams = byId(data.sessionTeams);
const distinct = (values: readonly string[]) => new Set(values).size === values.length;

describe("generateStageData at the stack's scale", () => {
  it("is a year of a busy team's records", () => {
    const counts = countStageData(data);

    expect(counts.blocks).toBe(30);
    expect(counts.households).toBeGreaterThan(2800);
    expect(counts.households).toBeLessThanOrEqual(3600);
    expect(counts.visits).toBeGreaterThan(13_000);
    expect(counts.visits).toBeLessThan(17_000);
    expect(data.users.filter((user) => user.role === "member")).toHaveLength(40);
    expect(data.users.filter((user) => user.deactivatedAt !== null)).toHaveLength(2);
    expect(counts.followUps).toBeGreaterThan(800);
    expect(counts.sessionTeams).toBeGreaterThan(0);
    expect(counts.visitTeammates).toBeGreaterThan(0);
    const first = data.visits.reduce(
      (min, visit) => (visit.createdAt < min ? visit.createdAt : min),
      NOW,
    );
    expect(NOW.getTime() - first.getTime()).toBeGreaterThan(330 * 24 * 60 * 60 * 1000);
  });

  it("has past sessions of both kinds, exactly one active today and one waiting", () => {
    const tally = (kind: string, status: string) =>
      data.sessions.filter((session) => session.kind === kind && session.status === status).length;

    expect(tally("regular", "ended")).toBe(STAGE_SCALE.endedSessions);
    expect(tally("follow_up", "ended")).toBe(STAGE_SCALE.followUpSessions);
    expect(tally("regular", "active")).toBe(1);
    expect(tally("regular", "draft")).toBe(1);
    expect(data.sessions).toHaveLength(
      STAGE_SCALE.endedSessions + STAGE_SCALE.followUpSessions + 2,
    );
  });

  it("signs in the admin and member the stage check uses", () => {
    const find = (email: string) => data.users.find((user) => user.email === email);

    expect(find(STAGE_ADMIN_EMAIL)).toMatchObject({ role: "admin", deactivatedAt: null });
    expect(find(STAGE_MEMBER_EMAIL)).toMatchObject({ role: "member", deactivatedAt: null });
  });

  it("gives everything its own id and every person their own email", () => {
    const ids = [
      data.users,
      data.blocks,
      data.sessions,
      data.sessionTeams,
      data.households,
      data.visits,
      data.followUps,
    ].flatMap((rows: readonly { id: string }[]) => rows.map((row) => row.id));

    expect(distinct(ids)).toBe(true);
    expect(distinct(data.users.map((user) => user.email))).toBe(true);
    expect(data.visits.every((visit) => /^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(visit.id))).toBe(true);
  });

  it("holds the schema's unique keys", () => {
    expect(distinct(data.blocks.map((block) => `${block.name}|${block.street}`))).toBe(true);
    expect(distinct(data.households.map((row) => `${row.blockId}|${row.unitNumber}`))).toBe(true);
    expect(distinct(data.sessionBlocks.map((row) => `${row.sessionId}|${row.blockId}`))).toBe(true);
    expect(distinct(data.sessionParticipants.map((row) => `${row.sessionId}|${row.userId}`))).toBe(
      true,
    );
    expect(distinct(data.sessionTeamMembers.map((row) => `${row.sessionId}|${row.userId}`))).toBe(
      true,
    );
    expect(
      distinct(data.sessionHouseholds.map((row) => `${row.sessionId}|${row.householdId}`)),
    ).toBe(true);
    expect(distinct(data.visitTeammates.map((row) => `${row.visitId}|${row.userId}`))).toBe(true);
    const openSuggestions = data.followUps
      .filter((note) => note.status === "suggested" && note.deletedAt === null)
      .map((note) => note.householdId);
    expect(distinct(openSuggestions)).toBe(true);
  });

  it("records each visit by someone in its session, at a block of that session, while it ran", () => {
    const blocksOf = (sessionId: string) =>
      data.sessionBlocks.filter((row) => row.sessionId === sessionId).map((row) => row.blockId);
    const joined = new Set(data.sessionParticipants.map((row) => `${row.sessionId}|${row.userId}`));

    for (const visit of data.visits) {
      const session = sessions.get(visit.sessionId);
      const household = households.get(visit.householdId);
      expect(session?.startedAt?.getTime()).toBeLessThanOrEqual(visit.createdAt.getTime());
      expect(visit.createdAt.getTime()).toBeLessThanOrEqual((session?.endedAt ?? NOW).getTime());
      expect(blocksOf(visit.sessionId)).toContain(household?.blockId);
      expect(joined.has(`${visit.sessionId}|${visit.memberId}`)).toBe(true);
      expect(visit.clientCreatedAt).toEqual(visit.createdAt);
    }
  });

  it("stamps a visit with its author's team, and the team's other member as a teammate", () => {
    const membersOf = (teamId: string) =>
      data.sessionTeamMembers.filter((row) => row.teamId === teamId).map((row) => row.userId);
    const matesOf = (visitId: string) =>
      data.visitTeammates.filter((row) => row.visitId === visitId).map((row) => row.userId);

    for (const visit of data.visits.filter((row) => row.teamId !== null)) {
      const team = teams.get(visit.teamId ?? "");
      expect(team?.sessionId).toBe(visit.sessionId);
      expect(membersOf(visit.teamId ?? "")).toContain(visit.memberId);
      expect(matesOf(visit.id)).toEqual(
        membersOf(visit.teamId ?? "").filter((id) => id !== visit.memberId),
      );
    }
    for (const row of data.sessionTeamMembers) {
      expect(teams.get(row.teamId)?.sessionId).toBe(row.sessionId);
    }
  });

  it("never sends someone who has left", () => {
    for (const row of data.sessionParticipants) {
      const leftAt = users.get(row.userId)?.deactivatedAt;
      if (leftAt !== null && leftAt !== undefined)
        expect(row.joinedAt.getTime()).toBeLessThan(leftAt.getTime());
    }
  });

  it("gives each follow-up session its households, and their blocks as its blocks", () => {
    for (const session of data.sessions.filter((row) => row.kind === "follow_up")) {
      const picked = data.sessionHouseholds.filter((row) => row.sessionId === session.id);
      const blocks = data.sessionBlocks
        .filter((row) => row.sessionId === session.id)
        .map((row) => row.blockId);
      expect(picked.length).toBeGreaterThan(0);
      expect(new Set(blocks)).toEqual(
        new Set(picked.map((row) => households.get(row.householdId)?.blockId)),
      );
    }
  });

  it("writes follow-ups as the app does: listed by an admin, removed with a reason, done by a visit there", () => {
    const admins = new Set(
      data.users.filter((user) => user.role === "admin").map((user) => user.id),
    );
    const removed = data.followUps.filter((note) => note.deletedAt !== null);

    expect(removed.length).toBeGreaterThan(0);
    expect(
      data.followUps.some((note) => note.status === "suggested" && note.deletedAt === null),
    ).toBe(true);
    expect(data.followUps.some((note) => note.doneVisitId !== null)).toBe(true);
    expect(data.followUps.some((note) => note.doneAt !== null && note.doneVisitId === null)).toBe(
      true,
    );
    for (const note of data.followUps) {
      expect(visits.get(note.visitId)?.householdId).toBe(note.householdId);
      expect(note.listedAt === null).toBe(note.status === "suggested");
      expect(note.listedBy === null || admins.has(note.listedBy)).toBe(true);
      expect(note.deletedAt === null).toBe(note.deleteReason === null);
      expect(note.deletedBy === null || admins.has(note.deletedBy)).toBe(true);
      expect(note.createdAt.getTime()).toBeLessThan(NOW.getTime());
      expect(note.updatedAt.getTime()).toBeGreaterThanOrEqual(note.createdAt.getTime());
      if (note.doneVisitId !== null) {
        const done = visits.get(note.doneVisitId);
        expect(done?.householdId).toBe(note.householdId);
        expect(sessions.get(done?.sessionId ?? "")?.kind).toBe("follow_up");
        expect(note.doneAt).toEqual(done?.createdAt);
      }
      if (note.doneAt !== null) expect(note.doneAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("knows a household from its first knock, and its name only from an answer", () => {
    const answered = new Set(
      data.visits
        .filter((visit) => visit.interestLevel !== "no_response")
        .map((visit) => visit.householdId),
    );

    for (const household of data.households) {
      const knocks = data.visits
        .filter((visit) => visit.householdId === household.id)
        .map((visit) => visit.createdAt.getTime());
      expect(household.createdAt.getTime()).toBe(Math.min(...knocks));
      expect(household.updatedAt.getTime()).toBe(Math.max(...knocks));
      if (!answered.has(household.id)) {
        expect([household.name, household.contact, household.religion]).toEqual([null, null, null]);
      }
    }
    expect(data.households.some((household) => household.name !== null)).toBe(true);
  });

  it("dates nothing after now but due dates and next week's session", () => {
    const stamps = [
      ...data.visits.map((visit) => visit.createdAt),
      ...data.followUps.flatMap((note) => [
        note.createdAt,
        note.listedAt,
        note.deletedAt,
        note.doneAt,
      ]),
      ...data.sessions.flatMap((session) => [
        session.createdAt,
        session.startedAt,
        session.endedAt,
      ]),
    ];

    expect(stamps.filter((at) => at !== null && at > NOW)).toEqual([]);
  });
});

describe("generateStageData", () => {
  it("makes the same records every time for the same seed and day", () => {
    expect(generateStageData({ now: NOW, scale: SMALL })).toEqual(
      generateStageData({ now: NOW, scale: SMALL }),
    );
    expect(generateStageData({ now: NOW, scale: SMALL, seed: 1 })).not.toEqual(
      generateStageData({ now: NOW, scale: SMALL }),
    );
  });

  it("makes no household of a door nobody knocked on", () => {
    const small = generateStageData({ now: NOW, scale: SMALL });
    const knocked = new Set(small.visits.map((visit) => visit.householdId));

    expect(small.households.length).toBeLessThan(SMALL.blocks * 30);
    expect(small.households.every((household) => knocked.has(household.id))).toBe(true);
  });

  it("makes no follow-up session with nobody to go back to", () => {
    const quiet: StageData = generateStageData({ now: NOW, scale: { ...SMALL, endedSessions: 0 } });

    expect(quiet.sessions.map((session) => session.status)).toEqual(["active", "draft"]);
    expect(quiet.sessionHouseholds).toEqual([]);
  });
});

describe("createRandom", () => {
  it("draws the same sequence from the same seed, within bounds", () => {
    const a = createRandom(7);
    const b = createRandom(7);
    const draws = Array.from({ length: 200 }, () => a.int(3, 5));

    expect(Array.from({ length: 200 }, () => b.int(3, 5))).toEqual(draws);
    expect(new Set(draws)).toEqual(new Set([3, 4, 5]));
  });

  it("picks and shuffles only what it is given", () => {
    const random = createRandom(9);
    const items = ["a", "b", "c", "d"] as const;
    const picks = new Set(Array.from({ length: 100 }, () => random.pick(items)));

    expect(picks).toEqual(new Set(items));
    expect([...random.shuffle(items)].sort()).toEqual([...items]);
    expect(random.chance(1)).toBe(true);
    expect(random.chance(0)).toBe(false);
  });
});
