import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { truncateAll } from "@/db/testing";
import { requireTestDatabaseUrl } from "@/db/test-env";
import type { Clock } from "@/lib/clock";
import type * as Access from "@/server/teams/access";
import type * as Service from "@/server/visits/service";
import { getHouseholdHistory } from "@/server/visits/queries";
import { syncVisits, type SyncCaller, type SyncItem } from "@/server/visits/sync";

const { teamIdFor, getVisits } = vi.hoisted(() => ({
  teamIdFor: vi.fn<typeof Access.teamIdFor>(),
  getVisits: vi.fn<typeof Service.getVisits>(),
}));
vi.mock("@/server/teams/access", async (importOriginal) => {
  const actual = await importOriginal<typeof Access>();
  teamIdFor.mockImplementation(actual.teamIdFor);
  return { ...actual, teamIdFor };
});
vi.mock("@/server/visits/service", async (importOriginal) => {
  const actual = await importOriginal<typeof Service>();
  getVisits.mockImplementation(actual.getVisits);
  return { ...actual, getVisits };
});

/*
 * A batch of records is judged and written together (#251). What one record
 * at a time decided must still be decided exactly so, and what it costs must
 * no longer grow with the batch.
 */

/* Every statement the app's connections send, BEGIN and COMMIT included. */
const sent = { statements: 0 };
const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 2 });
pool.on("connect", (client: PoolClient) => {
  const query = client.query.bind(client) as (...args: unknown[]) => unknown;
  Object.assign(client, {
    query: (...args: unknown[]) => {
      sent.statements += 1;
      return query(...args);
    },
  });
});
const controller = new Pool({ connectionString: requireTestDatabaseUrl(), max: 2 });
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "5b5b5b5b-0000-4000-8000-000000000001";
const ALICE = "5b5b5b5b-0000-4000-8000-000000000002";
const BEN = "5b5b5b5b-0000-4000-8000-000000000003";
const BLOCK = "5b5b5b5b-0000-4000-8001-000000000001";
const LOOSE_BLOCK = "5b5b5b5b-0000-4000-8001-000000000002";
const OTHER_BLOCK = "5b5b5b5b-0000-4000-8001-000000000003";
const NO_BLOCK = "5b5b5b5b-0000-4000-8001-0000000000ff";
const SESSION = "5b5b5b5b-0000-4000-8002-000000000001";
const TEAM = "5b5b5b5b-0000-4000-8004-000000000001";
const GHOST_TEAM = "5b5b5b5b-0000-4000-8004-0000000000ff";

const T1 = "2026-03-14T10:00:00.000Z";
const T2 = "2026-03-14T11:00:00.000Z";
const T3 = "2026-03-14T11:30:00.000Z";
const clock: Clock = { now: new Date("2026-03-14T12:00:00.000Z"), toleranceMs: 300_000 };

const alice: SyncCaller = { id: ALICE, role: "member" };
const admin: SyncCaller = { id: ADMIN, role: "admin" };

/* Ids from one millisecond, so only what follows it orders them. */
const idOf = (n: number) => `01960000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

const item = (n: number, overrides: Partial<SyncItem> = {}): SyncItem => ({
  id: idOf(n),
  blockId: BLOCK,
  unitNumber: `#${String(n)}`,
  interestLevel: "low",
  clientCreatedAt: T1,
  updatedAt: T1,
  ...overrides,
});

const flush = (items: SyncItem[], caller = alice) => syncVisits(db, items, caller, clock);

const statementsFor = async (work: () => Promise<unknown>): Promise<number> => {
  sent.statements = 0;
  await work();
  return sent.statements;
};

const rows = async <T extends object>(sql: string, params: unknown[] = []) =>
  (await controller.query<T>(sql, params)).rows;

const householdAt = async (unitNumber: string) =>
  (
    await rows<{ id: string; name: string | null; contact: string | null; updated_at: Date }>(
      `SELECT id, name, contact, updated_at FROM households WHERE unit_number = $1`,
      [unitNumber],
    )
  )[0];

/*
 * Turns the session into a follow-up session with a listed, owed note at
 * each of `units` in `block`, all picked for it.
 */
async function followUpSession(units: string[], block = BLOCK): Promise<void> {
  await controller.query(`UPDATE outing_sessions SET kind = 'follow_up' WHERE id = $1`, [SESSION]);
  await controller.query(
    `WITH placed AS (
       INSERT INTO households (block_id, unit_number)
       SELECT $1, unit FROM unnest($2::text[]) AS unit RETURNING id
     ), noted AS (
       INSERT INTO follow_ups (household_id, author_id, note, status, listed_at, listed_by)
       SELECT id, $3, 'Come back', 'listed', now(), $3 FROM placed
     )
     INSERT INTO session_households (session_id, household_id) SELECT $4, id FROM placed`,
    [block, units, ADMIN, SESSION],
  );
}

