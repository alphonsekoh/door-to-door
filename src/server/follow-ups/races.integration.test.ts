import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { requireTestDatabaseUrl } from "@/db/test-env";
import { createFollowUp, removeFollowUp, updateFollowUp } from "@/server/follow-ups/service";
import { removeSessionHousehold } from "@/server/sessions/households";
import { createVisit } from "@/server/visits/service";
import { syncVisits } from "@/server/visits/sync";

/*
 * A member's right to change a note depends on its state, and an admin can
 * change that state in between; whether a new note may be written depends on
 * the notes already at the door. These hold a row from a second connection
 * so a request is provably parked while the other side acts, then released:
 * no sleeps deciding the outcome.
 */

const pool = createTestPool();
const controller = new Pool({ connectionString: requireTestDatabaseUrl(), max: 3 });
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "7a7a7a7a-0000-4000-8000-000000000001";
const ALICE = "7a7a7a7a-0000-4000-8000-000000000002";
const BLOCK = "7a7a7a7a-0000-4000-8001-000000000001";
const HOUSEHOLD = "7a7a7a7a-0000-4000-8003-000000000001";
const QUIET = "7a7a7a7a-0000-4000-8003-000000000002";
const NOTE = "7a7a7a7a-0000-4000-8004-000000000001";
const SESSION = "7a7a7a7a-0000-4000-8002-000000000001";
const alice = { id: ALICE, role: "member" as const };
const admin = { id: ADMIN, role: "admin" as const };

type Query = (sql: string, params?: unknown[]) => Promise<unknown>;

const POLL_BUDGET_MS = 4_000;
vi.setConfig({ testTimeout: 15_000 });

type Held = { table: "follow_ups" | "households" | "outing_sessions"; id: string };
const theNote: Held = { table: "follow_ups", id: NOTE };

/*
 * Locks the row on a second connection, starts the request, waits until it
 * is blocked on that table, lets `whileHeld` change things, then commits. A
 * request that never waits fails the test. It is awaited before returning
 * whatever fails, so it can never write into the next test.
 */
/* Until `waiters` requests are blocked on a lock in a statement like `pattern`. */
async function waitingOn(pattern: string, waiters = 1): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const { rows } = await controller.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND datname = current_database()
         AND pid <> pg_backend_pid() AND query ILIKE $1`,
      [pattern],
    );
    if (rows.length >= waiters) return;
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

async function parked(
  held: Held,
  start: () => Promise<unknown>,
  whileHeld: (query: Query) => Promise<void>,
  /* How many requests must be seen waiting before the row is let go. */
  waiters = 1,
): Promise<unknown> {
  const client = await controller.connect();
  const query: Query = (sql, params) => client.query(sql, params);
  let pending: Promise<unknown> | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT 1 FROM ${held.table} WHERE id = $1 FOR UPDATE`, [held.id]);
    pending = settle(start());
    await waitingOn(`%${held.table}%`, waiters);
    await whileHeld(query);
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

const promote = (q: Query) =>
  q(`UPDATE follow_ups SET status = 'listed', listed_at = now(), listed_by = $1 WHERE id = $2`, [
    ADMIN,
    NOTE,
  ]).then(() => undefined);

/* What an admin's create or a listing writes, done by the other side. */
const suggest = (q: Query, household: string) =>
  q(
    `INSERT INTO follow_ups (household_id, note, author_id, status) VALUES ($1,'Worth a try',$2,'suggested')`,
    [household, ALICE],
  ).then(() => undefined);
const list = (q: Query, household: string) =>
  q(
    `INSERT INTO follow_ups (household_id, note, author_id, status, listed_at, listed_by)
     VALUES ($1,'Bring the flyer',$2,'listed',now(),$2)`,
    [household, ADMIN],
  ).then(() => undefined);

const openNotes = async (household: string) =>
  (
    await pool.query<{ status: string }>(
      `SELECT status FROM follow_ups
       WHERE household_id = $1 AND deleted_at IS NULL AND done_at IS NULL ORDER BY status`,
      [household],
    )
  ).rows.map((row) => row.status);

