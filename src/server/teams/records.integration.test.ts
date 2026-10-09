import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import type { Clock } from "@/lib/clock";
import { ApiError } from "@/server/http/errors";
import { listHistory, listOwnSessionHistory } from "@/server/history/service";
import { canAmend } from "@/server/teams/access";
import { createVisit, getVisit, updateVisit } from "@/server/visits/service";
import { syncVisits, type SyncItem } from "@/server/visits/sync";

/*
 * What a record carries about teams: stamped once at insert, read back with
 * current names, and amendable by whoever is on the team NOW.
 */

const pool = createTestPool();
let queryCount = 0;
const db = drizzle(pool, {
  schema,
  logger: { logQuery: () => void (queryCount += 1) },
}) as unknown as Database;

const ADMIN = "75757575-0000-4000-8000-000000000001";
const ALICE = "75757575-0000-4000-8000-000000000002";
const BEN = "75757575-0000-4000-8000-000000000003";
const CARA = "75757575-0000-4000-8000-000000000004";
const DAN = "75757575-0000-4000-8000-000000000005";
const BLOCK = "75757575-0000-4000-8001-000000000001";
const OTHER_BLOCK = "75757575-0000-4000-8001-000000000002";
const SESSION = "75757575-0000-4000-8002-000000000001";
const OLD_SESSION = "75757575-0000-4000-8002-000000000002";

const V1 = "01960000-0000-7000-8000-00000000bbb1";
const V2 = "01960000-0000-7000-8000-00000000bbb2";
const V3 = "01960000-0000-7000-8000-00000000bbb3";

const T1 = "2026-03-14T10:00:00.000Z";
const T2 = "2026-03-14T11:00:00.000Z";
const NOW = new Date("2026-03-14T12:00:00.000Z");
const TOLERANCE_MS = 300_000;
const clock: Clock = { now: NOW, toleranceMs: TOLERANCE_MS };

const member = (id: string) => ({ id, role: "member" as const });
const admin = { id: ADMIN, role: "admin" as const };

const item = (overrides: Partial<SyncItem> = {}): SyncItem => ({
  id: V1,
  blockId: BLOCK,
  unitNumber: "#05-123",
  interestLevel: "low",
  clientCreatedAt: T1,
  updatedAt: T1,
  ...overrides,
});

const flush = (items: SyncItem[], memberId: string, withClock: Clock = clock) =>
  syncVisits(db, items, memberId, withClock);

const record = (memberId: string, id = V1, unitNumber = "#05-123") =>
  createVisit(db, { id, blockId: BLOCK, unitNumber, interestLevel: "low", memberId }, clock);

