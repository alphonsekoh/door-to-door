import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { requireTestDatabaseUrl } from "@/db/test-env";
import { addTeamMember, createTeam } from "@/server/teams/service";
import { updateUser } from "@/server/users/service";

/*
 * Placing someone on a team while they are deactivated (#158), while the
 * session or the team changes, or while another placement lists the same
 * people (#180). These hold a row from a second connection so a request is
 * provably parked while the other side acts, then released: no sleeps
 * deciding the outcome. The harness is the one in
 * src/server/follow-ups/races.integration.test.ts.
 */

const pool = createTestPool();
const controller = new Pool({ connectionString: requireTestDatabaseUrl(), max: 3 });
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "7b7b7b7b-0000-4000-8000-000000000001";
const ALICE = "7b7b7b7b-0000-4000-8000-000000000002";
const BEN = "7b7b7b7b-0000-4000-8000-000000000003";
const CARL = "7b7b7b7b-0000-4000-8000-000000000004";
const DAN = "7b7b7b7b-0000-4000-8000-000000000005";
const SESSION = "7b7b7b7b-0000-4000-8002-000000000001";
const TEAM = "7b7b7b7b-0000-4000-8004-000000000001";
const admin = { id: ADMIN, role: "admin" as const };
const member = (id: string) => ({ id, role: "member" as const });

type Query = (sql: string, params?: unknown[]) => Promise<unknown>;

const POLL_BUDGET_MS = 4_000;
vi.setConfig({ testTimeout: 15_000 });

/* Until `count` requests are blocked on a lock in a statement like `pattern`. */
async function waitingOn(pattern: string, count = 1): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const { rows } = await controller.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND datname = current_database()
         AND pid <> pg_backend_pid() AND query ILIKE $1`,
      [pattern],
    );
    if (rows.length >= count) return;
    if (Date.now() - startedAt > POLL_BUDGET_MS) {
      throw new Error(`no request waited on ${pattern}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settle = (request: Promise<unknown>) =>
  request.then(
    (value) => ({ ok: value }),
    (error: unknown) => ({ error }),
  );

/*
 * Takes a row on a second connection with `hold`, starts the request, waits
 * until it is blocked in a statement like `waitsOn`, lets `whileHeld` change
 * things, then commits. A request that never waits fails the test. It is
 * awaited before returning whatever fails, so it can never write into the
 * next test.
 */
async function parked(
  hold: (query: Query) => Promise<unknown>,
  start: () => Promise<unknown>,
  waitsOn: string,
  whileHeld: (query: Query) => Promise<unknown>,
): Promise<unknown> {
  const client = await controller.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await client.query("BEGIN");
    await hold((sql, params) => client.query(sql, params));
    pending = settle(start());
    await waitingOn(waitsOn);
    await whileHeld((sql, params) => client.query(sql, params));
    await client.query("COMMIT");
    return await pending;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await pending;
    throw error;
  } finally {
    client.release();
  }
}

/* Parked on Ben's row, where every placement of Ben starts. */
const parkedOnBen = (
  start: () => Promise<unknown>,
  whileHeld: (query: Query) => Promise<unknown>,
) =>
  parked(
    (q) => q(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [BEN]),
    start,
    `%from "users"%for share%`,
    whileHeld,
  );

/*
 * Two requests in a fixed order: `hold` takes a row on a second connection,
 * the first request parks on it, the second parks behind the first, then the
 * row is let go. Both are settled before returning, whatever fails.
 */
async function race(
  hold: (query: Query) => Promise<unknown>,
  first: () => Promise<unknown>,
  firstWaitsOn: string,
  second: () => Promise<unknown>,
  secondWaitsOn: string,
) {
  const client = await controller.connect();
  let one: Promise<unknown> | undefined;
  let two: Promise<unknown> | undefined;
  try {
    await client.query("BEGIN");
    await hold((sql, params) => client.query(sql, params));
    one = settle(first());
    await waitingOn(firstWaitsOn);
    two = settle(second());
    await waitingOn(secondWaitsOn);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await Promise.all([one, two]);
  }
  return [await one, await two];
}

/*
 * Puts `person` on Alice's team from a second connection, uncommitted, so a
 * placement listing them parks in the one-team-per-session index. Starts each
 * request in turn until it waits on a team-member insert, then rolls the row
 * back. All are settled before returning, whatever fails.
 */
