import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import type { Clock } from "@/lib/clock";
import { RETENTION_PERIODS } from "@/lib/privacy/policy";
import { EXPIRES_AFTER_SECONDS } from "@/server/auth/sign-ins";
import { unblockUser } from "@/server/users/service";
import { assertRecordedAfterErasure, createVisit } from "@/server/visits/service";
import { syncVisits } from "@/server/visits/sync";
import { MAX_ERASURES_PER_RUN, runRetention } from "@/server/privacy/retention";

/*
 * The retention job (#279), driven with a fixed clock so each period is
 * judged on both sides of its boundary.
 */

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;
/* Its own connection: the pool's two are the held lock and the job. */
const watcher = createTestPool();

const ADMIN = "27927901-0000-4000-8000-000000000001";
const ALICE = "27927901-0000-4000-8000-000000000002";
const BLOCK = "27927901-0000-4000-8001-000000000001";
const SESSION = "27927901-0000-4000-8002-000000000001";
const H1 = "27927901-0000-4000-8003-000000000001";
const H2 = "27927901-0000-4000-8003-000000000002";

const NOW = new Date("2026-11-25T18:00:00.000Z");
const clock: Clock = { now: NOW, toleranceMs: 0 };
const HOUSEHOLD_CUTOFF = new Date("2024-11-25T18:00:00.000Z");
const ACCOUNT_CUTOFF = new Date("2025-11-25T18:00:00.000Z");
const ms = (date: Date, delta: number) => new Date(date.getTime() + delta);

/* Until some statement is blocked on a lock, so a test never changes things before the job is parked. */
async function untilBlocked(): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const { rows } = await watcher.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`,
    );
    if (rows.length > 0) return;
    if (Date.now() - startedAt > 10_000) throw new Error("nothing waited on a lock");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const count = async (table: string, where = "true"): Promise<number> =>
  Number(
    (await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)).rows[0]
      ?.n,
  );
const erased = async (id: string): Promise<boolean> =>
  (await pool.query(`SELECT 1 FROM households WHERE id = $1 AND erased_at IS NOT NULL`, [id]))
    .rowCount === 1;

const visitAt = (id: string, household: string, at: Date) =>
  pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, description,
                         client_created_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'low','Notes',$5,$5,$5)`,
    [id, household, SESSION, ALICE, at],
  );
const household = (id: string, unit: string, name: string | null = "Mr Tan") =>
  pool.query(
    `INSERT INTO households (id, block_id, unit_number, name, created_at) VALUES ($1,$2,$3,$4,$5)`,
    [id, BLOCK, unit, name, new Date("2020-01-01T00:00:00Z")],
  );
const note = (household: string, columns: Record<string, Date>) => {
  const old = new Date("2020-01-01T00:00:00Z");
  const all: Record<string, Date> = { created_at: old, updated_at: old, ...columns };
  const names = Object.keys(all);
  const marks = names.map((_, i) => `$${String(i + 3)}`).join(", ");
  return pool.query(
    `INSERT INTO follow_ups (household_id, author_id, note, status, ${names.join(", ")})
     VALUES ($1,$2,'Bring the flyer','listed', ${marks})`,
    [household, ADMIN, ...Object.values(all)],
  );
};

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Old','ended',$2)`,
    [SESSION, ADMIN],
  );
});

afterAll(async () => {
  await watcher.end();
  await pool.end();
});

describe("the periods", () => {
  it("are the policy's", () => {
    expect(RETENTION_PERIODS).toEqual({
      householdMonths: 24,
      accountMonths: 12,
      signInDays: 30,
      unsentRecordDays: 30,
    });
    // D-125-7's bound: a sign-in's cookie lives 30 days, and last use is written every 15 minutes.
    expect(EXPIRES_AFTER_SECONDS).toBe(RETENTION_PERIODS.signInDays * 86_400 + 15 * 60);
  });
});

