import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { eraseHousehold } from "@/server/privacy/erasure";
import { eraseRequest } from "@/server/privacy/requests";
import { updateOwnName } from "@/server/users/service";
import { syncVisits } from "@/server/visits/sync";
import { getVisit, updateVisit } from "@/server/visits/service";

/*
 * Erasure against writes that are already waiting on the household, as
 * D-123-7 and D-132-8 park locks: whichever is second reads what the first
 * committed, and nothing is left half erased.
 */

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;
/* Its own connection: the pool's two are the held lock and the waiting write. */
const watcher = createTestPool();

const ADMIN = "27927903-0000-4000-8000-000000000001";
const ALICE = "27927903-0000-4000-8000-000000000002";
const BLOCK = "27927903-0000-4000-8001-000000000001";
const SESSION = "27927903-0000-4000-8002-000000000001";
const HOUSEHOLD = "27927903-0000-4000-8003-000000000001";
const VISIT = "01960000-0000-7000-8279-000000000031";
const NEW_VISIT = "01960000-0000-7000-8279-000000000032";

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const count = async (table: string): Promise<number> =>
  Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at)
     VALUES ($1,'Live','active',$2,'2020-01-01T00:00:00Z')`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number, name) VALUES ($1,$2,'#05-123','Mr Tan')`,
    [HOUSEHOLD, BLOCK],
  );
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, description)
     VALUES ($1,$2,$3,$4,'low','Notes')`,
    [VISIT, HOUSEHOLD, SESSION, ALICE],
  );
});

afterAll(async () => {
  await watcher.end();
  await pool.end();
});

describe("a write waiting behind an erasure", () => {
  it("is refused by a sync run, which writes nothing", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM households WHERE id = $1 FOR UPDATE`, [HOUSEHOLD]);

      const knockedAt = new Date(Date.now() - 60_000).toISOString();
      const run = syncVisits(
        db,
        [
          {
            id: NEW_VISIT,
            blockId: BLOCK,
            unitNumber: "#05-123",
            interestLevel: "high",
            clientCreatedAt: knockedAt,
            updatedAt: knockedAt,
            name: "Mr Tan",
          },
        ],
        { id: ALICE, role: "member" },
        { now: new Date(), toleranceMs: 300_000 },
      );
      await settle();
      await holder.query(`DELETE FROM visits WHERE household_id = $1`, [HOUSEHOLD]);
      await holder.query(`UPDATE households SET name = NULL, erased_at = now() WHERE id = $1`, [
        HOUSEHOLD,
      ]);
      await holder.query("COMMIT");

      const [outcome] = await run;
      expect(outcome).toMatchObject({ status: "rejected", error: { code: "household_erased" } });
    } finally {
      // Destroyed, not pooled: on a failed wait its transaction still holds the row.
      holder.release(true);
    }
    expect(await count("visits")).toBe(0);
    expect(
      (
        await pool.query<{ name: string | null }>(`SELECT name FROM households WHERE id = $1`, [
          HOUSEHOLD,
        ])
      ).rows[0]?.name,
    ).toBeNull();
  });

  it("answers an amend with not found, not a server error", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM households WHERE id = $1 FOR UPDATE`, [HOUSEHOLD]);
      const amend = updateVisit(
        db,
        VISIT,
        { description: "Changed" },
        { id: ALICE, role: "member" },
      );
      const outcome = amend.then(
        () => "amended",
        (error: unknown) => (error as { status: number }).status,
      );
      await settle();
      await holder.query(`DELETE FROM visits WHERE household_id = $1`, [HOUSEHOLD]);
      await holder.query("COMMIT");
      expect(await outcome).toBe(404);
    } finally {
      holder.release(true);
    }
  });
});

describe("an erasure waiting behind a write", () => {
  it("deletes the visit that write stored", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
         VALUES ($1,$2,$3,$4,'high')`,
        [NEW_VISIT, HOUSEHOLD, SESSION, ALICE],
      );
      const erasure = db.transaction((tx) => eraseHousehold(tx, HOUSEHOLD, new Date()));
      await settle();
      await holder.query("COMMIT");
      await erasure;
    } finally {
      holder.release(true);
    }
    expect(await count("visits")).toBe(0);
  });

  it("says no such household for one that is not there", async () => {
    await expect(
      db.transaction((tx) =>
        eraseHousehold(tx, "27927903-0000-4000-8003-0000000000ff", new Date()),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("two admins carrying out one request", () => {
  it("lets the first through and tells the second it was already done, erasing nothing twice", async () => {
    const request = "27927903-0000-4000-8005-000000000001";
    await pool.query(
      `INSERT INTO erasure_requests (id, household_id, requested_at, logged_by) VALUES ($1,$2,now(),$3)`,
      [request, HOUSEHOLD, ALICE],
    );
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM households WHERE id = $1 FOR UPDATE`, [HOUSEHOLD]);
      const second = eraseRequest(db, request, { id: ADMIN, role: "admin" }, new Date()).then(
        () => "erased",
        (error: unknown) => (error as { status: number }).status,
      );
      await settle();
      // The first admin's erasure lands while the second waits on the household.
      await holder.query(
        `UPDATE erasure_requests SET erased_at = now(), erased_by = $2 WHERE id = $1`,
        [request, ADMIN],
      );
      await holder.query("COMMIT");
      expect(await second).toBe(409);
    } finally {
      holder.release(true);
    }
    // The second's own erasure was rolled back with its refusal.
    expect(await count("visits")).toBe(1);
  });
});

describe("a visit read back after an erasure", () => {
  it("is not found, not a server error", async () => {
    await pool.query(`DELETE FROM visits WHERE id = $1`, [VISIT]);
    await expect(getVisit(db, VISIT)).rejects.toMatchObject({ status: 404 });
  });
});

describe("a rename waiting behind an account erasure", () => {
  it("is refused, and the erased account keeps no name", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [ALICE]);
      const rename = updateOwnName(db, ALICE, "Alice B").then(
        () => null,
        (error: unknown) => error,
      );
      const startedAt = Date.now();
      for (;;) {
        const { rows } = await watcher.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`,
        );
        if (rows.length > 0) break;
        if (Date.now() - startedAt > 10_000) throw new Error("the rename never waited");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await holder.query(
        `UPDATE users SET name = NULL, email = 'erased@erased.invalid', erased_at = now() WHERE id = $1`,
        [ALICE],
      );
      await holder.query("COMMIT");

      expect(await rename).toMatchObject({ message: "Your account no longer exists." });
      const { rows } = await pool.query<{ name: string | null }>(
        `SELECT name FROM users WHERE id = $1`,
        [ALICE],
      );
      expect(rows[0]?.name).toBeNull();
    } finally {
      holder.release(true);
    }
  });
});
