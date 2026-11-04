import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { requireTestDatabaseUrl } from "@/db/test-env";
import { createFollowUp, removeFollowUp, updateFollowUp } from "@/server/follow-ups/service";
import { removeSessionHousehold } from "@/server/sessions/households";
import { detachBlock } from "@/server/sessions/service";
import { updateUser } from "@/server/users/service";
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

type Held = {
  table: "follow_ups" | "households" | "outing_sessions" | "users";
  id: string;
  /* What the request runs while it waits, where the table alone does not say enough. */
  waitsOn?: string;
};
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
    await waitingOn(held.waitsOn ?? `%${held.table}%`, waiters);
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
  const holdQuietNote = async (q: Query) =>
    q(`SELECT 1 FROM follow_ups WHERE id = $1 FOR UPDATE`, [await quietNote()]);
  const doneAtQuiet = async () =>
    (
      await pool.query<{ done_by: string | null; done_visit_id: string | null }>(
        `SELECT done_by, done_visit_id FROM follow_ups WHERE household_id = $1`,
        [QUIET],
      )
    ).rows;

  it("leaves the credit with a mark done that held the door first", async () => {
    const id = await quietNote();
    const [marking, recording] = await race(
      holdQuietNote,
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
      holdQuietNote,
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

describe("a visit recorded while an admin detaches its block", () => {
  const clock = { now: new Date(), toleranceMs: 300_000 };
  const VISIT = "01960000-0000-7000-8000-00000000db01";
  const record = () =>
    createVisit(
      db,
      { id: VISIT, blockId: BLOCK, unitNumber: "#05-123", interestLevel: "low", memberId: ALICE },
      clock,
      alice,
    );
  const detach = () => detachBlock(db, SESSION, BLOCK);
  /* The detach parks on the attachment held here, after it took the session. */
  const holdAttachment = (q: Query) =>
    q(`SELECT 1 FROM session_blocks WHERE session_id = $1 AND block_id = $2 FOR KEY SHARE`, [
      SESSION,
      BLOCK,
    ]);
  const left = async () => ({
    attached: (await pool.query(`SELECT 1 FROM session_blocks WHERE session_id = $1`, [SESSION]))
      .rows.length,
    visits: (await pool.query(`SELECT 1 FROM visits WHERE session_id = $1`, [SESSION])).rows.length,
  });

  beforeEach(async () => {
    await pool.query(
      `INSERT INTO outing_sessions (id, title, status, started_at, created_by)
       VALUES ($1,'Outing','active', now() - interval '1 hour', $2)`,
      [SESSION, ADMIN],
    );
    await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
      SESSION,
      BLOCK,
    ]);
  });

  it("holds a detach until a visit in flight lands, which then keeps the block", async () => {
    // The visit takes the session, then waits on the household held here.
    const [recording, detaching] = await race(
      (q) => q(`SELECT 1 FROM households WHERE id = $1 FOR UPDATE`, [HOUSEHOLD]),
      record,
      `%insert into "households"%`,
      detach,
      `%from "outing_sessions"%for update%`,
    );

    expect(recording).toMatchObject({ ok: { id: VISIT } });
    expect(detaching).toMatchObject({ error: { code: "block_in_use", status: 409 } });
    expect(await left()).toEqual({ attached: 1, visits: 1 });
  });

  it("refuses a visit that waited for a detach, so nothing is orphaned", async () => {
    const [detaching, recording] = await race(
      holdAttachment,
      detach,
      `%delete from "session_blocks"%`,
      record,
      `%from "outing_sessions"%for key share%`,
    );

    expect(detaching).toEqual({ ok: undefined });
    expect(recording).toMatchObject({ error: { code: "conflict", status: 409 } });
    expect(await left()).toEqual({ attached: 0, visits: 0 });
  });

  it("holds a synced visit that waited for a detach", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const queued = {
      id: VISIT,
      blockId: BLOCK,
      unitNumber: "#05-123",
      interestLevel: "low" as const,
      clientCreatedAt: at,
      updatedAt: at,
    };
    const [detaching, syncing] = await race(
      holdAttachment,
      detach,
      `%delete from "session_blocks"%`,
      () => syncVisits(db, [queued], alice, clock),
      `%from "outing_sessions"%for key share%`,
    );

    expect(detaching).toEqual({ ok: undefined });
    expect(syncing).toMatchObject({
      ok: [{ status: "rejected", error: { code: "conflict" } }],
    });
    expect(await left()).toEqual({ attached: 0, visits: 0 });
  });
});