describe("households", () => {
  it("erases one whose last visit is more than 24 months old, and not at the boundary", async () => {
    await household(H1, "#01-01");
    await household(H2, "#01-02");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, ms(HOUSEHOLD_CUTOFF, -1));
    await visitAt("01960000-0000-7000-8279-000000000002", H2, HOUSEHOLD_CUTOFF);

    const run = await runRetention(db, clock);

    expect(run).toMatchObject({ households: 1, accounts: 0, signIns: 0, more: false });
    expect(await erased(H1)).toBe(true);
    expect(await erased(H2)).toBe(false);
    expect(await count("visits", `household_id = '${H1}'`)).toBe(0);
  });

  it("reads the newest visit, so one recent visit keeps the older ones", async () => {
    await household(H1, "#01-01");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));
    await visitAt("01960000-0000-7000-8279-000000000002", H1, ms(NOW, -86_400_000));
    expect((await runRetention(db, clock)).households).toBe(0);
    expect(await count("visits")).toBe(2);
  });

  it.each(["created_at", "updated_at", "listed_at", "done_at", "deleted_at"])(
    "restarts the clock when a follow-up note's %s is recent",
    async (column) => {
      await household(H1, "#01-01");
      await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));
      await note(H1, { [column]: ms(HOUSEHOLD_CUTOFF, 1) });
      expect((await runRetention(db, clock)).households).toBe(0);
    },
  );

  it("erases one whose follow-up notes are old as well, removed ones included", async () => {
    await household(H1, "#01-01");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));
    await note(H1, { deleted_at: ms(HOUSEHOLD_CUTOFF, -1) });
    expect((await runRetention(db, clock)).households).toBe(1);
    expect(await count("follow_ups")).toBe(0);
  });

  it("dates a unit with an identity and nothing else by when it was made", async () => {
    await household(H1, "#01-01");
    expect((await runRetention(db, clock)).households).toBe(1);
  });

  it("never erases a unit that holds nothing, and so never twice", async () => {
    await household(H1, "#01-01", null);
    await household(H2, "#01-02");
    await visitAt("01960000-0000-7000-8279-000000000001", H2, new Date("2020-01-01T00:00:00Z"));

    expect((await runRetention(db, clock)).households).toBe(1);
    expect(await erased(H1)).toBe(false);

    const again = await runRetention(db, { now: ms(NOW, 3_600_000 * 2), toleranceMs: 0 });
    expect(again).toMatchObject({ households: 0, accounts: 0, signIns: 0 });
  });

  it("erases a unit that holds only a visit, or only a note, with no identity", async () => {
    await household(H1, "#01-01", null);
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));
    await household(H2, "#01-02", null);
    await note(H2, {});
    expect((await runRetention(db, clock)).households).toBe(2);
    expect(await erased(H1)).toBe(true);
    expect(await erased(H2)).toBe(true);
    expect(await count("visits")).toBe(0);
    expect(await count("follow_ups")).toBe(0);
  });

  it("carries out the household's open request, by nobody", async () => {
    await household(H1, "#01-01");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));
    await pool.query(
      `INSERT INTO erasure_requests (household_id, requested_at, logged_by) VALUES ($1,$2,$3)`,
      [H1, new Date("2026-11-20T00:00:00Z"), ALICE],
    );
    await runRetention(db, clock);
    expect((await pool.query(`SELECT erased_at, erased_by FROM erasure_requests`)).rows[0]).toEqual(
      { erased_at: NOW, erased_by: null },
    );
  });

  it("erases at most a run's worth, oldest first, and says there is more", async () => {
    await pool.query(
      `INSERT INTO households (block_id, unit_number, name, created_at)
       SELECT $1, '#' || g, 'Name ' || g, $2::timestamptz + g * interval '1 minute'
         FROM generate_series(1, $3::int) g`,
      [BLOCK, new Date("2020-01-01T00:00:00Z"), MAX_ERASURES_PER_RUN + 1],
    );

    const first = await runRetention(db, clock);
    expect(first).toMatchObject({ households: MAX_ERASURES_PER_RUN, more: true });
    // The newest is the one left.
    expect(await count("households", `name IS NOT NULL`)).toBe(1);

    const second = await runRetention(db, { now: ms(NOW, 2 * 3_600_000), toleranceMs: 0 });
    expect(second).toMatchObject({ households: 1, more: false });
  });
});