const stored = async () =>
  (
    await pool.query<{ status: string; note: string; deleted_at: Date | null }>(
      `SELECT status, note, deleted_at FROM follow_ups WHERE id = $1`,
      [NOTE],
    )
  ).rows[0];

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number) VALUES ($1,$3,'#05-123'), ($2,$3,'#05-125')`,
    [HOUSEHOLD, QUIET, BLOCK],
  );
  await pool.query(
    `INSERT INTO follow_ups (id, household_id, note, author_id, status)
     VALUES ($1,$2,'Asked us back',$3,'suggested')`,
    [NOTE, HOUSEHOLD, ALICE],
  );
});

afterAll(async () => {
  await controller.end();
  await pool.end();
});

describe("a member's change that raced an admin listing the suggestion", () => {
  it("does not withdraw a note that was listed while it waited", async () => {
    const outcome = await parked(
      theNote,
      () => removeFollowUp(db, NOTE, alice, "Changed my mind"),
      promote,
    );

    expect(outcome).toMatchObject({ error: { status: 403 } });
    expect(await stored()).toMatchObject({ status: "listed", deleted_at: null });
  });

  it("does not reword a note listed while it waited, outside a follow-up session", async () => {
    const outcome = await parked(
      theNote,
      () => updateFollowUp(db, NOTE, { note: "Changed my mind" }, alice),
      promote,
    );

    expect(outcome).toMatchObject({ error: { code: "not_on_follow_up_list", status: 409 } });
    expect(await stored()).toMatchObject({ status: "listed", note: "Asked us back" });
  });

  it("still withdraws a suggestion nobody acted on", async () => {
    const outcome = await parked(
      theNote,
      () => removeFollowUp(db, NOTE, alice, "Changed my mind"),
      () => Promise.resolve(),
    );

    expect(outcome).toEqual({ ok: undefined });
    expect((await stored())?.deleted_at).toBeInstanceOf(Date);
  });
});

describe("two notes opened at one door at once", () => {
  const quiet: Held = { table: "households", id: QUIET };

  it("refuses an admin's note while a member's suggestion lands first", async () => {
    const outcome = await parked(
      quiet,
      () => createFollowUp(db, { householdId: QUIET, note: "Bring the flyer" }, admin),
      (q) => suggest(q, QUIET),
    );

    expect(outcome).toMatchObject({ error: { code: "follow_up_exists", status: 409 } });
    expect(await openNotes(QUIET)).toEqual(["suggested"]);
  });

  it("refuses a member's suggestion while an admin's note lands first", async () => {
    const outcome = await parked(
      quiet,
      () => createFollowUp(db, { householdId: QUIET, note: "Worth a try" }, alice),
      (q) => list(q, QUIET),
    );

    expect(outcome).toMatchObject({ error: { code: "follow_up_exists", status: 409 } });
    expect(await openNotes(QUIET)).toEqual(["listed"]);
  });

  it("refuses a member's suggestion at a door whose suggestion is being listed", async () => {
    // The other side lists Alice's suggestion as listing does: household first.
    const outcome = await parked(
      { table: "households", id: HOUSEHOLD },
      () => createFollowUp(db, { householdId: HOUSEHOLD, note: "Again" }, alice),
      promote,
    );

    expect(outcome).toMatchObject({ error: { code: "follow_up_exists", status: 409 } });
    expect(await openNotes(HOUSEHOLD)).toEqual(["listed"]);
  });

  it("lists a suggestion only once the door is free", async () => {
    const outcome = await parked(
      { table: "households", id: HOUSEHOLD },
      () => updateFollowUp(db, NOTE, { status: "listed" }, admin),
      () => Promise.resolve(),
    );

    expect(outcome).toMatchObject({ ok: { status: "listed" } });
    expect(await openNotes(HOUSEHOLD)).toEqual(["listed"]);
  });
});

describe("an admin reopening while a member suggests the same door", () => {
  /* The note listed and resolved, so reopening it owes the door again. */
  const resolved = (q: Query) =>
    q(
      `UPDATE follow_ups SET status = 'listed', listed_at = now(), listed_by = $1, done_at = now()
       WHERE id = $2`,
      [ADMIN, NOTE],
    ).then(() => undefined);

  it("lists the suggestion that landed first, with the reopen", async () => {
    await resolved((sql, params) => pool.query(sql, params));
    // The member's suggestion takes the household first, as creating does.
    const outcome = await parked(
      { table: "households", id: HOUSEHOLD },
      () => updateFollowUp(db, NOTE, { done: false }, admin),
      (q) => suggest(q, HOUSEHOLD),
    );

    expect(outcome).toMatchObject({ ok: { doneAt: null, waitingSuggestionId: null } });
    const { rows } = await pool.query<{ status: string; listed_by: string | null }>(
      `SELECT status, listed_by FROM follow_ups WHERE household_id = $1 AND id <> $2`,
      [HOUSEHOLD, NOTE],
    );
    expect(rows).toEqual([{ status: "listed", listed_by: ADMIN }]);
    expect(await openNotes(HOUSEHOLD)).toEqual(["listed", "listed"]);
  });

  it("refuses the member's suggestion once the reopen landed first", async () => {
    await resolved((sql, params) => pool.query(sql, params));
    const outcome = await parked(
      { table: "households", id: HOUSEHOLD },
      () => createFollowUp(db, { householdId: HOUSEHOLD, note: "Again" }, alice),
      (q) =>
        q(`UPDATE follow_ups SET done_at = NULL, done_by = NULL WHERE id = $1`, [NOTE]).then(
          () => undefined,
        ),
    );

    expect(outcome).toMatchObject({ error: { code: "follow_up_exists", status: 409 } });
    expect(await openNotes(HOUSEHOLD)).toEqual(["listed"]);
  });
});

describe("two admins removing a follow-up session's last two households at once", () => {
  it("lets exactly one through, so the session keeps a household", async () => {
    await pool.query(
      `INSERT INTO outing_sessions (id, title, kind, status, created_by)
       VALUES ($1,'Follow-up','follow_up','draft',$2)`,
      [SESSION, ADMIN],
    );
    await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
      SESSION,
      BLOCK,
    ]);
    await pool.query(
      `INSERT INTO session_households (session_id, household_id) VALUES ($1,$2), ($1,$3)`,
      [SESSION, HOUSEHOLD, QUIET],
    );

    const outcome = await parked(
      { table: "outing_sessions", id: SESSION },
      () =>
        Promise.allSettled([
          removeSessionHousehold(db, SESSION, HOUSEHOLD),
          removeSessionHousehold(db, SESSION, QUIET),
        ]),
      () => Promise.resolve(),
      2,
    );

    const settled = (outcome as { ok: PromiseSettledResult<void>[] }).ok;
    expect(settled.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(settled.find((result) => result.status === "rejected")).toMatchObject({
      reason: { status: 409, code: "conflict" },
    });
    const { rows } = await pool.query(`SELECT 1 FROM session_households WHERE session_id = $1`, [
      SESSION,
    ]);
    expect(rows).toHaveLength(1);
    const blocks = await pool.query(`SELECT 1 FROM session_blocks WHERE session_id = $1`, [
      SESSION,
    ]);
    expect(blocks.rows).toHaveLength(1);
  });
});

describe("a visit recorded while an admin changes the session's households", () => {
  const clock = { now: new Date(), toleranceMs: 300_000 };
  let visitSeq = 0;
  const nextVisitId = () =>
    `01960000-0000-7000-8000-${(0x7a00 + (visitSeq += 1)).toString(16).padStart(12, "0")}`;
  const record = () =>
    createVisit(
      db,
      {
        id: nextVisitId(),
        blockId: BLOCK,
        unitNumber: "#05-125",
        interestLevel: "low",
        memberId: ALICE,
      },
      clock,
      alice,
    );
  const visitsAtQuiet = async () =>
    (await pool.query(`SELECT 1 FROM visits WHERE household_id = $1`, [QUIET])).rows.length;
  /* What removing #05-125 commits: another pick keeps the block in the session. */
  const unpickQuiet = (q: Query) =>
    q(`DELETE FROM session_households WHERE session_id = $1 AND household_id = $2`, [
      SESSION,
      QUIET,
    ]).then(() => undefined);

  beforeEach(async () => {
    await pool.query(
      `INSERT INTO outing_sessions (id, title, kind, status, started_at, created_by)
       VALUES ($1,'Follow-up','follow_up','active', now() - interval '1 hour', $2)`,
      [SESSION, ADMIN],
    );
    await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
      SESSION,
      BLOCK,
    ]);
    await pool.query(
      `INSERT INTO follow_ups (household_id, note, author_id, status) VALUES
        ($1,'Bring the flyer',$3,'listed'), ($2,'Ask about Sunday',$3,'listed')`,
      [HOUSEHOLD, QUIET, ADMIN],
    );
    await pool.query(
      `INSERT INTO session_households (session_id, household_id) VALUES ($1,$2), ($1,$3)`,
      [SESSION, HOUSEHOLD, QUIET],
    );
  });

  it("judges the record after a removal it waited for, and stores nothing", async () => {
    const outcome = await parked({ table: "outing_sessions", id: SESSION }, record, unpickQuiet);

    expect(outcome).toMatchObject({ error: { code: "not_on_follow_up_list", status: 409 } });
    expect(await visitsAtQuiet()).toBe(0);
  });

  it("holds a removal until the record lands, which then keeps the household", async () => {
    // The record locks the session, then waits on the household held here.
    const client = await controller.connect();
    let recording: Promise<unknown> | undefined;
    let removing: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT 1 FROM households WHERE id = $1 FOR UPDATE`, [QUIET]);
      recording = settle(record());
      await waitingOn(`%insert into "households"%`);
      removing = settle(removeSessionHousehold(db, SESSION, QUIET));
      await waitingOn(`%from "outing_sessions"%for update%`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await Promise.all([recording, removing]);
    }

    expect(await recording).toMatchObject({ ok: { memberId: ALICE } });
    expect(await removing).toMatchObject({
      error: {
        code: "conflict",
        message: "Someone has recorded a visit here in this session, so it stays in the session.",
      },
    });
    const { rows } = await pool.query(
      `SELECT 1 FROM session_households WHERE session_id = $1 AND household_id = $2`,
      [SESSION, QUIET],
    );
    expect(rows).toHaveLength(1);
  });

  const item = () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    return {
      id: nextVisitId(),
      blockId: BLOCK,
      unitNumber: "#05-125",
      sessionId: SESSION,
      interestLevel: "low" as const,
      clientCreatedAt: at,
      updatedAt: at,
    };
  };

  /*
   * A visit marks the door's notes done under the household's lock, as a
   * hand-marked done takes it, so whichever holds the door first is credited
   * and the other changes nothing. The note held here parks whichever side
   * got the household first.
   */
  const quietNote = async () =>
    (await pool.query<{ id: string }>(`SELECT id FROM follow_ups WHERE household_id = $1`, [QUIET]))
      .rows[0]?.id ?? "";
  const doneAtQuiet = async () =>
    (
      await pool.query<{ done_by: string | null; done_visit_id: string | null }>(
        `SELECT done_by, done_visit_id FROM follow_ups WHERE household_id = $1`,
        [QUIET],
      )
    ).rows;

  async function race(
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
      await client.query(`SELECT 1 FROM follow_ups WHERE id = $1 FOR UPDATE`, [await quietNote()]);
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

  it("leaves the credit with a mark done that held the door first", async () => {
    const id = await quietNote();
    const [marking, recording] = await race(
      () => updateFollowUp(db, id, { done: true }, admin),
      `%from "follow_ups"%for update%`,
      record,
      `%insert into "households"%`,
    );

    expect(marking).toMatchObject({ ok: { doneById: ADMIN } });
    expect(recording).toMatchObject({ ok: { memberId: ALICE } });
    expect(await doneAtQuiet()).toEqual([{ done_by: ADMIN, done_visit_id: null }]);
  });

  it("leaves the credit with a visit that held the door first", async () => {
    const id = await quietNote();
    const [recording, marking] = await race(
      record,
      `%update "follow_ups"%`,
      () => updateFollowUp(db, id, { done: true }, admin),
      `%from "households"%for update%`,
    );

    expect(recording).toMatchObject({ ok: { memberId: ALICE } });
    expect(marking).toMatchObject({ ok: { doneById: ALICE } });
    const visit = (recording as { ok: { id: string } }).ok.id;
    expect(await doneAtQuiet()).toEqual([{ done_by: ALICE, done_visit_id: visit }]);
  });

  it("judges a synced record after a removal it waited for, and holds it", async () => {
    const outcome = await parked(
      { table: "outing_sessions", id: SESSION },
      () => syncVisits(db, [item()], alice, clock),
      unpickQuiet,
    );

    expect(outcome).toMatchObject({
      ok: [{ status: "rejected", error: { code: "not_on_follow_up_list" } }],
    });
    expect(await visitsAtQuiet()).toBe(0);
  });

  it("refuses a synced record whose session ended while it waited", async () => {
    const outcome = await parked(
      { table: "outing_sessions", id: SESSION },
      () => syncVisits(db, [item()], alice, clock),
      (q) =>
        q(`UPDATE outing_sessions SET status = 'ended', ended_at = now() WHERE id = $1`, [
          SESSION,
        ]).then(() => undefined),
    );

    expect(outcome).toMatchObject({
      ok: [{ status: "rejected", error: { code: "session_not_active" } }],
    });
    expect(await visitsAtQuiet()).toBe(0);
  });
});