/* A second block, attached to the session. */
async function attachOtherBlock(): Promise<void> {
  await controller.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'456','Far Ave')`, [
    OTHER_BLOCK,
  ]);
  await controller.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    OTHER_BLOCK,
  ]);
}

const units = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => `#${String(from + i)}`);

const realNow = Date.now.bind(Date);
let shift = 0;

beforeEach(async () => {
  // Each test starts outside the previous one's log throttle window.
  shift += 60_000;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + shift);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  await truncateAll(pool);
  await controller.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'), ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await controller.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave'), ($2,'999','Elsewhere')`,
    [BLOCK, LOOSE_BLOCK],
  );
  await controller.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at) VALUES ($1,'Outing','active',$2,$3)`,
    [SESSION, ADMIN, new Date("2026-03-14T08:00:00.000Z")],
  );
  await controller.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  await controller.query(
    `INSERT INTO session_teams (id, session_id, name, created_by) VALUES ($1,$2,'Pair',$3)`,
    [TEAM, SESSION, ADMIN],
  );
  await controller.query(
    `INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3), ($1,$2,$4)`,
    [TEAM, SESSION, ALICE, BEN],
  );
  teamIdFor.mockClear();
  getVisits.mockClear();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await controller.end();
  await pool.end();
});

describe("what a batch costs", () => {
  /* Batches of 1, 25 and 100 new records, each at units of its own. */
  const sizes = [
    { first: 1, count: 1 },
    { first: 2, count: 25 },
    { first: 27, count: 100 },
  ];
  const batch = ({ first, count }: { first: number; count: number }, name?: string) =>
    Array.from({ length: count }, (_, i) => item(first + i, name === undefined ? {} : { name }));

  it("is the same for 1, 25 or 100 new records by a member on a team", async () => {
    const counts: number[] = [];
    for (const size of sizes) {
      counts.push(
        await statementsFor(async () => {
          const results = await flush(batch(size, "Mr Tan"));
          expect(results.every((result) => result.status === "applied")).toBe(true);
        }),
      );
    }

    expect(counts).toEqual([counts[0], counts[0], counts[0]]);
    expect(counts[0]).toBeLessThanOrEqual(20);
    const { rows: stamped } = await pool.query(`SELECT 1 FROM visit_teammates`);
    expect(stamped).toHaveLength(126);
  });

  it("is the same for 1, 25 or 100 new records by a member in a follow-up session", async () => {
    await followUpSession(units(1, 126));
    const counts: number[] = [];
    for (const size of sizes) {
      counts.push(
        await statementsFor(async () => {
          const results = await flush(batch(size));
          expect(results.every((result) => result.status === "applied")).toBe(true);
          expect(results.every((result) => result.markedDone.length === 1)).toBe(true);
        }),
      );
    }

    expect(counts).toEqual([counts[0], counts[0], counts[0]]);
    expect(counts[0]).toBeLessThanOrEqual(20);
  });

  it("is the same to replay 1, 25 or 100 records", async () => {
    for (const size of sizes) await flush(batch(size));
    const counts: number[] = [];
    for (const size of sizes) {
      counts.push(
        await statementsFor(async () => {
          const results = await flush(batch(size));
          expect(results.every((result) => result.status === "unchanged")).toBe(true);
        }),
      );
    }

    expect(counts).toEqual([counts[0], counts[0], counts[0]]);
    expect(counts[0]).toBeLessThanOrEqual(10);
  });
});