describe("accounts", () => {
  const user = (
    email: string,
    approval: string,
    columns: { deactivated?: Date; updated?: Date; created?: Date },
  ) =>
    pool.query(
      `INSERT INTO users (email, name, role, approval, deactivated_at, updated_at, created_at)
       VALUES ($1,$1,'member',$2,$3,$4,$5)`,
      [
        email,
        approval,
        columns.deactivated ?? null,
        columns.updated ?? columns.created ?? NOW,
        columns.created ?? NOW,
      ],
    );
  const left = async (email: string): Promise<boolean> =>
    (await pool.query(`SELECT 1 FROM users WHERE name = $1`, [email])).rowCount === 0;

  it("erases a deactivated member 12 months after leaving, and not at the boundary", async () => {
    await user("gone@t.local", "approved", { deactivated: ms(ACCOUNT_CUTOFF, -1) });
    await user("edge@t.local", "approved", { deactivated: ACCOUNT_CUTOFF });
    await user("recent@t.local", "approved", { deactivated: ms(NOW, -1000) });
    // An active member is never due, however old the account.
    await user("active@t.local", "approved", { created: new Date("2020-01-01T00:00:00Z") });

    expect((await runRetention(db, clock)).accounts).toBe(1);
    expect(await left("gone@t.local")).toBe(true);
    expect(await left("edge@t.local")).toBe(false);
    expect(await left("active@t.local")).toBe(false);
    expect(await count("users", `erased_at IS NOT NULL`)).toBe(1);
  });

  it("erases a turned-down request 12 months after it was turned down", async () => {
    await user("no@t.local", "blocked", { updated: ms(ACCOUNT_CUTOFF, -1) });
    await user("recent@t.local", "blocked", { updated: ACCOUNT_CUTOFF });
    expect((await runRetention(db, clock)).accounts).toBe(1);
  });

  it("erases a request nobody answered 12 months after it was made", async () => {
    await user("ask@t.local", "pending", { created: ms(ACCOUNT_CUTOFF, -1) });
    await user("new@t.local", "pending", { created: ACCOUNT_CUTOFF });
    expect((await runRetention(db, clock)).accounts).toBe(1);
    // Never marked as deactivated: the table's check forbids it for these.
    expect(await count("users", `erased_at IS NOT NULL AND deactivated_at IS NULL`)).toBe(1);
  });

  it("starts a turned-down request's 12 months over when an admin unblocks it", async () => {
    // Made and turned down long before the cutoff.
    await user("back@t.local", "blocked", {
      created: new Date("2025-10-01T00:00:00Z"),
      updated: new Date("2025-12-01T00:00:00Z"),
    });
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'back@t.local'`,
    );
    await unblockUser(db, rows[0]?.id ?? "");

    expect((await runRetention(db, clock)).accounts).toBe(0);
    expect(await left("back@t.local")).toBe(false);
  });

  it("keeps a waiting sign-up's 12 months from when it was made, however often its name is saved", async () => {
    // Made long ago and saved lately: updated_at moves on any save, reopened_at does not.
    await user("ask@t.local", "pending", { created: ms(ACCOUNT_CUTOFF, -1), updated: NOW });
    expect((await runRetention(db, clock)).accounts).toBe(1);
  });

  it("carries out the account's open request, by nobody", async () => {
    await user("gone@t.local", "approved", { deactivated: ms(ACCOUNT_CUTOFF, -1) });
    await pool.query(
      `INSERT INTO erasure_requests (user_id, requested_at, logged_by)
       SELECT id, $1, $2 FROM users WHERE email = 'gone@t.local'`,
      [new Date("2026-11-20T00:00:00Z"), ALICE],
    );
    await runRetention(db, clock);
    expect((await pool.query(`SELECT erased_at, erased_by FROM erasure_requests`)).rows[0]).toEqual(
      { erased_at: NOW, erased_by: null },
    );
  });

  it("deletes the sign-ins of an erased account, and leaves another's", async () => {
    await user("gone@t.local", "approved", { deactivated: ms(ACCOUNT_CUTOFF, -1) });
    await pool.query(
      `INSERT INTO sign_ins (user_id, last_used_at) SELECT id, $1 FROM users WHERE email = 'gone@t.local'`,
      [NOW],
    );
    await runRetention(db, clock);
    expect(await count("sign_ins")).toBe(0);
  });

  it("does not swallow a failure that is not an account erased meanwhile", async () => {
    await user("gone@t.local", "approved", { deactivated: ms(ACCOUNT_CUTOFF, -1) });
    const failure = new Error("connection reset");
    // The lease and the lists are real; only the transaction that erases an account fails.
    const broken = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") return () => Promise.reject(failure);
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    await expect(runRetention(broken, clock)).rejects.toBe(failure);
    expect(await count("users", `erased_at IS NOT NULL`)).toBe(0);
  });

  /* An admin's change that lands while the job waits on the account's lock. */
  const changedWhileParked = async (email: string, change: string) => {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      email,
    ]);
    const target = rows[0]?.id ?? "";
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [target]);
      const run = runRetention(db, clock);
      await untilBlocked();
      await holder.query(change, [target, NOW]);
      await holder.query("COMMIT");
      return (await run).accounts;
    } finally {
      holder.release();
    }
  };

  it("is spared when an admin reactivated the member while the job waited on its lock", async () => {
    await user("gone@t.local", "approved", { deactivated: ms(ACCOUNT_CUTOFF, -1) });
    const erasedCount = await changedWhileParked(
      "gone@t.local",
      `UPDATE users SET deactivated_at = NULL, updated_at = $2 WHERE id = $1`,
    );
    expect(erasedCount).toBe(0);
    expect(await left("gone@t.local")).toBe(false);
    expect(await count("users", `erased_at IS NOT NULL`)).toBe(0);
  });

  it("is spared when an admin approved the request while the job waited on its lock", async () => {
    await user("ask@t.local", "pending", { created: ms(ACCOUNT_CUTOFF, -1) });
    const erasedCount = await changedWhileParked(
      "ask@t.local",
      `UPDATE users SET approval = 'approved', updated_at = $2 WHERE id = $1`,
    );
    expect(erasedCount).toBe(0);
    expect(await count("users", `erased_at IS NOT NULL`)).toBe(0);
  });

  it("skips an account an admin erased between the list and its lock", async () => {
    await user("gone@t.local", "approved", { deactivated: ms(ACCOUNT_CUTOFF, -1) });
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'gone@t.local'`,
    );
    const target = rows[0]?.id ?? "";

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [target]);
      const run = runRetention(db, clock);
      await untilBlocked();
      await holder.query(`UPDATE users SET erased_at = now() WHERE id = $1`, [target]);
      await holder.query("COMMIT");
      expect((await run).accounts).toBe(0);
    } finally {
      holder.release();
    }
  });
});