async function heldInTheIndex(person: string, starts: (() => Promise<unknown>)[]) {
  const client = await controller.connect();
  const pending: Promise<unknown>[] = [];
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3)`,
      [TEAM, SESSION, person],
    );
    for (const start of starts) {
      pending.push(settle(start()));
      await waitingOn(`%insert into "session_team_members"%`, pending.length);
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await Promise.all(pending);
  }
  return Promise.all(pending);
}

const join = (...people: string[]) =>
  pool.query(
    `INSERT INTO session_participants (session_id, user_id) SELECT $1, unnest($2::uuid[])`,
    [SESSION, people],
  );

const deactivateBen = () => updateUser(db, BEN, { deactivated: true }, ADMIN);
const deactivated = {
  status: 409,
  code: "conflict",
  message: "One or more of those people are deactivated.",
};

const count = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows.length;
const written = async () => ({
  teams: await count(`SELECT 1 FROM session_teams WHERE session_id = $1`, [SESSION]),
  benOnATeam: await count(`SELECT 1 FROM session_team_members WHERE user_id = $1`, [BEN]),
  benJoined: await count(`SELECT 1 FROM session_participants WHERE user_id = $1`, [BEN]),
});
const benDeactivated = async () =>
  (
    await pool.query<{ deactivated_at: Date | null }>(
      `SELECT deactivated_at FROM users WHERE id = $1`,
      [BEN],
    )
  ).rows[0]?.deactivated_at instanceof Date;

beforeEach(async () => {
  await truncateAll(pool);
  // Ben is stored before Admin, for the id-order test.
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($3,'ben@t.local','Ben','member'), ($2,'alice@t.local','Alice','member'),
      ($1,'a@t.local','Admin','admin')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, started_at, created_by)
     VALUES ($1,'Outing','active', now() - interval '1 hour', $2)`,
    [SESSION, ADMIN],
  );
  await pool.query(
    `INSERT INTO session_teams (id, session_id, name, created_by) VALUES ($1,$2,'Alice',$3)`,
    [TEAM, SESSION, ALICE],
  );
  await pool.query(`INSERT INTO session_participants (session_id, user_id) VALUES ($1,$2)`, [
    SESSION,
    ALICE,
  ]);
  await pool.query(
    `INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3)`,
    [TEAM, SESSION, ALICE],
  );
});

afterAll(async () => {
  await controller.end();
  await pool.end();
});

/* A placement's lock on the session, which an add takes with the team's. */
const AT_THE_SESSION = `%"outing_sessions"%for key share%`;

/* Every path that places someone. */
const placements = [
  {
    path: "forming a team",
    place: () => createTeam(db, admin, SESSION, { name: "Pair", memberIds: [BEN] }),
    teams: 2,
  },
  {
    path: "adding to a team",
    place: () => addTeamMember(db, admin, TEAM, BEN),
    teams: 1,
  },
];

describe("placing someone while an admin deactivates them", () => {
  it.each(placements)(
    "refuses $path once the deactivation it waited for lands, and writes nothing",
    async ({ place }) => {
      const outcome = await parkedOnBen(place, (q) =>
        q(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [BEN]),
      );

      expect(outcome).toMatchObject({ error: deactivated });
      expect(await written()).toEqual({ teams: 1, benOnATeam: 0, benJoined: 0 });
    },
  );

  it.each(placements)(
    "holds the deactivation until $path that took the person first lands",
    async ({ place, teams }) => {
      /*
       * The placement takes Ben's row, then parks on the session held here;
       * the deactivation then parks on Ben. Taken after the inserts, or as
       * KEY SHARE, the deactivation would not wait.
       */
      const [placing, deactivating] = await race(
        (q) => q(`SELECT 1 FROM outing_sessions WHERE id = $1 FOR UPDATE`, [SESSION]),
        place,
        AT_THE_SESSION,
        deactivateBen,
        `%from "users"%for no key update%`,
      );

      expect(placing).toMatchObject({ ok: { sessionId: SESSION } });
      expect(deactivating).toMatchObject({ ok: { id: BEN } });
      expect(await benDeactivated()).toBe(true);
      expect(await written()).toEqual({ teams, benOnATeam: 1, benJoined: 1 });
    },
  );

  it("locks in id order, so a placement queued behind a deactivation does not deadlock with it", async () => {
    /*
     * The deactivation locks Admin, then Ben, as every active admin and its
     * target. Held at Admin here, it parks first; the placement of both then
     * queues at Admin holding nothing. Had it locked Ben first, the two would
     * each hold what the other needs once Admin is let go.
     *
     * A scan of the primary key returns Admin first with or without the
     * ORDER BY, and the planner may choose one. So the placement runs on a
     * connection with index scans off: it reads rows in the order they were
     * stored, Ben before Admin, and only the ORDER BY locks Admin first.
     */
    const storageOrder = new Pool({
      connectionString: requireTestDatabaseUrl(),
      max: 1,
      options: "-c enable_indexscan=off -c enable_indexonlyscan=off",
    });
    const unindexed = drizzle(storageOrder, { schema }) as unknown as Database;
    try {
      const [deactivating, placing] = await race(
        (q) => q(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [ADMIN]),
        deactivateBen,
        `%from "users"%for no key update%`,
        () => createTeam(unindexed, admin, SESSION, { name: "Pair", memberIds: [BEN, ADMIN] }),
        `%from "users"%for share%`,
      );

      expect(deactivating).toMatchObject({ ok: { id: BEN } });
      expect(placing).toMatchObject({ error: deactivated });
      expect(await written()).toEqual({ teams: 1, benOnATeam: 0, benJoined: 0 });
    } finally {
      await storageOrder.end();
    }
  });
});

