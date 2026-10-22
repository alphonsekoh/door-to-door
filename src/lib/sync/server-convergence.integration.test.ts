import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Database, resetDatabase } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { PROBE_MS } from "@/lib/sync/backoff";
import { type SyncController, createSyncController } from "@/lib/sync/controller";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import { recordReason } from "@/lib/sync/sync-ui";
import { sendBatch } from "@/lib/sync/transport";
import type { QueuedVisit, Send } from "@/lib/sync/types";
import { uuidv7 } from "@/lib/uuid";
import { type SyncItem, syncVisits } from "@/server/visits/sync";

/*
 * The queue against the real server (#34): the controller and engine, the
 * real transport, the real route with its contract check, and Postgres.
 * Only the session cookie is stood in for.
 */

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { POST } = await import("@/app/api/visits/sync/route");

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "34343434-0000-4000-8000-000000000001";
const BEN = "34343434-0000-4000-8000-000000000002";
const BLOCK = "34343434-0000-4000-8001-000000000001";
const LOOSE_BLOCK = "34343434-0000-4000-8001-000000000002";
const SESSION = "34343434-0000-4000-8002-000000000001";

/* The server checks stamps against its own clock, so the queue's clock
   starts at the real time; only its timers are cranked by hand. */
const REAL_START = Date.now();
const OUTING_STARTED = new Date(REAL_START - 2 * 60 * 60 * 1000);

/* The route's limiter lives as long as the module, so each test sends as a
   member of its own. */
let members = 0;
async function newMember(): Promise<string> {
  members += 1;
  const id = `34343434-0000-4000-8003-${String(members).padStart(12, "0")}`;
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Member', 'member')`,
    [id, `member${String(members)}@t.local`],
  );
  auth.mockResolvedValue({ user: { id, role: "member", deactivated: false } });
  return id;
}

/* Sends what the transport asks for straight into the route handler. */
const route = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  expect(input).toBe("/api/visits/sync");
  return POST(new Request("https://test.local/api/visits/sync", init));
};

function stored(ownerId: string, unit: number, at = REAL_START): QueuedVisit {
  return buildQueuedVisit(
    {
      blockId: BLOCK,
      unitNumber: `#07-${String(unit).padStart(3, "0")}`,
      interestLevel: "medium",
      description: "",
      name: "",
      contact: "",
      religion: "",
      sessionId: SESSION,
    },
    ownerId,
    at,
  );
}

