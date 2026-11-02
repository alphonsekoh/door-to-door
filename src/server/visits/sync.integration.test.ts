import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import type { Clock } from "@/lib/clock";
import { syncVisits, type SyncItem } from "@/server/visits/sync";

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "efefefef-0000-4000-8000-000000000001";
const ALICE = "efefefef-0000-4000-8000-000000000002";
const BEN = "efefefef-0000-4000-8000-000000000003";
const BLOCK = "efefefef-0000-4000-8001-000000000001";
const LOOSE_BLOCK = "efefefef-0000-4000-8001-000000000002";
const SESSION = "efefefef-0000-4000-8002-000000000001";

const VISIT_A = "01960000-0000-7000-8000-00000000aaa1";
const VISIT_B = "01960000-0000-7000-8000-00000000aaa2";

const T1 = "2026-03-14T10:00:00.000Z";
const T2 = "2026-03-14T11:00:00.000Z";

const item = (overrides: Partial<SyncItem> = {}): SyncItem => ({
  id: VISIT_A,
  blockId: BLOCK,
  unitNumber: "#05-123",
  interestLevel: "low",
  clientCreatedAt: T1,
  updatedAt: T1,
  ...overrides,
});

const NOW = new Date("2026-03-14T12:00:00.000Z");
const TOLERANCE_MS = 300_000;
const clock: Clock = { now: NOW, toleranceMs: TOLERANCE_MS };
const offset = (ms: number, base = NOW) => new Date(base.getTime() + ms).toISOString();

const flush = (items: SyncItem[], memberId = ALICE, withClock: Clock = clock) =>
  syncVisits(db, items, { id: memberId, role: "member" }, withClock);

