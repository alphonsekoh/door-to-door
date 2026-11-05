import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase, type Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";
import { zError, zHouseholdHistory, zListHouseholdsResponse } from "@/generated/zod.gen";
import { listHouseholds } from "@/server/visits/queries";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET } = await import("./route");
const { GET: historyRoute } = await import("./[id]/route");

/*
 * The block's unit list, however many visits a household holds and however
 * many units a block holds (#126, #127).
 */

const pool = createTestPool();
let queryCount = 0;
const db = drizzle(pool, {
  schema,
  logger: { logQuery: () => void (queryCount += 1) },
}) as unknown as Database;

const ADMIN = "12612612-0000-4000-8000-000000000001";
const ALICE = "12612612-0000-4000-8000-000000000002";
const BEN = "12612612-0000-4000-8000-000000000003";
const BLOCK = "12612612-0000-4000-8001-000000000001";
const SESSION = "12612612-0000-4000-8002-000000000001";
const PAST = "12612612-0000-4000-8002-000000000002";
const TEAM = "12612612-0000-4000-8003-000000000001";
const HOUSEHOLD = "12612612-0000-4000-8004-000000000001";

const visitId = (n: number) => `01960000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const NOON = new Date("2026-03-14T12:00:00.000Z");

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'), ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at, ended_at) VALUES
      ($1,'Tonight','active',$3, now(), null),
      ($2,'March','ended',$3, now() - interval '30 days', now() - interval '29 days')`,
    [SESSION, PAST, ADMIN],
  );
  await pool.query(
    `INSERT INTO session_teams (id, session_id, name, created_by) VALUES ($1,$2,'Ann & Ben',$3)`,
    [TEAM, SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#05-123')`, [
    HOUSEHOLD,
    BLOCK,
  ]);
  auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));
  queryCount = 0;
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

async function list(query: string) {
  const response = await GET(new Request(`https://test.local/api/households?${query}`));
  expect(response.status).toBe(200);
  return zListHouseholdsResponse.parse(await response.json());
}

