import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { requireTestDatabaseUrl } from "@/db/test-env";
import type { Clock } from "@/lib/clock";
import type * as Access from "@/server/teams/access";
import { syncVisits, type SyncItem } from "@/server/visits/sync";

type TeamIdFor = typeof Access.teamIdFor;
const { teamIdFor, real } = vi.hoisted(() => ({
  teamIdFor: vi.fn<TeamIdFor>(),
  real: { fn: undefined as TeamIdFor | undefined },
}));
vi.mock("@/server/teams/access", async (importOriginal) => {
  const actual = await importOriginal<typeof Access>();
  real.fn = actual.teamIdFor;
  teamIdFor.mockImplementation(actual.teamIdFor);
  return { ...actual, teamIdFor };
});

/*
 * The checks in applyItem read before they write, and other requests move in
 * between. These hold a real row lock from a second connection so a flush is
 * provably parked mid-write while the world changes, then released: no sleeps
 * deciding the outcome, no "either result is fine".
 */

const pool = createTestPool();
const controller = new Pool({ connectionString: requireTestDatabaseUrl(), max: 3 });
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "77777777-0000-4000-8000-000000000001";
const ALICE = "77777777-0000-4000-8000-000000000002";
const BEN = "77777777-0000-4000-8000-000000000003";
const BLOCK = "77777777-0000-4000-8001-000000000001";
const SESSION = "77777777-0000-4000-8002-000000000001";
const V1 = "01960000-0000-7000-8000-00000000ddd1";
const GHOST_TEAM = "77777777-0000-4000-8004-0000000000ff";

const T1 = "2026-03-14T10:00:00.000Z";
const T2 = "2026-03-14T11:00:00.000Z";
const T3 = "2026-03-14T11:30:00.000Z";
const clock: Clock = { now: new Date("2026-03-14T12:00:00.000Z"), toleranceMs: 300_000 };

const item = (overrides: Partial<SyncItem> = {}): SyncItem => ({
  id: V1,
  blockId: BLOCK,
  unitNumber: "#05-123",
  interestLevel: "low",
  clientCreatedAt: T1,
  updatedAt: T1,
  ...overrides,
});
const flush = (items: SyncItem[], memberId: string) =>
  syncVisits(db, items, { id: memberId, role: "member" }, clock);

const row = async () =>
  (
    await pool.query(
      `SELECT interest_level, description, updated_at, member_id, team_id FROM visits WHERE id=$1`,
      [V1],
    )
  ).rows[0] as Record<string, unknown>;

type Query = (sql: string, params?: unknown[]) => Promise<unknown>;

const POLL_BUDGET_MS = 4_000;
// Well above the poll budget, so a flush that never parks fails with its own message.
vi.setConfig({ testTimeout: 15_000 });

/*
 * Holds a transaction on a second connection (`setup` takes the lock or makes
 * the uncommitted row), starts the flush, waits until a backend is blocked
 * running a query matching `waitingOn`, lets `whileHeld` change things, then
 * commits. Whatever fails, the flush is awaited before returning so it can
 * never write into the next test.
 */