describe("a batch mixing every outcome", () => {
  it("answers each item as it alone would have been, in request order", async () => {
    await followUpSession(["#01-01", "#02-02", "#03-03"]);
    const stored = (n: number, overrides: Partial<SyncItem> = {}) =>
      item(n, { unitNumber: "#03-03", updatedAt: T2, ...overrides });
    await flush([stored(91), stored(92), stored(93)]);

    const batch = [
      item(1, { unitNumber: "#01-01" }),
      stored(91),
      stored(92, { updatedAt: T1 }),
      item(2, { blockId: NO_BLOCK, unitNumber: "#06-06" }),
      item(3, { unitNumber: "#08-08", updatedAt: "2026-03-14T13:00:00.000Z" }),
      item(4, { blockId: LOOSE_BLOCK, unitNumber: "#07-07" }),
      item(5, { unitNumber: "#09-09" }),
      item(6, { unitNumber: "#02-02" }),
      stored(93, { interestLevel: "high", updatedAt: T3 }),
    ];
    const results = await flush(batch);

    expect(results.map((result) => [result.id, result.status, result.error?.code])).toEqual([
      [idOf(1), "applied", undefined],
      [idOf(91), "unchanged", undefined],
      [idOf(92), "stale", undefined],
      [idOf(2), "rejected", "not_found"],
      [idOf(3), "rejected", "clock_skew"],
      [idOf(4), "rejected", "conflict"],
      [idOf(5), "rejected", "not_on_follow_up_list"],
      [idOf(6), "applied", undefined],
      [idOf(93), "applied", undefined],
    ]);
    expect(results[5]?.error?.message).toBe("That block is not part of the session.");
    expect(results[8]?.visit?.interestLevel).toBe("high");

    const places = await rows<{ unit_number: string }>(
      `SELECT unit_number FROM households ORDER BY unit_number`,
    );
    expect(places.map((place) => place.unit_number)).toEqual(["#01-01", "#02-02", "#03-03"]);
    // The refusals and replays between the two new records left them one run.
    const [gap] = await rows<{ gap: string }>(
      `SELECT (b.created_at - a.created_at)::text AS gap FROM visits a, visits b
       WHERE a.id = $1 AND b.id = $2`,
      [idOf(1), idOf(6)],
    );
    expect(gap?.gap).toBe("00:00:00.000001");
  });
});

describe("the households of a batch's records", () => {
  it("puts each record at the household of its own block and unit", async () => {
    await attachOtherBlock();
    // Neither sorted nor grouped: the household upsert answers in its own order.
    const batch = [
      item(1, { blockId: OTHER_BLOCK, unitNumber: "#09-09" }),
      item(2, { blockId: BLOCK.toUpperCase(), unitNumber: "#02-02" }),
      item(3, { unitNumber: "#09-09" }),
      item(4, { blockId: OTHER_BLOCK, unitNumber: "#01-01" }),
      item(5, { unitNumber: "#02-02" }),
      item(6, { unitNumber: "#01-01" }),
    ];

    const results = await flush(batch);
    expect(results.every((result) => result.status === "applied")).toBe(true);
    // Written as one run, not saved by going again one record at a time.
    expect(teamIdFor).toHaveBeenCalledTimes(1);
    const at = new Map(
      (
        await rows<{ id: string; block_id: string; unit_number: string }>(
          `SELECT id, block_id, unit_number FROM households`,
        )
      ).map((place) => [`${place.block_id} ${place.unit_number}`, place.id]),
    );
    expect(at.size).toBe(5);
    expect(results.map((result) => result.visit?.householdId)).toEqual(
      batch.map((sent) => at.get(`${sent.blockId.toLowerCase()} ${sent.unitNumber}`)),
    );
  });
});

describe("a household two records of a batch share", () => {
  it("is one household, with what each record learnt in request order", async () => {
    const results = await flush([
      item(1, { unitNumber: "#05-123", name: "Mr Tan", contact: "9123 4567" }),
      item(2, { unitNumber: "#05-123", name: "Mrs Tan", religion: "buddhist" }),
      item(3, { unitNumber: "#05-123", name: "  ", contact: null }),
    ]);

    expect(new Set(results.map((result) => result.visit?.householdId)).size).toBe(1);
    expect(
      await rows(`SELECT name, contact, religion FROM households WHERE unit_number = '#05-123'`),
    ).toEqual([{ name: "Mrs Tan", contact: "9123 4567", religion: "buddhist" }]);
  });

  it("keeps its updated_at when the batch learnt nothing there, and moves it when it did", async () => {
    await flush([item(1, { unitNumber: "#05-123", name: "Mr Tan" })]);
    await controller.query(`UPDATE households SET updated_at = '2026-01-01T00:00:00Z'`);

    await flush([item(2, { unitNumber: "#05-123" }), item(3, { unitNumber: "#05-123", name: "" })]);
    expect((await householdAt("#05-123"))?.updated_at).toEqual(new Date("2026-01-01T00:00:00Z"));

    await flush([
      item(4, { unitNumber: "#05-123" }),
      item(5, { unitNumber: "#05-123", contact: "1" }),
    ]);
    const after = await householdAt("#05-123");
    expect(after).toMatchObject({ name: "Mr Tan", contact: "1" });
    expect(after?.updated_at.getTime()).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
  });

  it.each([
    ["a new record, then an amend", [false, true], "Amended"],
    ["an amend, then a new record", [true, false], "Recorded"],
  ])("ends on the later of %s", async (_case, order, expected) => {
    const amended = item(1, { unitNumber: "#05-123" });
    await flush([amended]);
    const writes = order.map((amend) =>
      amend
        ? { ...amended, name: "Amended", updatedAt: T2 }
        : item(2, { unitNumber: "#05-123", name: "Recorded" }),
    );

    const results = await flush(writes);
    expect(results.map((result) => result.status)).toEqual(["applied", "applied"]);
    expect((await householdAt("#05-123"))?.name).toBe(expected);
  });
});

