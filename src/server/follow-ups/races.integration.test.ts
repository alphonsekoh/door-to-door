import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { requireTestDatabaseUrl } from "@/db/test-env";
import { deleteFollowUp, updateFollowUp } from "@/server/follow-ups/service";

/*
 * A member's right to change a note depends on its state, and an admin can
 * change that state in between. These hold the note's row from a second
 * connection so the member's request is provably parked while an admin
 * lists the suggestion, then released: no sleeps deciding the outcome.
 */

const pool = createTestPool();
const controller = new Pool({ connectionString: requireTestDatabaseUrl(), max: 3 });
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "7a7a7a7a-0000-4000-8000-000000000001";
const ALICE = "7a7a7a7a-0000-4000-8000-000000000002";
const BLOCK = "7a7a7a7a-0000-4000-8001-000000000001";
const HOUSEHOLD = "7a7a7a7a-0000-4000-8003-000000000001";
const NOTE = "7a7a7a7a-0000-4000-8004-000000000001";
const alice = { id: ALICE, role: "member" as const };

type Query = (sql: string, params?: unknown[]) => Promise<unknown>;

const POLL_BUDGET_MS = 4_000;
vi.setConfig({ testTimeout: 15_000 });

/*
 * Locks the note on a second connection, starts the member's request, waits
 * until it is blocked on the note, lets `whileHeld` change things, then
 * commits. The request is awaited before returning whatever fails, so it can
 * never write into the next test.
 */
async function parked(
  start: () => Promise<unknown>,
  whileHeld: (query: Query) => Promise<void>,
): Promise<unknown> {
  const client = await controller.connect();
  const query: Query = (sql, params) => client.query(sql, params);
  let pending: Promise<unknown> | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM follow_ups WHERE id = $1 FOR UPDATE", [NOTE]);
    pending = start().then(
      (value) => ({ ok: value }),
      (error: unknown) => ({ error }),
    );
    const startedAt = Date.now();
    for (;;) {
      const { rows } = await controller.query(
        `SELECT 1 FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database()
           AND pid <> pg_backend_pid() AND query ILIKE '%follow_ups%'`,
      );
      if (rows.length > 0) break;
      if (Date.now() - startedAt > POLL_BUDGET_MS) {
        throw new Error("the request never reached the note");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
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
  await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#05-123')`, [
    HOUSEHOLD,
    BLOCK,
  ]);
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
    const outcome = await parked(() => deleteFollowUp(db, NOTE, alice), promote);

    expect(outcome).toMatchObject({ error: { status: 403 } });
    expect(await stored()).toMatchObject({ status: "listed", deleted_at: null });
  });

  it("does not reword a note listed while it waited, outside a follow-up session", async () => {
    const outcome = await parked(
      () => updateFollowUp(db, NOTE, { note: "Changed my mind" }, alice),
      promote,
    );

    expect(outcome).toMatchObject({ error: { code: "not_on_follow_up_list", status: 409 } });
    expect(await stored()).toMatchObject({ status: "listed", note: "Asked us back" });
  });

  it("still withdraws a suggestion nobody acted on", async () => {
    const outcome = await parked(
      () => deleteFollowUp(db, NOTE, alice),
      () => Promise.resolve(),
    );

    expect(outcome).toEqual({ ok: undefined });
    expect((await stored())?.deleted_at).toBeInstanceOf(Date);
  });
});