describe("a visit recorded for a member while an admin deactivates them", () => {
  const clock = { now: new Date(), toleranceMs: 300_000 };
  const VISIT = "01960000-0000-7000-8000-00000000de01";
  // An admin types in Alice's paper record.
  const recordForAlice = () =>
    createVisit(
      db,
      { id: VISIT, blockId: BLOCK, unitNumber: "#05-127", interestLevel: "low", memberId: ALICE },
      clock,
      admin,
    );
  const deactivateAlice = () => updateUser(db, ALICE, { deactivated: true }, ADMIN);
  const written = async () => ({
    visits: (await pool.query(`SELECT 1 FROM visits WHERE id = $1`, [VISIT])).rows.length,
    households: (await pool.query(`SELECT 1 FROM households WHERE unit_number = '#05-127'`)).rows
      .length,
    participants: (
      await pool.query(`SELECT 1 FROM session_participants WHERE user_id = $1`, [ALICE])
    ).rows.length,
  });
  const aliceDeactivated = async () =>
    (
      await pool.query<{ deactivated_at: Date | null }>(
        `SELECT deactivated_at FROM users WHERE id = $1`,
        [ALICE],
      )
    ).rows[0]?.deactivated_at instanceof Date;

  beforeEach(async () => {
    await pool.query(
      `INSERT INTO outing_sessions (id, title, status, started_at, created_by)
       VALUES ($1,'Outing','active', now() - interval '1 hour', $2)`,
      [SESSION, ADMIN],
    );
    await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
      SESSION,
      BLOCK,
    ]);
  });

  it("refuses the record once the deactivation it waited for lands, and writes nothing", async () => {
    const outcome = await parked(
      { table: "users", id: ALICE, waitsOn: `%from "users"%for share%` },
      recordForAlice,
      (q) =>
        q(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]).then(() => undefined),
    );

    expect(outcome).toMatchObject({
      error: { status: 409, code: "conflict", message: "That member's account is deactivated." },
    });
    expect(await written()).toEqual({ visits: 0, households: 0, participants: 0 });
  });

  it("holds the deactivation until a record that took the member first lands", async () => {
    /*
     * The record takes Alice's row, then parks on the session held here; the
     * deactivation then parks on Alice. Taken after the session, or as KEY
     * SHARE, the deactivation would not wait and the record would be refused.
     */
    const [recording, deactivating] = await race(
      (q) => q(`SELECT 1 FROM outing_sessions WHERE id = $1 FOR UPDATE`, [SESSION]),
      recordForAlice,
      `%from "outing_sessions"%for key share%`,
      deactivateAlice,
      `%from "users"%for no key update%`,
    );

    expect(recording).toMatchObject({ ok: { id: VISIT, memberId: ALICE } });
    expect(deactivating).toMatchObject({ ok: { id: ALICE } });
    expect(await aliceDeactivated()).toBe(true);
    expect(await written()).toEqual({ visits: 1, households: 1, participants: 1 });
  });
});

describe("two admins demoting or deactivating each other at once", () => {
  // Above ADMIN, so ADMIN's row is the first both changes lock.
  const ADMIN2 = "7a7a7a7a-0000-4000-8000-000000000003";
  const lastAdmin = {
    status: 409,
    code: "conflict",
    message: "The team needs at least one active admin.",
  };
  const activeAdmins = async () =>
    (await pool.query(`SELECT 1 FROM users WHERE role = 'admin' AND deactivated_at IS NULL`)).rows
      .length;

  beforeEach(async () => {
    await pool.query(
      `INSERT INTO users (id, email, name, role) VALUES ($1,'b@t.local','Second Admin','admin')`,
      [ADMIN2],
    );
  });

  const crossed = async (change: { role: "member" } | { deactivated: true }) => {
    const outcome = await parked(
      { table: "users", id: ADMIN, waitsOn: `%from "users"%for no key update%` },
      () =>
        Promise.allSettled([
          updateUser(db, ADMIN2, change, ADMIN),
          updateUser(db, ADMIN, change, ADMIN2),
        ]),
      () => Promise.resolve(),
      2,
    );
    return (outcome as { ok: PromiseSettledResult<unknown>[] }).ok;
  };

  it("lets exactly one demotion through, so an active admin remains", async () => {
    const settled = await crossed({ role: "member" });

    expect(settled.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(settled.find((result) => result.status === "rejected")).toMatchObject({
      reason: lastAdmin,
    });
    expect(await activeAdmins()).toBe(1);
  });

  it("lets exactly one deactivation through, so an active admin remains", async () => {
    const settled = await crossed({ deactivated: true });

    expect(settled.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(settled.find((result) => result.status === "rejected")).toMatchObject({
      reason: lastAdmin,
    });
    expect(await activeAdmins()).toBe(1);
  });
});