async function parkedFlush(options: {
  setup: (query: Query) => Promise<unknown>;
  waitingOn: string;
  start: () => Promise<unknown>;
  whileHeld?: (query: Query) => Promise<void>;
}): Promise<unknown> {
  const client = await controller.connect();
  const query: Query = (sql, params) => client.query(sql, params);
  let pending: Promise<unknown> | undefined;
  try {
    await client.query("BEGIN");
    await options.setup(query);
    pending = options.start();
    const startedAt = Date.now();
    for (;;) {
      const { rows } = await controller.query(
        `SELECT 1 FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database()
           AND pid <> pg_backend_pid() AND query ILIKE $1`,
        [options.waitingOn],
      );
      if (rows.length > 0) break;
      if (Date.now() - startedAt > POLL_BUDGET_MS) {
        throw new Error("the flush never reached the lock");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await options.whileHeld?.(query);
    await client.query("COMMIT");
    return await pending;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await pending?.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const lockedFlush = (start: () => Promise<unknown>, whileHeld: (query: Query) => Promise<void>) =>
  parkedFlush({
    setup: (q) => q("SELECT 1 FROM visits WHERE id=$1 FOR UPDATE", [V1]),
    waitingOn: "%for update%",
    start,
    whileHeld,
  });

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'), ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at) VALUES ($1,'Outing','active',$2,$3)`,
    [SESSION, ADMIN, new Date("2026-03-14T08:00:00.000Z")],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  const team = await pool.query<{ id: string }>(
    `INSERT INTO session_teams (session_id, name, created_by) VALUES ($1,'Pair',$2) RETURNING id`,
    [SESSION, ADMIN],
  );
  await pool.query(
    `INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3), ($1,$2,$4)`,
    [team.rows[0]?.id, SESSION, ALICE, BEN],
  );
  await flush([item()], ALICE);
  teamIdFor.mockReset();
  if (real.fn) teamIdFor.mockImplementation(real.fn);
});

afterAll(async () => {
  await controller.end();
  await pool.end();
});

describe("an amend that raced a concurrent write", () => {
  it("is stale when someone else committed a newer edit while it waited", async () => {
    const [result] = (await lockedFlush(
      () => flush([item({ interestLevel: "high", updatedAt: T2 })], BEN),
      async (q) => {
        await q(`UPDATE visits SET interest_level='medium', updated_at=$1 WHERE id=$2`, [T3, V1]);
      },
    )) as Awaited<ReturnType<typeof flush>>;

    expect(result?.status).toBe("stale");
    expect(await row()).toMatchObject({ interest_level: "medium" });
  });

  it("is unchanged when the same edit was committed while it waited", async () => {
    const [result] = (await lockedFlush(
      () => flush([item({ interestLevel: "high", updatedAt: T2 })], BEN),
      async (q) => {
        await q(`UPDATE visits SET interest_level='high', updated_at=$1 WHERE id=$2`, [T2, V1]);
      },
    )) as Awaited<ReturnType<typeof flush>>;

    expect(result?.status).toBe("unchanged");
  });

  it("is refused when the teammate was removed while it waited, changing nothing", async () => {
    const [result] = (await lockedFlush(
      () => flush([item({ interestLevel: "high", description: "late", updatedAt: T2 })], BEN),
      async (q) => {
        await q(`DELETE FROM session_team_members WHERE user_id=$1`, [BEN]);
      },
    )) as Awaited<ReturnType<typeof flush>>;

    expect(result?.status).toBe("rejected");
    expect(result?.error?.code).toBe("conflict");
    expect(await row()).toMatchObject({ interest_level: "low", description: "", member_id: ALICE });
  });

  it("leaves household identity alone when it loses", async () => {
    await lockedFlush(
      () => flush([item({ name: "Mr Late", updatedAt: T2 })], BEN),
      async (q) => {
        await q(`UPDATE visits SET updated_at=$1 WHERE id=$2`, [T3, V1]);
      },
    );
    const { rows } = await pool.query(`SELECT name FROM households`);
    expect(rows).toEqual([{ name: null }]);
  });

  it("applies when nothing changed while it waited", async () => {
    const [result] = (await lockedFlush(
      () => flush([item({ interestLevel: "high", updatedAt: T2 })], BEN),
      () => Promise.resolve(),
    )) as Awaited<ReturnType<typeof flush>>;
    expect(result?.status).toBe("applied");
    expect(await row()).toMatchObject({ interest_level: "high", member_id: ALICE });
  });
});

describe("a flush that meets a record created while it was in flight", () => {
  const NEW = "01960000-0000-7000-8000-00000000ddd2";

  const insertUncommitted = async (q: Query, unit: string, inSession: string) => {
    const mine = await pool.query<{ household_id: string; team_id: string }>(
      `SELECT household_id, team_id FROM visits WHERE id=$1`,
      [V1],
    );
    let householdId = mine.rows[0]?.household_id;
    if (unit !== "#05-123") {
      householdId = (
        (await q(`INSERT INTO households (block_id, unit_number) VALUES ($1,$2) RETURNING id`, [
          BLOCK,
          unit,
        ])) as { rows: { id: string }[] }
      ).rows[0]?.id;
    }
    await q(
      `INSERT INTO visits (id, household_id, session_id, member_id, team_id, interest_level, updated_at, client_created_at)
       VALUES ($1,$2,$3,$4,$5,'low',$6,$6)`,
      [NEW, householdId, inSession, ALICE, mine.rows[0]?.team_id, T1],
    );
    await q(`INSERT INTO visit_teammates (visit_id, user_id) VALUES ($1,$2)`, [NEW, BEN]);
  };

  // On the same unit the flush parks first on the household row the uncommitted
  // visit holds a key lock on; on another unit, on the visit's own unique index.
  const flushWhileInserting = (
    unit: string,
    itemUnit: string,
    overrides: Partial<SyncItem>,
    inSession = SESSION,
  ) =>
    parkedFlush({
      setup: (q) => insertUncommitted(q, unit, inSession),
      waitingOn: unit === itemUnit ? '%"households"%' : '%insert into "visits"%',
      start: () => flush([item({ id: NEW, unitNumber: itemUnit, ...overrides })], ALICE),
    }) as Promise<Awaited<ReturnType<typeof flush>>>;

  it("takes the existing row instead of inserting twice: unchanged, one snapshot", async () => {
    const [result] = await flushWhileInserting("#05-123", "#05-123", {});

    expect(result?.status).toBe("unchanged");
    const { rows } = await pool.query(`SELECT user_id FROM visit_teammates WHERE visit_id=$1`, [
      NEW,
    ]);
    expect(rows).toEqual([{ user_id: BEN }]);
    expect((await pool.query(`SELECT 1 FROM visits WHERE id=$1`, [NEW])).rowCount).toBe(1);
  });

  it("refuses to move it to another outing", async () => {
    const OTHER_OUTING = "77777777-0000-4000-8002-000000000002";
    await pool.query(
      `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Earlier','ended',$2)`,
      [OTHER_OUTING, ADMIN],
    );
    const [result] = await flushWhileInserting("#05-123", "#05-123", {}, OTHER_OUTING);

    expect(result?.error?.code).toBe("conflict");
    const { rows } = await pool.query(`SELECT session_id FROM visits WHERE id=$1`, [NEW]);
    expect(rows).toEqual([{ session_id: OTHER_OUTING }]);
  });

  it("refuses to move it to another unit, and undoes the identity it already wrote", async () => {
    const [result] = await flushWhileInserting("#09-909", "#05-123", { name: "Mr Misplaced" });

    expect(result?.status).toBe("rejected");
    expect(result?.error?.code).toBe("conflict");
    const { rows } = await pool.query(
      `SELECT unit_number, name FROM households ORDER BY unit_number`,
    );
    expect(rows).toEqual([
      { unit_number: "#05-123", name: null },
      { unit_number: "#09-909", name: null },
    ]);
  });
});

describe("a team disbanded between reading it and stamping the record", () => {
  it("re-reads the author's team and saves the record, rather than holding it", async () => {
    const id = "01960000-0000-7000-8000-00000000ddd3";
    teamIdFor.mockImplementationOnce(() => Promise.resolve(GHOST_TEAM));
    const [result] = await flush([item({ id, unitNumber: "#06-201" })], ALICE);

    expect(result?.status).toBe("applied");
    expect(teamIdFor).toHaveBeenCalledTimes(2);
    expect(result?.visit?.teamId).not.toBe(GHOST_TEAM);
    expect(result?.visit?.team?.name).toBe("Pair");
  });

  it("gives up after one retry, as a retryable failure", async () => {
    const id = "01960000-0000-7000-8000-00000000ddd4";
    teamIdFor.mockImplementation(() => Promise.resolve(GHOST_TEAM));
    const [result] = await flush([item({ id, unitNumber: "#06-201" })], ALICE);

    expect(result?.status).toBe("rejected");
    expect(result?.error?.code).toBe("internal_error");
    const { rows } = await pool.query(`SELECT 1 FROM visits WHERE id=$1`, [id]);
    expect(rows).toHaveLength(0);
  });
});