async function makeTeam(name: string, userIds: string[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO session_teams (session_id, name, created_by) VALUES ($1,$2,$3) RETURNING id`,
    [SESSION, name, ADMIN],
  );
  const id = rows[0]?.id ?? "";
  for (const userId of userIds) await join(id, userId);
  return id;
}

const join = (teamId: string, userId: string) =>
  pool.query(`INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3)`, [
    teamId,
    SESSION,
    userId,
  ]);

const leave = (userId: string) =>
  pool.query(`DELETE FROM session_team_members WHERE user_id = $1`, [userId]);

const one = async <T extends object>(sql: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await pool.query<T>(sql, params);
  const [row] = rows;
  if (row === undefined) throw new Error(`No row for: ${sql}`);
  return row;
};

const teamOf = async (visitId: string): Promise<string> =>
  (await one<{ team_id: string }>(`SELECT team_id FROM visits WHERE id=$1`, [visitId])).team_id;

const stored = (id = V1) =>
  one<Record<string, unknown>>(
    `SELECT id, household_id, session_id, member_id, team_id, interest_level, description,
            client_created_at, updated_at FROM visits WHERE id = $1`,
    [id],
  );

const teammateIds = async (id = V1): Promise<string[]> =>
  (
    await pool.query<{ user_id: string }>(`SELECT user_id FROM visit_teammates WHERE visit_id=$1`, [
      id,
    ])
  ).rows
    .map((r) => r.user_id)
    .sort();

const count = async (table: string): Promise<number> =>
  Number((await one<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).n);

const code = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  return "no error";
};

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'),
      ($3,'ben@t.local','Ben','member'), ($4,'cara@t.local','Cara','member'),
      ($5,'dan@t.local','Dan','member')`,
    [ADMIN, ALICE, BEN, CARA, DAN],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave'), ($2,'999','Elsewhere')`,
    [BLOCK, OTHER_BLOCK],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at) VALUES
      ($1,'Outing','active',$2,$3), ($4,'Old','ended',$2,$5)`,
    [
      SESSION,
      ADMIN,
      new Date("2026-03-14T08:00:00.000Z"),
      OLD_SESSION,
      new Date("2026-02-01T08:00:00.000Z"),
    ],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  queryCount = 0;
});

afterAll(async () => {
  await pool.end();
});

describe("recording stamps the author's team", () => {
  it("stamps the team and freezes the teammates, author excluded", async () => {
    const team = await makeTeam("Trio", [ALICE, BEN, CARA]);
    const visit = await record(ALICE);

    expect(visit.teamId).toBe(team);
    expect(await teammateIds()).toEqual([BEN, CARA].sort());
    expect(visit.team?.name).toBe("Trio");
    expect(visit.team?.members.map((m) => m.name)).toEqual(["Ben", "Cara"]);
  });

  it("stamps null, and freezes no one, for a member on no team", async () => {
    const visit = await record(ALICE);
    expect(visit.teamId).toBeNull();
    expect(visit.team).toBeNull();
    expect(await count("visit_teammates")).toBe(0);
  });

  it("stamps a team of one with an empty snapshot", async () => {
    await makeTeam("Solo", [ALICE]);
    const visit = await record(ALICE);
    expect(visit.team).toMatchObject({ name: "Solo", members: [] });
  });

  it("stamps the NAMED author's team when an admin records on their behalf", async () => {
    const team = await makeTeam("Pair", [ALICE, BEN]);
    const visit = await createVisit(
      db,
      { id: V1, blockId: BLOCK, unitNumber: "#05-123", interestLevel: "low", memberId: ALICE },
      clock,
    );
    expect(visit.teamId).toBe(team);
    expect(visit.team?.members.map((m) => m.id)).toEqual([BEN]);
  });

  it("stamps the team of a record first stored by sync", async () => {
    const team = await makeTeam("Pair", [ALICE, BEN]);
    const [result] = await flush([item()], ALICE);
    expect(result?.status).toBe("applied");
    expect(result?.visit?.teamId).toBe(team);
    expect(await teammateIds()).toEqual([BEN]);
  });

  it("still names a since-deactivated teammate on an old record's snapshot", async () => {
    await makeTeam("Pair", [ALICE, BEN]);
    await record(ALICE);
    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [BEN]);
    expect((await getVisit(db, V1)).team?.members.map((m) => m.id)).toEqual([BEN]);
  });

  it("stamps null for a sync insert by someone on no team", async () => {
    const [result] = await flush([item()], ALICE);
    expect(result?.visit?.team).toBeNull();
    expect(await count("visit_teammates")).toBe(0);
  });

  it("keeps one visit and one snapshot when the same record is flushed twice at once, however they interleave", async () => {
    await makeTeam("Pair", [ALICE, BEN]);
    await Promise.all([flush([item()], ALICE), flush([item()], ALICE)]);
    expect(await count("visits")).toBe(1);
    expect(await teammateIds()).toEqual([BEN]);
  });

  it("writes nothing when the id is a duplicate", async () => {
    await makeTeam("Pair", [ALICE, BEN]);
    await record(ALICE);
    expect(await code(record(ALICE, V1, "#09-909"))).toBe("conflict");
    expect(await count("visits")).toBe(1);
    expect(await count("households")).toBe(1);
    expect(await teammateIds()).toEqual([BEN]);
  });
});

describe("the stamp never moves", () => {
  it("is unchanged by a leaver, a joiner, a rename and an amend; only names are current", async () => {
    const team = await makeTeam("Pair", [ALICE, BEN]);
    await record(ALICE);

    await leave(BEN);
    await join(team, CARA);
    await pool.query(`UPDATE session_teams SET name='Renamed' WHERE id=$1`, [team]);
    await pool.query(`UPDATE users SET name='Benjamin' WHERE id=$1`, [BEN]);
    await updateVisit(db, V1, { interestLevel: "high" }, member(ALICE));

    const visit = await getVisit(db, V1);
    expect(visit.teamId).toBe(team);
    expect(await teammateIds()).toEqual([BEN]);
    expect(visit.team).toMatchObject({
      name: "Renamed",
      members: [{ id: BEN, name: "Benjamin" }],
    });
  });

  it("is unchanged when the author moves to another team and amends", async () => {
    const first = await makeTeam("First", [ALICE, BEN]);
    await record(ALICE);
    await leave(ALICE);
    await makeTeam("Second", [ALICE, CARA]);

    await updateVisit(db, V1, { description: "Later" }, member(ALICE));
    await flush([item({ interestLevel: "high", updatedAt: T2 })], ALICE);

    expect(await teamOf(V1)).toBe(first);
    expect(await teammateIds()).toEqual([BEN]);
  });
});

describe("recording joins the outing", () => {
  const participants = async () =>
    (await pool.query<{ user_id: string }>(`SELECT user_id FROM session_participants`)).rows.map(
      (r) => r.user_id,
    );

  it("joins the author once, however many records follow", async () => {
    await record(ALICE);
    await record(ALICE, V2, "#06-201");
    expect(await participants()).toEqual([ALICE]);
  });

  it("joins the author of a synced record", async () => {
    await flush([item()], BEN);
    expect(await participants()).toEqual([BEN]);
  });

  it("does not join an admin who records", async () => {
    await createVisit(
      db,
      { id: V1, blockId: BLOCK, unitNumber: "#05-123", interestLevel: "low", memberId: ADMIN },
      clock,
    );
    expect(await participants()).toEqual([]);
  });

  it("joins the named author, not the admin, on a record made on their behalf", async () => {
    await createVisit(
      db,
      { id: V1, blockId: BLOCK, unitNumber: "#05-123", interestLevel: "low", memberId: BEN },
      clock,
    );
    expect(await participants()).toEqual([BEN]);
  });
});

describe("who may amend a visit", () => {
  beforeEach(async () => {
    await makeTeam("Pair", [ALICE, BEN]);
    await record(ALICE);
    // A record made on no team, for the "not on any team" case.
    await record(DAN, V2, "#06-201");
  });

  it("lets a current teammate amend, leaving authorship and stamp alone", async () => {
    const before = await stored();
    const amended = await updateVisit(db, V1, { interestLevel: "high" }, member(BEN));
    expect(amended.interestLevel).toBe("high");
    expect(amended.memberId).toBe(ALICE);
    const after = await stored();
    expect({
      ...after,
      interest_level: before["interest_level"],
      updated_at: before["updated_at"],
    }).toEqual(before);
  });

  it("refuses a stranger (403)", async () => {
    expect(await code(updateVisit(db, V1, { interestLevel: "high" }, member(CARA)))).toBe(
      "forbidden",
    );
    expect((await stored())["interest_level"]).toBe("low");
  });

  it("refuses a former teammate (403) but lets them keep editing their own", async () => {
    await leave(BEN);
    expect(await code(updateVisit(db, V1, { interestLevel: "high" }, member(BEN)))).toBe(
      "forbidden",
    );
    await record(BEN, V3, "#07-301");
    expect((await updateVisit(db, V3, { interestLevel: "high" }, member(BEN))).interestLevel).toBe(
      "high",
    );
  });

  it("lets a later joiner amend records made before they joined", async () => {
    await join(await teamOf(V1), CARA);
    expect((await updateVisit(db, V1, { interestLevel: "high" }, member(CARA))).memberId).toBe(
      ALICE,
    );
  });

  it("lets the team amend a leaver's record", async () => {
    await leave(ALICE);
    expect((await updateVisit(db, V1, { description: "Team edit" }, member(BEN))).description).toBe(
      "Team edit",
    );
  });

  it("does not let a teammate reach a record stamped with no team", async () => {
    expect(await code(updateVisit(db, V2, { interestLevel: "high" }, member(BEN)))).toBe(
      "forbidden",
    );
  });

  it("stops a member, teammate or not, once the outing has ended (409)", async () => {
    await pool.query(`UPDATE outing_sessions SET status='ended' WHERE id=$1`, [SESSION]);
    expect(await code(updateVisit(db, V1, { interestLevel: "high" }, member(BEN)))).toBe(
      "session_not_active",
    );
    expect(await code(updateVisit(db, V1, { interestLevel: "high" }, member(ALICE)))).toBe(
      "session_not_active",
    );
  });

  it("lets an admin amend anything, on an ended outing too", async () => {
    await pool.query(`UPDATE outing_sessions SET status='ended' WHERE id=$1`, [SESSION]);
    expect((await updateVisit(db, V1, { interestLevel: "high" }, admin)).interestLevel).toBe(
      "high",
    );
  });
});

describe("canAmend", () => {
  const visit = { memberId: ALICE, teamId: null as string | null };

  it("admits an admin and the author without looking at a team", async () => {
    expect(await canAmend(db, admin, visit)).toBe(true);
    expect(await canAmend(db, member(ALICE), visit)).toBe(true);
  });

  it("refuses everyone else when the visit has no team", async () => {
    expect(await canAmend(db, member(BEN), visit)).toBe(false);
  });

  it("admits a current member of the visit's team and no one else", async () => {
    const team = await makeTeam("Pair", [BEN]);
    expect(await canAmend(db, member(BEN), { ...visit, teamId: team })).toBe(true);
    expect(await canAmend(db, member(CARA), { ...visit, teamId: team })).toBe(false);
  });
});

describe("a teammate syncing an amend", () => {
  beforeEach(async () => {
    await makeTeam("Pair", [ALICE, BEN]);
    await flush([item({ name: "Mr Tan" })], ALICE);
  });

  it("applies interest, description and identity, and nothing else", async () => {
    const before = await stored();
    const [result] = await flush(
      [
        item({
          interestLevel: "high",
          description: "Ben's note",
          contact: "9123",
          updatedAt: T2,
          // A teammate's flush must not rewrite when the record was first made.
          clientCreatedAt: "2026-03-14T10:30:00.000Z",
        }),
      ],
      BEN,
    );

    expect(result?.status).toBe("applied");
    expect(result?.visit).toMatchObject({ interestLevel: "high", description: "Ben's note" });
    expect(result?.visit?.memberId).toBe(ALICE);
    const after = await stored();
    for (const key of [
      "id",
      "household_id",
      "session_id",
      "member_id",
      "team_id",
      "client_created_at",
    ]) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after["interest_level"]).toBe("high");
    expect(await teammateIds()).toEqual([BEN]);
    expect(await one(`SELECT name, contact FROM households`)).toEqual({
      name: "Mr Tan",
      contact: "9123",
    });
  });

  it("does not join the amending teammate to the outing", async () => {
    await flush([item({ interestLevel: "high", updatedAt: T2 })], BEN);
    expect(await count("session_participants")).toBe(1);
  });

  it("refuses a stranger as a conflict, changing nothing", async () => {
    const before = await stored();
    const [result] = await flush([item({ interestLevel: "high", updatedAt: T2 })], CARA);
    expect(result?.status).toBe("rejected");
    expect(result?.error?.code).toBe("conflict");
    expect(await stored()).toEqual(before);
  });

  it("refuses a teammate removed before the item arrived, changing nothing", async () => {
    await leave(BEN);
    const before = await stored();
    const [result] = await flush([item({ interestLevel: "high", updatedAt: T2 })], BEN);
    expect(result?.error?.code).toBe("conflict");
    expect(await stored()).toEqual(before);
  });

  it.each([
    ["block", { blockId: OTHER_BLOCK }],
    ["unit", { unitNumber: "#09-909" }],
    ["session", { sessionId: OLD_SESSION }],
  ])(
    "refuses an item naming a different %s, for a teammate and the author alike",
    async (_, change) => {
      for (const who of [BEN, ALICE]) {
        const before = await stored();
        const [result] = await flush(
          [item({ ...change, interestLevel: "high", updatedAt: T2 })],
          who,
        );
        expect(result?.status).toBe("rejected");
        expect(result?.error?.code).toBe("conflict");
        expect(await stored()).toEqual(before);
      }
      expect(await count("households")).toBe(1);
    },
  );

  it("accepts the same unit written with stray whitespace", async () => {
    const [result] = await flush([item({ unitNumber: " #05-123 ", updatedAt: T2 })], BEN);
    expect(result?.status).toBe("applied");
  });

  it("answers a replay unchanged even after the tolerance was lowered", async () => {
    const stamp = new Date(NOW.getTime() + 200_000).toISOString();
    await flush([item({ interestLevel: "high", updatedAt: stamp })], BEN);
    const [replayed] = await flush([item({ interestLevel: "high", updatedAt: stamp })], BEN, {
      now: NOW,
      toleranceMs: 60_000,
    });
    expect(replayed?.status).toBe("unchanged");
  });

  it("acknowledges an older teammate edit as stale", async () => {
    await flush([item({ interestLevel: "high", updatedAt: T2 })], ALICE);
    const [result] = await flush(
      [item({ interestLevel: "medium", updatedAt: "2026-03-14T10:30:00.000Z" })],
      BEN,
    );
    expect(result?.status).toBe("stale");
    expect((await stored())["interest_level"]).toBe("high");
  });

  it("applies the clock bounds to a teammate too", async () => {
    const ahead = new Date(NOW.getTime() + TOLERANCE_MS + 1).toISOString();
    const [future] = await flush([item({ updatedAt: ahead })], BEN);
    expect(future?.error?.code).toBe("clock_skew");

    await pool.query(`UPDATE outing_sessions SET started_at=$1 WHERE id=$2`, [
      new Date("2026-03-14T10:30:00.000Z"),
      SESSION,
    ]);
    const [early] = await flush(
      [item({ updatedAt: "2026-03-14T10:10:00.000Z", clientCreatedAt: T1 })],
      BEN,
    );
    expect(early?.error?.code).toBe("clock_skew");
  });

  it("holds a teammate's amend to an ended outing as session_not_active", async () => {
    await pool.query(`UPDATE outing_sessions SET status='ended' WHERE id=$1`, [SESSION]);
    const [result] = await flush([item({ interestLevel: "high", updatedAt: T2 })], BEN);
    expect(result?.error?.code).toBe("session_not_active");
  });

  it("keeps the record's own outing when the author's item names none", async () => {
    await pool.query(`UPDATE outing_sessions SET status='ended' WHERE id=$1`, [SESSION]);
    await pool.query(`UPDATE outing_sessions SET status='active' WHERE id=$1`, [OLD_SESSION]);
    const [result] = await flush([item({ interestLevel: "high", updatedAt: T2 })], ALICE);
    expect(result?.error?.code).toBe("session_not_active");
    expect((await stored())["session_id"]).toBe(SESSION);
  });
});

describe("history with a team", () => {
  const ids = (rows: { visit: { id: string } }[]) => rows.map((r) => r.visit.id).sort();

  beforeEach(async () => {
    await makeTeam("Pair", [ALICE, BEN]);
    await makeTeam("Other", [CARA, DAN]);
    await record(ALICE, V1, "#01-01");
    await record(BEN, V2, "#01-02");
    await record(CARA, V3, "#01-03");
    await record(DAN, "01960000-0000-7000-8000-00000000bbb4", "#01-04");
    await record(ADMIN, "01960000-0000-7000-8000-00000000bbb5", "#01-05");
  });

  const mine = (userId: string, includeTeam: boolean) =>
    listHistory(db, {
      memberId: userId,
      ...(includeTeam ? { includeTeamOf: userId } : {}),
      limit: 50,
      offset: 0,
    });

  it("is strictly the member's own unless they ask for their team", async () => {
    expect(ids((await mine(ALICE, false)).rows)).toEqual([V1]);
  });

  it("adds the records of the team they are on now", async () => {
    const result = await mine(ALICE, true);
    expect(ids(result.rows)).toEqual([V1, V2].sort());
    expect(result.total).toBe(2);
  });

  it("drops teammates' records when they leave, but keeps their own", async () => {
    await leave(ALICE);
    expect(ids((await mine(ALICE, true)).rows)).toEqual([V1]);
  });

  it("shows a joiner the records made before they joined", async () => {
    await leave(CARA);
    await join(await teamOf(V1), CARA);
    expect(ids((await mine(CARA, true)).rows)).toEqual([V1, V2, V3].sort());
  });

  it("filters by team for the admin view, and carries the team on each entry", async () => {
    const { rows } = await listHistory(db, { teamId: await teamOf(V1), limit: 50, offset: 0 });
    expect(ids(rows)).toEqual([V1, V2].sort());
    expect(rows.find((r) => r.visit.id === V1)?.visit.team?.members.map((m) => m.name)).toEqual([
      "Ben",
    ]);
  });

  it("keeps the per-outing summary strictly the member's own", async () => {
    const { rows } = await listOwnSessionHistory(db, { memberId: ALICE, limit: 50, offset: 0 });
    expect(rows.map((r) => r.visitCount)).toEqual([1]);
  });

  it("costs two extra queries however many visits are on the page", async () => {
    const countQueries = async (limit: number) => {
      queryCount = 0;
      await listHistory(db, { limit, offset: 0 });
      return queryCount;
    };
    const few = await countQueries(2);
    const many = await countQueries(50);
    expect(many).toBe(few);
    // page + count + team names + teammates
    expect(many).toBe(4);
  });

  it("costs no extra queries when nothing on the page is stamped", async () => {
    queryCount = 0;
    await listHistory(db, { memberId: ADMIN, limit: 50, offset: 0 });
    expect(queryCount).toBe(2);
  });
});
