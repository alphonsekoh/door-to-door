import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool, resetDatabase, type Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";
import { zGetActiveSessionResponse } from "@/generated/zod.gen";
import { listHistory } from "@/server/history/service";
import { listSessionBlocks } from "@/server/sessions/service";
import { attachTeams } from "@/server/teams/access";
import {
  getHouseholdHistory,
  listHouseholds,
  listHouseholdsNeedingAttention,
} from "@/server/visits/queries";
import { trackRoundTrips } from "../../test/round-trips";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET: activeSession } = await import("@/app/api/sessions/active/route");

/*
 * Reads that need nothing from one another are sent together (#252), so a
 * screen waits on as few round trips one after another as its reads allow.
 * Every case here has a visit stamped with a team, the longest path each
 * read can take. The queries themselves, and so their count, are unchanged.
 */

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;
const trips = trackRoundTrips(pool);

const ADMIN = "25225225-0000-4000-8000-000000000001";
const ALICE = "25225225-0000-4000-8000-000000000002";
const BEN = "25225225-0000-4000-8000-000000000003";
const BLOCK = "25225225-0000-4000-8001-000000000001";
const SESSION = "25225225-0000-4000-8002-000000000001";
const TEAM = "25225225-0000-4000-8003-000000000001";
const HOUSEHOLD = "25225225-0000-4000-8004-000000000001";
const VISIT = "01960000-0000-7000-8252-000000000001";

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'),
      ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'252','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at)
     VALUES ($1,'Tonight','active',$2, now())`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO session_teams (id, session_id, name, created_by) VALUES ($1,$2,'Ann & Ben',$3)`,
    [TEAM, SESSION, ADMIN],
  );
  await pool.query(
    `INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3), ($1,$2,$4)`,
    [TEAM, SESSION, ALICE, BEN],
  );
  await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#05-252')`, [
    HOUSEHOLD,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, team_id, interest_level)
     VALUES ($1,$2,$3,$4,$5,'high')`,
    [VISIT, HOUSEHOLD, SESSION, ALICE, TEAM],
  );
  await pool.query(`INSERT INTO visit_teammates (visit_id, user_id) VALUES ($1,$2)`, [VISIT, BEN]);
  trips.reset();
});

afterAll(async () => {
  trips.restore();
  await pool.end();
  await resetDatabase();
});

describe("a block's unit list", () => {
  it("waits on four round trips for its eight queries", async () => {
    const { rows } = await listHouseholds(db, { blockId: BLOCK, limit: 100, offset: 0 });
    expect(rows[0]?.latestVisit?.team?.members).toEqual([{ id: BEN, name: "Ben", image: null }]);
    // The block, the page and the total; the summaries and what is owed;
    // the latest visits; their teams.
    expect(trips.sent).toBe(8);
    expect(trips.depth).toBe(4);
  });

  it("still refuses a block that is not there", async () => {
    await expect(
      listHouseholds(db, {
        blockId: "25225225-0000-4000-8001-000000000009",
        limit: 100,
        offset: 0,
      }),
    ).rejects.toThrow("No such block.");
  });
});

describe("a unit's history", () => {
  it("waits on two round trips for its six queries", async () => {
    const history = await getHouseholdHistory(db, HOUSEHOLD, { limit: 20, offset: 0 });
    expect(history.visits[0]?.team?.name).toBe("Ann & Ben");
    expect(history.total).toBe(1);
    // The household, the page, the tally and the notes; the page's teams.
    expect(trips.sent).toBe(6);
    expect(trips.depth).toBe(2);
  });
});

describe("All records", () => {
  it("reads its page and its total together", async () => {
    const { rows, total } = await listHistory(db, { limit: 100, offset: 0 });
    expect(rows[0]?.visit.team?.name).toBe("Ann & Ben");
    expect(total).toBe(1);
    expect(trips.sent).toBe(4);
    expect(trips.depth).toBe(2);
  });
});

describe("Needs a return visit", () => {
  it("reads its page and its total together", async () => {
    const { rows, total } = await listHouseholdsNeedingAttention(db, {
      minimumInterest: "high",
      limit: 50,
      offset: 0,
    });
    expect(rows[0]?.latestVisit.team?.name).toBe("Ann & Ben");
    expect(total).toBe(1);
    expect(trips.sent).toBe(4);
    expect(trips.depth).toBe(2);
  });
});

describe("attaching teams", () => {
  it("reads the team names and the teammates together", async () => {
    const [visit] = await attachTeams(db, [{ id: VISIT, teamId: TEAM }]);
    expect(visit?.team).toEqual({
      id: TEAM,
      name: "Ann & Ben",
      members: [{ id: BEN, name: "Ben", image: null }],
    });
    expect(trips.sent).toBe(2);
    expect(trips.depth).toBe(1);
  });
});

describe("a session's blocks", () => {
  it("reads the counts and who recorded where together", async () => {
    const [block] = await listSessionBlocks(db, SESSION);
    expect(block).toMatchObject({ blockId: BLOCK, visitCount: 1 });
    expect(block?.activeMembers.map((member) => member.id)).toEqual([ALICE]);
    expect(trips.sent).toBe(2);
    expect(trips.depth).toBe(1);
  });
});

describe("the active session", () => {
  const app = () => trackRoundTrips(getPool());
  let tracked: ReturnType<typeof app> | undefined;

  afterEach(() => {
    tracked?.restore();
    tracked = undefined;
  });

  it("checks the sign-in first, then finds the session, then reads the rest together", async () => {
    auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));
    tracked = app();
    const response = await activeSession(new Request("https://test.local/api/sessions/active"));
    expect(response.status).toBe(200);
    const body = zGetActiveSessionResponse.parse(await response.json());
    expect(body.blocks.map((entry) => entry.block.id)).toEqual([BLOCK]);
    // The sign-in; the session; its blocks, who recorded on them and its picks.
    expect(tracked.sent).toBe(5);
    expect(tracked.depth).toBe(3);
  });

  it("reads nothing for a caller who is not signed in", async () => {
    auth.mockResolvedValue(null);
    tracked = app();
    const response = await activeSession(new Request("https://test.local/api/sessions/active"));
    expect(response.status).toBe(401);
    expect(tracked.sent).toBe(0);
  });
});
