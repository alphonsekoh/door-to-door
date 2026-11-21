import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { requireTestDatabaseUrl } from "@/db/test-env";
import {
  MAX_SIGN_INS,
  MAX_USER_AGENT_LENGTH,
  checkSignIn,
  endAllSignIns,
  endOneSignIn,
  endSignIn,
  listSignIns,
  startSignIn,
} from "@/server/auth/sign-ins";
import { updateUser } from "@/server/users/service";

const pool = createTestPool();
const controller = new Pool({ connectionString: requireTestDatabaseUrl(), max: 2 });
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "5151d000-0000-4000-8000-000000000001";
const ALICE = "5151d000-0000-4000-8000-000000000002";
const BEN = "5151d000-0000-4000-8000-000000000003";
const NOBODY = "5151d000-0000-4000-8000-0000000000ff";

const PIXEL =
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

vi.setConfig({ testTimeout: 15_000 });

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'),
      ($2,'alice@t.local','Alice','member'),
      ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
});

afterAll(async () => {
  await controller.end();
  await pool.end();
});

/* A row as it would be, used last `ago` (a Postgres interval) before now. */
async function seed(userId: string, ago = "0 seconds", userAgent: string | null = null) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sign_ins (user_id, user_agent, created_at, last_used_at)
     VALUES ($1, $2, now() - $3::interval, now() - $3::interval) RETURNING id`,
    [userId, userAgent, ago],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no sign-in seeded");
  return id;
}

const rowsOf = async (userId: string) =>
  (
    await pool.query<{ id: string; user_agent: string | null }>(
      `SELECT id, user_agent FROM sign_ins WHERE user_id = $1 ORDER BY last_used_at DESC`,
      [userId],
    )
  ).rows;

const lastUsed = async (id: string) =>
  (
    await pool.query<{ last_used_at: Date }>(`SELECT last_used_at FROM sign_ins WHERE id = $1`, [
      id,
    ])
  ).rows[0]?.last_used_at;

describe("startSignIn", () => {
  it("records the sign-in with its user agent, and returns its id", async () => {
    const id = await startSignIn(db, ALICE, PIXEL);
    expect(await rowsOf(ALICE)).toEqual([{ id, user_agent: PIXEL }]);
  });

  it("keeps no more of a user agent than it can show, and none when there is none", async () => {
    await startSignIn(db, ALICE, "x".repeat(MAX_USER_AGENT_LENGTH + 100));
    await startSignIn(db, BEN, null);
    expect((await rowsOf(ALICE))[0]?.user_agent).toHaveLength(MAX_USER_AGENT_LENGTH);
    expect((await rowsOf(BEN))[0]?.user_agent).toBeNull();
  });

  it("refuses a deactivated account or a missing one, and writes nothing", async () => {
    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]);
    expect(await startSignIn(db, ALICE, PIXEL)).toBeNull();
    expect(await startSignIn(db, NOBODY, PIXEL)).toBeNull();
    expect((await pool.query(`SELECT 1 FROM sign_ins`)).rows).toHaveLength(0);
  });

  it("deletes the user's sign-ins unused for longer than a cookie lives, and only theirs", async () => {
    const dead = await seed(ALICE, "30 days 16 minutes");
    const alive = await seed(ALICE, "30 days");
    const bens = await seed(BEN, "40 days");

    const id = await startSignIn(db, ALICE, PIXEL);
    expect((await rowsOf(ALICE)).map((row) => row.id).sort()).toEqual([alive, id].sort());
    expect(dead).not.toBe(alive);
    expect((await rowsOf(BEN)).map((row) => row.id)).toEqual([bens]);
  });

  it(`keeps at most ${String(MAX_SIGN_INS)}, ending the least recently used`, async () => {
    const seeded: string[] = [];
    for (let minutes = MAX_SIGN_INS; minutes > 0; minutes -= 1) {
      seeded.push(await seed(ALICE, `${String(minutes)} minutes`));
    }
    const oldest = seeded[0];

    const id = await startSignIn(db, ALICE, PIXEL);
    const left = (await rowsOf(ALICE)).map((row) => row.id);
    expect(left).toHaveLength(MAX_SIGN_INS);
    expect(left).toContain(id);
    expect(left).not.toContain(oldest);
    expect(left).toContain(seeded[1]);
  });
});

describe("checkSignIn", () => {
  it("names a live sign-in and the account behind it", async () => {
    const id = await seed(ALICE);
    expect(await checkSignIn(db, ALICE, id)).toEqual({
      status: "live",
      signInId: id,
      account: {
        email: "alice@t.local",
        name: "Alice",
        role: "member",
        approval: "approved",
        deactivatedAt: null,
      },
    });
  });

  it("reads the account's approval in the same query (#249)", async () => {
    const id = await seed(ALICE);
    await pool.query(`UPDATE users SET approval = 'pending' WHERE id = $1`, [ALICE]);
    expect(await checkSignIn(db, ALICE, id)).toMatchObject({
      status: "live",
      account: { approval: "pending" },
    });
  });

  it("finds no user for an account that is gone", async () => {
    expect(await checkSignIn(db, NOBODY, await seed(ALICE))).toEqual({ status: "no-user" });
  });

  it.each([
    ["no claim", () => Promise.resolve(undefined)],
    ["a claim that is not a UUID", () => Promise.resolve("not-a-uuid")],
    ["a sign-in that never was", () => Promise.resolve(NOBODY)],
    ["another member's sign-in", () => seed(BEN)],
    ["one unused for longer than a cookie lives", () => seed(ALICE, "30 days 16 minutes")],
  ])("calls %s ended", async (_name, claim) => {
    await seed(ALICE);
    expect(await checkSignIn(db, ALICE, await claim())).toMatchObject({
      status: "ended",
      account: { email: "alice@t.local" },
    });
  });

  it("calls a deactivated account deactivated, whatever its sign-in (D-85-2)", async () => {
    const id = await seed(ALICE);
    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]);
    expect((await checkSignIn(db, ALICE, id)).status).toBe("deactivated");
    expect((await checkSignIn(db, ALICE, undefined)).status).toBe("deactivated");
  });

  it("writes nothing while the sign-in was used in the last 15 minutes", async () => {
    const id = await seed(ALICE, "14 minutes");
    const before = await lastUsed(id);
    await checkSignIn(db, ALICE, id);
    expect(await lastUsed(id)).toEqual(before);
  });

  it("records the use once it is older than that", async () => {
    const id = await seed(ALICE, "16 minutes");
    const before = await lastUsed(id);
    await checkSignIn(db, ALICE, id);
    const after = await lastUsed(id);
    expect(after?.getTime()).toBeGreaterThan((before?.getTime() ?? 0) + 15 * 60_000);
  });
});

describe("ending sign-ins", () => {
  it("signs out of one: the member's others carry on", async () => {
    const phone = await seed(ALICE);
    const laptop = await seed(ALICE);
    await endSignIn(db, ALICE, phone);
    expect((await rowsOf(ALICE)).map((row) => row.id)).toEqual([laptop]);
  });

  it("signs out of nothing for a claim that names no sign-in of theirs", async () => {
    const bens = await seed(BEN);
    await endSignIn(db, ALICE, bens);
    await endSignIn(db, ALICE, "not-a-uuid");
    await endSignIn(db, ALICE, undefined);
    expect((await rowsOf(BEN)).map((row) => row.id)).toEqual([bens]);
  });

  it("ends one for an admin, and says when it had already ended or is someone else's", async () => {
    const id = await seed(ALICE);
    const bens = await seed(BEN);
    await endOneSignIn(db, ALICE, id);
    expect(await rowsOf(ALICE)).toEqual([]);

    const notFound = { status: 404, message: "That sign-in has already ended." };
    await expect(endOneSignIn(db, ALICE, id)).rejects.toMatchObject(notFound);
    await expect(endOneSignIn(db, ALICE, bens)).rejects.toMatchObject(notFound);
    expect(await rowsOf(BEN)).toHaveLength(1);
  });

  it("ends all of a member's, but the one it is told to keep", async () => {
    const kept = await seed(ADMIN);
    await seed(ADMIN);
    await seed(ALICE);
    await seed(ALICE);
    await seed(BEN);

    await endAllSignIns(db, ALICE);
    await endAllSignIns(db, ADMIN, kept);
    expect(await rowsOf(ALICE)).toEqual([]);
    expect((await rowsOf(ADMIN)).map((row) => row.id)).toEqual([kept]);
    expect(await rowsOf(BEN)).toHaveLength(1);
  });

  it("ends every one when the member is deactivated, and reactivating brings none back", async () => {
    await seed(ALICE);
    await seed(ALICE);
    await seed(BEN);
    await updateUser(db, ALICE, { deactivated: true }, ADMIN);
    expect(await rowsOf(ALICE)).toEqual([]);
    await updateUser(db, ALICE, { deactivated: false }, ADMIN);
    expect(await rowsOf(ALICE)).toEqual([]);
    expect(await rowsOf(BEN)).toHaveLength(1);
  });

  it("ends none on a role change", async () => {
    await seed(ALICE);
    await updateUser(db, ALICE, { role: "admin" }, ADMIN);
    expect(await rowsOf(ALICE)).toHaveLength(1);
  });
});

describe("listSignIns", () => {
  it("lists the live ones, most recently used first, naming the caller's own and each device", async () => {
    const older = await seed(ALICE, "2 hours", IPHONE);
    const newer = await seed(ALICE, "1 minute", PIXEL);
    await seed(ALICE, "31 days", PIXEL);
    await seed(BEN);

    const listed = await listSignIns(db, ALICE, older);
    expect(listed.map(({ id, device, current }) => ({ id, device, current }))).toEqual([
      { id: newer, device: "Chrome on Android", current: false },
      { id: older, device: "Safari on iPhone", current: true },
    ]);
    expect(listed[0]?.signedInAt).toBeInstanceOf(Date);
    expect(listed[0]?.lastUsedAt).toBeInstanceOf(Date);
  });
});

/*
 * Starting a sign-in and deactivating the account can run at once. Each
 * order is held with a lock from a second connection, so the interleaving is
 * forced rather than hoped for (as D-132-8).
 */
describe("a sign-in and a deactivation at once", () => {
  const POLL_BUDGET_MS = 4_000;

  async function waitingOn(pattern: string): Promise<void> {
    const startedAt = Date.now();
    for (;;) {
      const { rows } = await controller.query(
        `SELECT 1 FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database()
           AND pid <> pg_backend_pid() AND query ILIKE $1`,
        [pattern],
      );
      if (rows.length > 0) return;
      if (Date.now() - startedAt > POLL_BUDGET_MS) {
        throw new Error(`nothing waited on ${pattern}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const settle = (work: Promise<unknown>) =>
    work.then(
      (value) => ({ ok: value }),
      (error: unknown) => ({ error }),
    );

  it("refuses a sign-in that waited for the deactivation, and writes nothing", async () => {
    const client = await controller.connect();
    let signingIn: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [ALICE]);
      signingIn = settle(startSignIn(db, ALICE, PIXEL));
      await waitingOn(`%from "users"%for share%`);
      await client.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    expect(await signingIn).toEqual({ ok: null });
    expect(await rowsOf(ALICE)).toEqual([]);
  });

  it("holds the deactivation until a sign-in that took the account first lands, then ends it", async () => {
    // An expired row held here parks the sign-in after it has taken Alice's row.
    const expired = await seed(ALICE, "40 days");
    const client = await controller.connect();
    let signingIn: Promise<unknown> | undefined;
    let deactivating: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT 1 FROM sign_ins WHERE id = $1 FOR UPDATE`, [expired]);
      signingIn = settle(startSignIn(db, ALICE, PIXEL));
      await waitingOn(`%delete from "sign_ins"%`);
      deactivating = settle(updateUser(db, ALICE, { deactivated: true }, ADMIN));
      await waitingOn(`%from "users"%for no key update%`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await Promise.all([signingIn, deactivating]);
    }

    expect(await signingIn).toMatchObject({ ok: expect.any(String) as string });
    expect(await deactivating).toMatchObject({ ok: { id: ALICE } });
    // The sign-in that landed first is ended with the rest.
    expect(await rowsOf(ALICE)).toEqual([]);
  });
});