const countVisits = async (): Promise<number> => {
  const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM visits`);
  return Number(rows[0]?.count ?? "0");
};

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'), ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave'), ($2,'999','Elsewhere')`,
    [BLOCK, LOOSE_BLOCK],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at) VALUES ($1,'Outing','active',$2,$3)`,
    [SESSION, ADMIN, new Date("2026-03-14T08:00:00.000Z")],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe("replaying is safe", () => {
  it("applies a queued record", async () => {
    const [result] = await flush([item()]);
    expect(result?.status).toBe("applied");
    expect(await countVisits()).toBe(1);
  });

  it("reports a replay as unchanged, leaving one row", async () => {
    /*
     * The failure this endpoint exists to prevent: a request that timed out
     * was in fact applied, and the client sends it again.
     */
    await flush([item()]);
    const [replayed] = await flush([item()]);

    expect(replayed?.status).toBe("unchanged");
    expect(await countVisits()).toBe(1);
  });

  it("survives the same batch sent three times", async () => {
    const batch = [item(), item({ id: VISIT_B, unitNumber: "#06-201" })];
    await flush(batch);
    await flush(batch);
    const third = await flush(batch);

    expect(third.map((r) => r.status)).toEqual(["unchanged", "unchanged"]);
    expect(await countVisits()).toBe(2);
  });

  it("returns the stored visit alongside an unchanged result", async () => {
    // The client reconciles against canonical server state.
    await flush([item()]);
    const [replayed] = await flush([item()]);
    expect(replayed?.visit?.id).toBe(VISIT_A);
  });
});

describe("conflicts resolve last-write-wins", () => {
  it("applies a newer edit over an older one", async () => {
    await flush([item({ interestLevel: "low", updatedAt: T1 })]);
    const [result] = await flush([item({ interestLevel: "high", updatedAt: T2 })]);

    expect(result?.status).toBe("applied");
    expect(result?.visit?.interestLevel).toBe("high");
  });

  it("acknowledges an older edit as stale without applying it", async () => {
    /*
     * Acknowledged, not rejected: the client should drop it from the queue
     * rather than retry forever, but the newer value must survive.
     */
    await flush([item({ interestLevel: "high", updatedAt: T2 })]);
    const [result] = await flush([item({ interestLevel: "low", updatedAt: T1 })]);

    expect(result?.status).toBe("stale");
    expect(result?.visit?.interestLevel).toBe("high");
  });

  it("converges regardless of arrival order", async () => {
    await flush([item({ interestLevel: "low", updatedAt: T1 })]);
    await flush([item({ interestLevel: "high", updatedAt: T2 })]);
    const forwards = await flush([item({ updatedAt: T2, interestLevel: "high" })]);

    await pool.query(`DELETE FROM visits`);
    await flush([item({ interestLevel: "high", updatedAt: T2 })]);
    await flush([item({ interestLevel: "low", updatedAt: T1 })]);
    const backwards = await flush([item({ updatedAt: T2, interestLevel: "high" })]);

    // Both orders end on the newer value.
    expect(forwards[0]?.visit?.interestLevel).toBe("high");
    expect(backwards[0]?.visit?.interestLevel).toBe("high");
  });

  it("refuses to overwrite another member's visit", async () => {
    await flush([item()], ALICE);
    const [result] = await flush([item({ interestLevel: "high", updatedAt: T2 })], BEN);
    expect(result?.status).toBe("rejected");
    expect(result?.error?.code).toBe("conflict");
  });
});

describe("partial success", () => {
  it("saves the valid items when one is bad", async () => {
    /*
     * A member whose queue holds one malformed record should still get the
     * rest of their afternoon saved.
     */
    const results = await flush([
      item(),
      item({ id: VISIT_B, blockId: "efefefef-0000-4000-8001-00000000ffff" }),
    ]);

    expect(results.map((r) => r.status)).toEqual(["applied", "rejected"]);
    expect(await countVisits()).toBe(1);
  });

  it("returns results in request order, so the client can match them up", async () => {
    const results = await flush([
      item({ id: VISIT_B, unitNumber: "#06-201" }),
      item({ id: VISIT_A }),
    ]);
    expect(results.map((r) => r.id)).toEqual([VISIT_B, VISIT_A]);
  });

  it("explains why an item was rejected", async () => {
    const [result] = await flush([item({ blockId: "efefefef-0000-4000-8001-00000000ffff" })]);
    expect(result?.error?.code).toBe("not_found");
    expect(result?.visit).toBeNull();
  });
});

describe("sessions", () => {
  it("attaches to the active session when none is named", async () => {
    const [result] = await flush([item()]);
    expect(result?.visit?.sessionId).toBe(SESSION);
  });

  it("accepts an explicitly named active session", async () => {
    const [result] = await flush([item({ sessionId: SESSION })]);
    expect(result?.status).toBe("applied");
  });

  it("rejects a queue that outlived its session, with a distinct code", async () => {
    // The client can then say "ask an admin to reopen it" rather than
    // discarding work already done at a door.
    await pool.query(`UPDATE outing_sessions SET status='ended' WHERE id=$1`, [SESSION]);
    const [result] = await flush([item({ sessionId: SESSION })]);

    expect(result?.status).toBe("rejected");
    expect(result?.error?.code).toBe("session_not_active");
  });

  it("lets the queue through once an admin reopens the session", async () => {
    await pool.query(`UPDATE outing_sessions SET status='ended' WHERE id=$1`, [SESSION]);
    expect((await flush([item({ sessionId: SESSION })]))[0]?.status).toBe("rejected");

    await pool.query(`UPDATE outing_sessions SET status='active' WHERE id=$1`, [SESSION]);
    expect((await flush([item({ sessionId: SESSION })]))[0]?.status).toBe("applied");
  });

  it("rejects when no session is active at all", async () => {
    await pool.query(`UPDATE outing_sessions SET status='ended' WHERE id=$1`, [SESSION]);
    const [result] = await flush([item()]);
    expect(result?.error?.code).toBe("session_not_active");
  });

  it("rejects an unknown session", async () => {
    const [result] = await flush([item({ sessionId: "efefefef-0000-4000-8002-00000000ffff" })]);
    expect(result?.error?.code).toBe("not_found");
  });

  it("rejects a block that is not part of the session", async () => {
    const [result] = await flush([item({ blockId: LOOSE_BLOCK })]);
    expect(result?.status).toBe("rejected");
    expect(result?.error?.message).toMatch(/not part of the session/);
  });
});

describe("households still accumulate through sync", () => {
  it("creates the household on first contact", async () => {
    const [result] = await flush([item({ name: "Mr Tan" })]);
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM households WHERE id = $1`,
      [result?.visit?.householdId],
    );
    expect(rows[0]?.name).toBe("Mr Tan");
  });

  it("reuses the household for a second unit visit", async () => {
    const [first] = await flush([item()]);
    const [second] = await flush([item({ id: VISIT_B, updatedAt: T2 })]);
    expect(second?.visit?.householdId).toBe(first?.visit?.householdId);
  });

  it("does not erase a known name when a queued record learns nothing", async () => {
    await flush([item({ name: "Mr Tan" })]);
    const [second] = await flush([item({ id: VISIT_B, name: null, updatedAt: T2 })]);

    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM households WHERE id = $1`,
      [second?.visit?.householdId],
    );
    expect(rows[0]?.name).toBe("Mr Tan");
  });
});

describe("empty batches", () => {
  it("returns no results for no items", async () => {
    expect(await flush([])).toEqual([]);
  });
});

describe("clock rules", () => {
  const STARTED = new Date("2026-03-14T09:00:00.000Z");
  const startSession = () =>
    pool.query(`UPDATE outing_sessions SET started_at = $1 WHERE id = $2`, [STARTED, SESSION]);

  it("accepts timestamps exactly at the tolerance ahead of the server", async () => {
    const ahead = offset(TOLERANCE_MS);
    const [result] = await flush([item({ updatedAt: ahead, clientCreatedAt: ahead })]);
    expect(result?.status).toBe("applied");
  });

  it.each(["updatedAt", "clientCreatedAt"] as const)(
    "rejects %s just beyond the tolerance ahead",
    async (field) => {
      const [result] = await flush([item({ [field]: offset(TOLERANCE_MS + 1) })]);
      expect(result?.status).toBe("rejected");
      expect(result?.error?.code).toBe("clock_skew");
      expect(result?.error?.message).toMatch(/5 minutes ahead/);
      expect(await countVisits()).toBe(0);
    },
  );

  it("does not let one bad item reject its siblings", async () => {
    const results = await flush([
      item({ id: VISIT_A }),
      item({ id: VISIT_B, updatedAt: offset(3_600_000) }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "rejected"]);
    expect(await countVisits()).toBe(1);
  });

  it("still rejects a new record outside the tolerance before writing it", async () => {
    const [result] = await flush([item({ updatedAt: offset(3_600_000) })]);
    expect(result?.error?.code).toBe("clock_skew");
    expect(await countVisits()).toBe(0);
  });

  it("answers a replay unchanged even when the tolerance has since been lowered", async () => {
    // Stored while the clock agreed; retried after the stamp fell outside a tighter tolerance.
    const stamp = offset(200_000);
    await flush([item({ updatedAt: stamp, clientCreatedAt: stamp })]);
    const [replayed] = await flush([item({ updatedAt: stamp, clientCreatedAt: stamp })], ALICE, {
      now: NOW,
      toleranceMs: 60_000,
    });
    expect(replayed?.status).toBe("unchanged");
  });

  it("accepts a record exactly at the session start minus the tolerance", async () => {
    await startSession();
    const edge = offset(-TOLERANCE_MS, STARTED);
    const [result] = await flush([item({ updatedAt: edge, clientCreatedAt: edge })]);
    expect(result?.status).toBe("applied");
  });

  it.each(["updatedAt", "clientCreatedAt"] as const)(
    "rejects %s just before the session start minus the tolerance",
    async (field) => {
      await startSession();
      const [result] = await flush([
        item({
          clientCreatedAt: T1,
          updatedAt: T1,
          [field]: offset(-TOLERANCE_MS - 1, STARTED),
        }),
      ]);
      expect(result?.status).toBe("rejected");
      expect(result?.error?.code).toBe("clock_skew");
      expect(result?.error?.message).toMatch(/before its session began/);
    },
  );

  it("applies a dead-zone record hours old but inside the outing", async () => {
    await startSession();
    const hoursOld = offset(-2 * 3_600_000);
    const [result] = await flush([item({ updatedAt: hoursOld, clientCreatedAt: hoursOld })]);
    expect(result?.status).toBe("applied");
  });

  it("reports a replay of an applied record as unchanged, not clock_skew", async () => {
    await flush([item()]);
    await pool.query(`UPDATE outing_sessions SET started_at = $1 WHERE id = $2`, [
      new Date("2026-03-14T10:30:00.000Z"),
      SESSION,
    ]);
    const [replayed] = await flush([item()]);
    expect(replayed?.status).toBe("unchanged");
  });

  it("reports a stale edit as stale, not clock_skew", async () => {
    await flush([item({ updatedAt: T2 })]);
    await startSession();
    await pool.query(`UPDATE outing_sessions SET started_at = $1 WHERE id = $2`, [
      new Date("2026-03-14T10:30:00.000Z"),
      SESSION,
    ]);
    const [stale] = await flush([item({ updatedAt: T1 })]);
    expect(stale?.status).toBe("stale");
  });

  it("still reports an ended session as session_not_active first", async () => {
    await startSession();
    await pool.query(`UPDATE outing_sessions SET status = 'ended' WHERE id = $1`, [SESSION]);
    const old = offset(-10 * 86_400_000);
    const [result] = await flush([
      item({ sessionId: SESSION, updatedAt: old, clientCreatedAt: old }),
    ]);
    expect(result?.error?.code).toBe("session_not_active");
  });

  it("applies the lower bound to an explicitly named session too", async () => {
    await startSession();
    const old = offset(-10 * 86_400_000);
    const [result] = await flush([
      item({ sessionId: SESSION, updatedAt: old, clientCreatedAt: old }),
    ]);
    expect(result?.error?.code).toBe("clock_skew");
  });

  it("follows the tolerance it is given", async () => {
    const ahead = offset(600_000);
    const [strict] = await flush([item({ updatedAt: ahead })]);
    expect(strict?.status).toBe("rejected");
    const [lenient] = await flush([item({ updatedAt: ahead })], ALICE, {
      now: NOW,
      toleranceMs: 600_000,
    });
    expect(lenient?.status).toBe("applied");
  });
});