function harness(ownerId: string, records: readonly QueuedVisit[], send: Send = sendBatch) {
  const queue = createMemoryQueue(records);
  let now = REAL_START;
  const timers: { callback: () => void; at: number }[] = [];
  const controller: SyncController = createSyncController({
    queue,
    ownerId,
    send,
    now: () => now,
    random: () => 0.5,
    setTimer: (callback, ms) => {
      const timer = { callback, at: now + ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      const index = timers.findIndex((timer) => timer === handle);
      if (index !== -1) timers.splice(index, 1);
    },
    onChange: () => undefined,
  });
  return {
    queue,
    controller,
    async tick(ms: number) {
      now += ms;
      for (const timer of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
      await controller.flush();
    },
    states: async () => (await queue.listAll()).map((record) => record.state),
  };
}

async function visitCount(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM visits`);
  return Number(rows[0]?.count);
}

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'a@t.local','Admin','admin'), ($2,'ben@t.local','Ben','member')`,
    [ADMIN, BEN],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1,'34','Test Ave'), ($2,'99','Elsewhere')`,
    [BLOCK, LOOSE_BLOCK],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at) VALUES ($1,'Outing','active',$2,$3)`,
    [SESSION, ADMIN, OUTING_STARTED],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  vi.stubGlobal("fetch", vi.fn(route));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("the queue against the real server", () => {
  it("stores one row per visit when a reply is lost and the batch is sent again", async () => {
    const owner = await newMember();
    const records = Array.from({ length: 150 }, (_, i) => stored(owner, i, REAL_START - 150 + i));
    let lost = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await route(input, init);
        if (!lost) return response;
        // Committed on the server, then the signal went.
        lost = false;
        throw new TypeError("fetch failed");
      }),
    );
    const h = harness(owner, records);

    await h.controller.start();
    expect(await visitCount()).toBe(100);
    expect(new Set(await h.states())).toEqual(new Set(["queued"]));

    await h.controller.wake();
    expect(await visitCount()).toBe(150);
    expect(await h.states()).toEqual(Array.from({ length: 150 }, () => "synced"));
    const { rows } = await pool.query<{ member_id: string }>(
      `SELECT DISTINCT member_id FROM visits`,
    );
    expect(rows).toEqual([{ member_id: owner }]);
  });

  it("files what it can from a mixed batch and holds the rest with a reason", async () => {
    const owner = await newMember();
    const bens = stored(BEN, 900);
    await syncVisits(db, [bens.item], BEN, { now: new Date(), toleranceMs: 300_000 });

    const valid = stored(owner, 1);
    const loose = stored(owner, 2);
    loose.item = { ...loose.item, blockId: LOOSE_BLOCK };
    const taken = { ...stored(owner, 900), id: bens.id, item: { ...bens.item } };
    const early = new Date(OUTING_STARTED.getTime() - 60 * 60 * 1000).toISOString();
    const skewed = stored(owner, 3);
    skewed.item = { ...skewed.item, clientCreatedAt: early, updatedAt: early };
    const h = harness(owner, [valid, loose, taken, skewed]);

    await h.controller.start();

    const byId = async (id: string) => h.queue.get(id);
    expect((await byId(valid.id))?.state).toBe("synced");
    for (const id of [loose.id, taken.id]) {
      const record = await byId(id);
      expect(record).toMatchObject({ state: "held", nextAttemptAt: null });
      expect(record?.lastError?.code).toBe("conflict");
      expect(record && recordReason(record)).toBe(
        "The server would not accept this record. Ask an admin.",
      );
    }
    // Restamped at the phone's time and sent again on the next timer.
    expect((await byId(skewed.id))?.lastError?.code).toBe("clock_skew");
    await h.tick(0);
    const restamped = await byId(skewed.id);
    expect(restamped?.state).toBe("synced");
    expect(restamped?.item.updatedAt).toBe(new Date(REAL_START).toISOString());

    // Ben's visit is still his, and the loose block has nothing.
    const { rows } = await pool.query<{ id: string; member_id: string }>(
      `SELECT id, member_id FROM visits ORDER BY id`,
    );
    expect(rows).toEqual(
      [
        { id: bens.id, member_id: BEN },
        { id: valid.id, member_id: owner },
        { id: skewed.id, member_id: owner },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("holds what is left when the outing ends between two batches, and sends it once reopened", async () => {
    const owner = await newMember();
    const records = Array.from({ length: 150 }, (_, i) => stored(owner, i, REAL_START - 150 + i));
    let calls = 0;
    const send: Send = async (items) => {
      const outcome = await sendBatch(items);
      calls += 1;
      if (calls === 1) {
        await pool.query(
          `UPDATE outing_sessions SET status = 'ended', ended_at = now() WHERE id = $1`,
          [SESSION],
        );
      }
      return outcome;
    };
    const h = harness(owner, records, send);

    await h.controller.start();
    const after = await h.queue.listAll();
    expect(after).toHaveLength(150);
    expect(after.filter((r) => r.state === "synced")).toHaveLength(100);
    const held = after.filter((r) => r.state === "held");
    expect(held).toHaveLength(50);
    for (const record of held) {
      expect(record.lastError?.code).toBe("session_not_active");
      expect(recordReason(record)).toBe("The session has ended. Sends if an admin reopens it.");
    }

    await pool.query(
      `UPDATE outing_sessions SET status = 'active', ended_at = NULL WHERE id = $1`,
      [SESSION],
    );
    await h.tick(PROBE_MS);
    expect(await h.states()).toEqual(Array.from({ length: 150 }, () => "synced"));
    expect(await visitCount()).toBe(150);
  });
});

describe("convergence on the newest updatedAt", () => {
  const NOW = new Date(REAL_START);
  const clock = { now: NOW, toleranceMs: 300_000 };
  let run = 0;

  type Version = {
    id: string;
    updatedAt: string;
    interestLevel: SyncItem["interestLevel"];
    named: boolean;
  };

  it("ends on the newest version whatever order, repeats and batches the server sees", async () => {
    const owner = await newMember();
    const levels = ["no_response", "low", "medium", "high"] as const;

    const visits = fc.array(
      fc.record({
        // Distinct minutes into the outing, so no two versions tie.
        minutes: fc.uniqueArray(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 4 }),
        names: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
      }),
      { minLength: 1, maxLength: 3 },
    );
    const arrival = fc.record({
      order: fc.array(fc.nat(), { minLength: 30, maxLength: 30 }),
      repeats: fc.array(fc.nat(2), { minLength: 30, maxLength: 30 }),
      cuts: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 30, maxLength: 30 }),
    });

    await fc.assert(
      fc.asyncProperty(visits, arrival, async (shape, { order, repeats, cuts }) => {
        run += 1;
        const unitOf = (k: number) => `#${String(run).padStart(3, "0")}-${String(k)}`;
        const ids = shape.map(() => uuidv7());
        const versions: (Version & { k: number })[] = shape.flatMap(({ minutes, names }, k) =>
          minutes.map((m, v) => ({
            k,
            id: ids[k] ?? "",
            updatedAt: new Date(OUTING_STARTED.getTime() + m * 60_000).toISOString(),
            interestLevel: levels[v % levels.length] ?? "low",
            named: names[v] ?? false,
          })),
        );
        const toItem = (version: Version & { k: number }): SyncItem => ({
          id: version.id,
          blockId: BLOCK,
          unitNumber: unitOf(version.k),
          sessionId: SESSION,
          interestLevel: version.interestLevel,
          clientCreatedAt: OUTING_STARTED.toISOString(),
          updatedAt: version.updatedAt,
          name: version.named ? `Household ${String(version.k)}` : null,
          contact: null,
          religion: null,
        });

        // Permuted, some sent more than once, cut into batches.
        const arriving = versions
          .flatMap((version, i) => Array.from({ length: 1 + (repeats[i] ?? 0) }, () => version))
          .map((version, i) => ({ version, key: order[i % order.length] ?? 0, i }))
          .sort((a, b) => a.key - b.key || a.i - b.i)
          .map(({ version }) => version);
        const applied = new Set<string>();
        for (let at = 0, c = 0; at < arriving.length; c += 1) {
          const batch = arriving.slice(at, at + (cuts[c % cuts.length] ?? 1));
          at += batch.length;
          const outcomes = await syncVisits(db, batch.map(toItem), owner, clock);
          outcomes.forEach((outcome, i) => {
            expect(outcome.status).not.toBe("rejected");
            const version = batch[i];
            if (outcome.status === "applied" && version?.named) applied.add(version.id);
          });
        }

        for (const [k, id] of ids.entries()) {
          const newest = versions
            .filter((v) => v.k === k)
            .reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
          const { rows } = await pool.query<{
            interest_level: string;
            updated_at: Date;
            name: string | null;
            n: string;
          }>(
            `SELECT v.interest_level, v.updated_at, h.name,
                    (SELECT count(*) FROM visits WHERE id = $1) AS n
               FROM visits v JOIN households h ON h.id = v.household_id WHERE v.id = $1`,
            [id],
          );
          expect(rows).toHaveLength(1);
          const row = rows[0];
          expect(row?.n).toBe("1");
          expect(row?.updated_at.toISOString()).toBe(newest.updatedAt);
          expect(row?.interest_level).toBe(newest.interestLevel);
          // Once known, a household's name is never blanked by a later visit (D-07-1).
          expect(row?.name).toBe(applied.has(id) ? `Household ${String(k)}` : null);
        }
      }),
      { seed: 34, numRuns: 20 },
    );
  });
});