describe("the order a batch's records are stored in", () => {
  it("is request order, wherever history orders by when a visit was stored", async () => {
    // Ids falling as the batch goes on, so the id cannot be what orders them.
    const batch = Array.from({ length: 21 }, (_, knock) =>
      item(100 - knock, { unitNumber: "#61-01" }),
    );
    const results = await flush(batch);
    expect(results.every((result) => result.status === "applied")).toBe(true);

    const stored = await rows<{ id: string }>(`SELECT id FROM visits ORDER BY created_at, id`);
    expect(stored.map((visit) => visit.id)).toEqual(batch.map((visit) => visit.id));
    expect(await rows(`SELECT count(DISTINCT created_at)::int AS n FROM visits`)).toEqual([
      { n: 21 },
    ]);

    const householdId = results[0]?.visit?.householdId ?? "";
    const history = await getHouseholdHistory(db, householdId, { limit: 21, offset: 0 });
    expect(history.visits.map((visit) => visit.id)).toEqual(
      batch.map((visit) => visit.id).reverse(),
    );
  });
});

describe("a batch in a follow-up session", () => {
  const notesAt = (unitNumber: string) =>
    rows<{ id: string; done_by: string | null; done_visit_id: string | null; done_at: Date }>(
      `SELECT f.id, f.done_by, f.done_visit_id, f.done_at FROM follow_ups f
       JOIN households h ON h.id = f.household_id
       WHERE h.unit_number = $1 ORDER BY f.created_at, f.id`,
      [unitNumber],
    );

  beforeEach(async () => {
    await followUpSession(["#01-01", "#02-02"]);
    const [place] = await rows<{ id: string }>(
      `SELECT id FROM households WHERE unit_number = '#01-01'`,
    );
    await controller.query(
      `INSERT INTO follow_ups (household_id, author_id, note, status, listed_at, listed_by, created_at)
       VALUES ($1, $2, 'And the pamphlet', 'listed', now(), $2, now() + interval '1 second')`,
      [place?.id, ADMIN],
    );
  });

  it("credits a household's notes to the first new record there, and says so on it alone", async () => {
    const results = await flush([
      item(1, { unitNumber: "#01-01" }),
      item(2, { unitNumber: "#01-01" }),
    ]);

    const notes = await notesAt("#01-01");
    expect(notes).toHaveLength(2);
    expect(notes.map((note) => [note.done_by, note.done_visit_id])).toEqual([
      [ALICE, idOf(1)],
      [ALICE, idOf(1)],
    ]);
    expect(results.map((result) => result.markedDone)).toEqual([notes.map((note) => note.id), []]);
  });

  it("names the same notes on a replay, and marks nothing again", async () => {
    const batch = [item(1, { unitNumber: "#01-01" }), item(2, { unitNumber: "#01-01" })];
    const first = await flush(batch);
    const before = await notesAt("#01-01");

    const replayed = await flush(batch);
    expect(replayed.map((result) => result.status)).toEqual(["unchanged", "unchanged"]);
    expect(replayed.map((result) => result.markedDone)).toEqual(
      first.map((result) => result.markedDone),
    );
    expect(await notesAt("#01-01")).toEqual(before);
  });

  it("refuses a member a unit listed only in another of its blocks", async () => {
    await attachOtherBlock();
    await followUpSession(["#07-07"], OTHER_BLOCK);

    const results = await flush([
      item(1, { unitNumber: "#01-01" }),
      item(2, { blockId: OTHER_BLOCK, unitNumber: "#01-01" }),
    ]);

    expect(results.map((result) => [result.status, result.error?.code])).toEqual([
      ["applied", undefined],
      ["rejected", "not_on_follow_up_list"],
    ]);
    expect(
      await rows(`SELECT 1 FROM households WHERE block_id = $1 AND unit_number = '#01-01'`, [
        OTHER_BLOCK,
      ]),
    ).toEqual([]);
  });

  it("lets an admin record off the list, credits them, and never joins them", async () => {
    const results = await flush(
      [item(1, { unitNumber: "#09-09" }), item(2, { unitNumber: "#02-02" })],
      admin,
    );

    expect(results.map((result) => result.status)).toEqual(["applied", "applied"]);
    expect((await notesAt("#02-02")).map((note) => [note.done_by, note.done_visit_id])).toEqual([
      [ADMIN, idOf(2)],
    ]);
    expect(await rows(`SELECT 1 FROM session_participants`)).toEqual([]);
  });
});