describe("sign-ins", () => {
  it("deletes one 30 days and 15 minutes after its last use, and not before", async () => {
    const boundary = ms(NOW, -EXPIRES_AFTER_SECONDS * 1000);
    await pool.query(`INSERT INTO sign_ins (user_id, last_used_at) VALUES ($1,$2), ($1,$3)`, [
      ALICE,
      ms(boundary, -1),
      boundary,
    ]);
    expect((await runRetention(db, clock)).signIns).toBe(1);
    expect(await count("sign_ins")).toBe(1);
  });
});

describe("a household recorded at while the job ran", () => {
  it("is spared when its lock was held by a visit that finished first", async () => {
    await household(H1, "#01-01");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM households WHERE id = $1 FOR UPDATE`, [H1]);
      const run = runRetention(db, clock);
      await untilBlocked();
      await holder.query(
        `INSERT INTO visits (id, household_id, session_id, member_id, interest_level,
                             client_created_at, created_at, updated_at)
         VALUES ('01960000-0000-7000-8279-000000000009',$1,$2,$3,'low',$4,$4,$4)`,
        [H1, SESSION, ALICE, NOW],
      );
      await holder.query("COMMIT");
      expect((await run).households).toBe(0);
    } finally {
      holder.release();
    }
    expect(await erased(H1)).toBe(false);
    expect(await count("visits", `household_id = '${H1}'`)).toBe(2);
  });
});

describe("what a retention erasure refuses afterwards", () => {
  const erasedAtOf = async (id: string): Promise<Date> => {
    const row = (
      await pool.query<{ erased_at: Date }>(`SELECT erased_at FROM households WHERE id = $1`, [id])
    ).rows[0];
    if (!row) throw new Error("no such household");
    return row.erased_at;
  };

  it("is dated at the cutoff, so a record saved since then and synced late is kept", async () => {
    await household(H1, "#01-01");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));
    await runRetention(db, clock);

    const erasedAt = await erasedAtOf(H1);
    expect(erasedAt).toEqual(HOUSEHOLD_CUTOFF);
    // Saved ten days ago, synced after the run: new fieldwork.
    expect(() => {
      assertRecordedAfterErasure({ erasedAt }, ms(NOW, -10 * 86_400_000));
    }).not.toThrow();
    expect(() => {
      assertRecordedAfterErasure({ erasedAt }, ms(HOUSEHOLD_CUTOFF, -1));
    }).toThrow(/erased/);
  });

  describe("with a request open when the job meets the household", () => {
    const OLD_VISIT = "01960000-0000-7000-8279-000000000001";
    const SAVED = ms(NOW, -10 * 86_400_000);

    beforeEach(async () => {
      await household(H1, "#01-01");
      await visitAt(OLD_VISIT, H1, new Date("2020-01-01T00:00:00Z"));
      await pool.query(
        `UPDATE outing_sessions SET status = 'active', started_at = $2 WHERE id = $1`,
        [SESSION, new Date("2020-01-01T00:00:00Z")],
      );
      await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
        SESSION,
        BLOCK,
      ]);
      await pool.query(
        `INSERT INTO erasure_requests (household_id, requested_at, logged_by) VALUES ($1,$2,$3)`,
        [H1, new Date("2026-11-20T00:00:00Z"), ADMIN],
      );
      await runRetention(db, clock);
    });

    const item = {
      id: "01960000-0000-7000-8279-000000000002",
      blockId: BLOCK,
      unitNumber: "#01-01",
      interestLevel: "high" as const,
      name: "Mr Tan",
      clientCreatedAt: SAVED.toISOString(),
      updatedAt: SAVED.toISOString(),
    };

    it("is dated at the run, not the cutoff", async () => {
      expect(await erasedAtOf(H1)).toEqual(NOW);
    });

    it("refuses an offline knock saved before the run and synced after it", async () => {
      const [outcome] = await syncVisits(db, [item], { id: ALICE, role: "member" }, clock);
      expect(outcome).toMatchObject({ status: "rejected", error: { code: "household_erased" } });
      expect(await count("visits", `household_id = '${H1}'`)).toBe(0);
    });

    it("refuses the same knock sent on its own", async () => {
      await expect(
        createVisit(db, { ...item, memberId: ALICE, clientCreatedAt: SAVED.toISOString() }, clock, {
          role: "member",
        }),
      ).rejects.toMatchObject({ code: "household_erased" });
    });
  });

  it("never moves an earlier on-request erasure backward", async () => {
    await household(H1, "#01-01");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));
    const earlier = new Date("2026-11-01T00:00:00Z");
    await pool.query(`UPDATE households SET erased_at = $2 WHERE id = $1`, [H1, earlier]);
    await runRetention(db, clock);
    expect(await erasedAtOf(H1)).toEqual(earlier);
  });

  it("skips a unit an on-request erasure emptied between the list and its lock", async () => {
    await household(H1, "#01-01");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM households WHERE id = $1 FOR UPDATE`, [H1]);
      const run = runRetention(db, clock);
      await untilBlocked();
      await holder.query(`DELETE FROM visits WHERE household_id = $1`, [H1]);
      await holder.query(`UPDATE households SET name = NULL, erased_at = $2 WHERE id = $1`, [
        H1,
        ms(NOW, -1000),
      ]);
      await holder.query("COMMIT");
      expect((await run).households).toBe(0);
    } finally {
      holder.release();
    }
  });
});