describe("two members forming teams that list each other at the same moment", () => {
  beforeEach(async () => {
    await pool.query(
      `INSERT INTO users (id, email, name, role) VALUES
        ($1,'carl@t.local','Carl','member'), ($2,'dan@t.local','Dan','member')`,
      [CARL, DAN],
    );
    await join(BEN, CARL, DAN);
  });

  it("places one team and refuses the other 409, never a deadlock", async () => {
    /*
     * Both list Dan, whose place in the index is held here, so each parks on
     * him. Inserted in the order each caller gave, Ben's would already hold
     * Ben and Carl's Carl; once Dan is let go each waits on the other's row,
     * and Postgres ends that deadlock by failing one with 40P01, a 500. In id
     * order Carl's queues behind Ben's first row and loses to the index.
     */
    const [ben, carl] = await heldInTheIndex(DAN, [
      () => createTeam(db, member(BEN), SESSION, { name: "Ben", memberIds: [DAN, CARL] }),
      () => createTeam(db, member(CARL), SESSION, { name: "Carl", memberIds: [DAN, BEN] }),
    ]);

    expect(ben).toMatchObject({ ok: { name: "Ben" } });
    expect(carl).toMatchObject({ error: { status: 409, code: "conflict" } });
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM session_team_members m JOIN session_teams t ON t.id = m.team_id
       WHERE t.name = 'Ben' ORDER BY user_id`,
    );
    expect(rows.map((row) => row.user_id)).toEqual([BEN, CARL, DAN]);
    expect(await written()).toMatchObject({ teams: 2 });
  });
});

describe("placing someone while the session or the team changes", () => {
  beforeEach(() => join(BEN));

  it.each([
    {
      path: "forming a team",
      place: () => createTeam(db, member(BEN), SESSION, { name: "Ben" }),
    },
    {
      path: "adding to a team",
      place: () => addTeamMember(db, member(ALICE), TEAM, BEN),
    },
  ])("refuses $path once the end it waited for lands, and writes nothing", async ({ place }) => {
    // What ending a session holds while it lands.
    const outcome = await parked(
      (q) => q(`SELECT 1 FROM outing_sessions WHERE id = $1 FOR UPDATE`, [SESSION]),
      place,
      AT_THE_SESSION,
      (q) =>
        q(`UPDATE outing_sessions SET status = 'ended', ended_at = now() WHERE id = $1`, [SESSION]),
    );

    expect(outcome).toMatchObject({ error: { status: 409, code: "session_not_active" } });
    expect(await written()).toEqual({ teams: 1, benOnATeam: 0, benJoined: 1 });
  });

  it("refuses an add once the disband it waited for lands, and writes nothing", async () => {
    // What disbanding a team holds while it lands.
    const outcome = await parked(
      (q) => q(`SELECT 1 FROM session_teams WHERE id = $1 FOR UPDATE`, [TEAM]),
      () => addTeamMember(db, admin, TEAM, BEN),
      AT_THE_SESSION,
      (q) => q(`DELETE FROM session_teams WHERE id = $1`, [TEAM]),
    );

    expect(outcome).toMatchObject({ error: { status: 404, message: "No such team." } });
    expect(await written()).toEqual({ teams: 0, benOnATeam: 0, benJoined: 1 });
  });

  it("refuses a member's add once their own removal it waited for lands, and writes nothing", async () => {
    // What removing a member holds while it lands.
    const outcome = await parked(
      (q) =>
        q(`SELECT 1 FROM session_team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE`, [
          TEAM,
          ALICE,
        ]),
      () => addTeamMember(db, member(ALICE), TEAM, BEN),
      `%from "session_team_members"%for key share%`,
      (q) =>
        q(`DELETE FROM session_team_members WHERE team_id = $1 AND user_id = $2`, [TEAM, ALICE]),
    );

    expect(outcome).toMatchObject({
      error: { status: 403, message: "You are not on that team." },
    });
    expect(await written()).toEqual({ teams: 1, benOnATeam: 0, benJoined: 1 });
  });
});