/* Until a backend is blocked on a lock running a query like `pattern`. */
async function waitingOn(pattern: string): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const found = await rows(
      `SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND datname = current_database()
         AND pid <> pg_backend_pid() AND query ILIKE $1`,
      [pattern],
    );
    if (found.length > 0) return;
    if (Date.now() - startedAt > 4_000) throw new Error(`nothing waited on ${pattern}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("a run that cannot be written together", () => {
  it("goes again one record at a time when another request stores one of its records first", async () => {
    const [earlier] = await flush([item(9, { unitNumber: "#05-123" })]);

    // The other request holds the household by the visit it has not yet committed.
    const other = await controller.connect();
    let flushing: ReturnType<typeof flush> | undefined;
    try {
      await other.query("BEGIN");
      await other.query(
        `INSERT INTO visits (id, household_id, session_id, member_id, team_id, interest_level, updated_at, client_created_at)
         VALUES ($1,$2,$3,$4,$5,'low',$6,$6)`,
        [idOf(1), earlier?.visit?.householdId, SESSION, ALICE, TEAM, T1],
      );
      await other.query(`INSERT INTO visit_teammates (visit_id, user_id) VALUES ($1,$2)`, [
        idOf(1),
        BEN,
      ]);
      flushing = flush([item(1, { unitNumber: "#05-123" }), item(2, { unitNumber: "#06-201" })]);
      await waitingOn('%insert into "households"%');
      await other.query("COMMIT");
    } catch (error) {
      await other.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      other.release();
      await flushing?.catch(() => undefined);
    }

    const results = await flushing;
    expect(results.map((result) => result.status)).toEqual(["unchanged", "applied"]);
    expect(await rows(`SELECT visit_id, user_id FROM visit_teammates ORDER BY visit_id`)).toEqual([
      { visit_id: idOf(1), user_id: BEN },
      { visit_id: idOf(2), user_id: BEN },
      { visit_id: idOf(9), user_id: BEN },
    ]);
    // A race, not a failure: nothing to log.
    expect(console.error).not.toHaveBeenCalled();
  });

  it("saves every record when the team it read was disbanded before it stamped them", async () => {
    teamIdFor.mockImplementationOnce(() => Promise.resolve(GHOST_TEAM));
    const results = await flush([item(1), item(2), item(3)]);

    expect(results.map((result) => [result.status, result.visit?.team?.name])).toEqual([
      ["applied", "Pair"],
      ["applied", "Pair"],
      ["applied", "Pair"],
    ]);
    // Once for the run, then once for each record on its own.
    expect(teamIdFor).toHaveBeenCalledTimes(4);
  });
});

describe("answering a batch", () => {
  it("keeps what it stored when the answers cannot be read, so a resend answers it unchanged", async () => {
    getVisits.mockRejectedValueOnce(new Error("connection reset"));
    const batch = [item(1), item(2)];

    const results = await flush(batch);
    expect(results.map((result) => [result.status, result.error?.code])).toEqual([
      ["rejected", "internal_error"],
      ["rejected", "internal_error"],
    ]);
    expect(await rows(`SELECT 1 FROM visits`)).toHaveLength(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("connection reset"));

    expect((await flush(batch)).map((result) => result.status)).toEqual(["unchanged", "unchanged"]);
  });

  it("rejects only the item whose stored row is missing from the answers", async () => {
    getVisits.mockImplementationOnce(async (database, ids) => {
      const { getVisits: real } = await vi.importActual<typeof Service>("@/server/visits/service");
      const found = await real(database, ids);
      found.delete(idOf(1));
      return found;
    });

    const results = await flush([item(1), item(2)]);
    expect(results.map((result) => [result.status, result.error?.code])).toEqual([
      ["rejected", "internal_error"],
      ["applied", undefined],
    ]);
  });

  it("goes one item at a time when a batch names one visit twice, in either letter case", async () => {
    const results = await flush([item(1), item(1, { id: idOf(1).toUpperCase() })]);

    expect(results.map((result) => [result.id, result.status])).toEqual([
      [idOf(1), "applied"],
      [idOf(1).toUpperCase(), "unchanged"],
    ]);
    expect(await rows(`SELECT 1 FROM visits`)).toHaveLength(1);
  });
});