describe("the run", () => {
  it("is kept with what it did, and a second at once is refused", async () => {
    await household(H1, "#01-01");
    await runRetention(db, clock);
    expect(
      (
        await pool.query(
          `SELECT households, accounts, sign_ins, more, finished_at FROM retention_runs`,
        )
      ).rows,
    ).toEqual([{ households: 1, accounts: 0, sign_ins: 0, more: false, finished_at: NOW }]);

    await pool.query(`INSERT INTO retention_runs (started_at) VALUES ($1)`, [ms(NOW, -60_000)]);
    await expect(runRetention(db, clock)).rejects.toMatchObject({ status: 409 });
  });

  it("takes over a run that never finished, an hour on", async () => {
    await pool.query(`INSERT INTO retention_runs (started_at) VALUES ($1)`, [ms(NOW, -3_600_001)]);
    await expect(runRetention(db, clock)).resolves.toMatchObject({ households: 0 });
    expect(await count("retention_runs", `finished_at IS NULL`)).toBe(0);
  });

  it("finishes its row, with the counts so far, when it fails part way", async () => {
    await household(H1, "#01-01");
    await visitAt("01960000-0000-7000-8279-000000000001", H1, new Date("2020-01-01T00:00:00Z"));
    // A failure after the lease is taken, when the job first reads a list.
    const broken = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "select") {
          return () => {
            throw new Error("boom");
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    await expect(runRetention(broken, clock)).rejects.toThrow("boom");
    expect(await count("retention_runs", `finished_at IS NULL`)).toBe(0);
  });
});