async function visit(
  id: string,
  options: { sessionId?: string; at?: Date; description?: string; household?: string } = {},
) {
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, description, created_at)
     VALUES ($1,$2,$3,$4,'low',$5,$6)`,
    [
      id,
      options.household ?? HOUSEHOLD,
      options.sessionId ?? SESSION,
      ALICE,
      options.description ?? "",
      options.at ?? NOON,
    ],
  );
}

describe("a household with a great many visits", () => {
  it("lists with its count and newest visit, that visit's team attached (#126)", async () => {
    // A member recording at one door over and over, every visit stamped with a team:
    // more visits than Postgres can bind in one statement.
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, team_id, interest_level, created_at)
       SELECT gen_random_uuid(), $1, $2, $3, $4, 'low', $5::timestamptz - make_interval(secs => i)
       FROM generate_series(1, 69999) AS i`,
      [HOUSEHOLD, SESSION, ALICE, TEAM, NOON],
    );
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, team_id, interest_level, description, created_at)
       VALUES ($1,$2,$3,$4,$5,'high','Asked us to come back in June.',$6)`,
      [visitId(1), HOUSEHOLD, SESSION, ALICE, TEAM, NOON],
    );
    await pool.query(`INSERT INTO visit_teammates (visit_id, user_id) VALUES ($1,$2)`, [
      visitId(1),
      BEN,
    ]);

    const page = await list(`blockId=${BLOCK}`);
    expect(page.pagination).toMatchObject({ total: 1, hasMore: false });
    expect(page.data[0]).toMatchObject({
      visitCount: 70_000,
      latestVisit: {
        id: visitId(1),
        description: "Asked us to come back in June.",
        team: { id: TEAM, name: "Ann & Ben", members: [{ id: BEN, name: "Ben" }] },
      },
    });

    // As many queries as for a household of one visit (D-20-3): block, page,
    // total, summaries, latest visits, team names, teammates, follow-ups.
    queryCount = 0;
    await listHouseholds(db, { blockId: BLOCK, limit: 100, offset: 0 });
    expect(queryCount).toBe(8);
  });

  it("costs two queries fewer when no latest visit is on a team", async () => {
    await visit(visitId(1));
    await listHouseholds(db, { blockId: BLOCK, limit: 100, offset: 0 });
    expect(queryCount).toBe(6);
  });
});

describe("the count and the latest visit", () => {
  it("are the session's own when the list is scoped to one", async () => {
    await visit(visitId(1), { sessionId: SESSION, at: new Date("2026-03-14T10:00:00Z") });
    await visit(visitId(2), { sessionId: SESSION, at: new Date("2026-03-14T11:00:00Z") });
    // Newer, but from another session.
    await visit(visitId(3), { sessionId: PAST, at: new Date("2026-03-15T09:00:00Z") });

    const tonight = await list(`blockId=${BLOCK}&sessionId=${SESSION}`);
    expect(tonight.data[0]).toMatchObject({ visitCount: 2, latestVisit: { id: visitId(2) } });

    const march = await list(`blockId=${BLOCK}&sessionId=${PAST}`);
    expect(march.data[0]).toMatchObject({ visitCount: 1, latestVisit: { id: visitId(3) } });

    const ever = await list(`blockId=${BLOCK}`);
    expect(ever.data[0]).toMatchObject({ visitCount: 3, latestVisit: { id: visitId(3) } });
  });

  it("breaks a tie on createdAt by id, as the household's history ends", async () => {
    await visit(visitId(2), { description: "Second by id" });
    await visit(visitId(1), { description: "First by id" });

    const page = await list(`blockId=${BLOCK}`);
    expect(page.data[0]?.latestVisit?.id).toBe(visitId(2));

    const response = await historyRoute(
      new Request(`https://test.local/api/households/${HOUSEHOLD}`),
      { params: Promise.resolve({ id: HOUSEHOLD }) },
    );
    const history = zHouseholdHistory.parse(await response.json());
    expect(history.visits.map((v) => v.id)).toEqual([visitId(1), visitId(2)]);
  });

  it("are none for a household no visit is left at", async () => {
    const page = await list(`blockId=${BLOCK}`);
    expect(page.data[0]).toMatchObject({ visitCount: 0, latestVisit: null });
  });
});

describe("a block of more units than one page (#127)", () => {
  it("has the unit a hundred others sort ahead of on the next page, with its history", async () => {
    // A sync batch of new units that sort first, each recorded once.
    await pool.query(
      `INSERT INTO households (block_id, unit_number)
       SELECT $1, '#00-' || lpad(i::text, 3, '0') FROM generate_series(0, 99) AS i`,
      [BLOCK],
    );
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
       SELECT gen_random_uuid(), id, $1, $2, 'no_response' FROM households WHERE id <> $3`,
      [SESSION, BEN, HOUSEHOLD],
    );
    await visit(visitId(1), { description: "Asked us to come back in June." });

    const first = await list(`blockId=${BLOCK}&limit=100&offset=0`);
    expect(first.pagination).toMatchObject({ total: 101, hasMore: true });
    expect(first.data.map((unit) => unit.household.unitNumber)).not.toContain("#05-123");

    const second = await list(`blockId=${BLOCK}&limit=100&offset=100`);
    expect(second.pagination).toMatchObject({ total: 101, hasMore: false });
    expect(second.data).toHaveLength(1);
    expect(second.data[0]).toMatchObject({
      household: { id: HOUSEHOLD, unitNumber: "#05-123" },
      latestVisit: { description: "Asked us to come back in June." },
    });
  });

  it("takes an offset of up to 10,000, and refuses one past it", async () => {
    const deepest = await list(`blockId=${BLOCK}&offset=10000`);
    expect(deepest.data).toEqual([]);
    expect(deepest.pagination).toMatchObject({ offset: 10_000, total: 1, hasMore: false });

    const response = await GET(
      new Request(`https://test.local/api/households?blockId=${BLOCK}&offset=10001`),
    );
    expect(response.status).toBe(400);
    expect(zError.parse(await response.json()).error.code).toBe("validation_failed");
  });
});
