import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase, resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";
import { currentClock } from "@/server/visits/clock-rules";
import { type SyncItem, syncVisits } from "@/server/visits/sync";

/*
 * #119: a unit number or note of nothing but spaces was trimmed to '' and
 * stored, and the response contract then refused every read that included
 * it, for everyone. Each write that can carry one refuses it, writes
 * nothing, and leaves the shared screens answering.
 */

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const visitsRoute = await import("./visits/route");
const visitRoute = await import("./visits/[id]/route");
const syncRoute = await import("./visits/sync/route");
const followUpsRoute = await import("./follow-ups/route");
const followUpRoute = await import("./follow-ups/[id]/route");
const blocksRoute = await import("./blocks/route");
const blockRoute = await import("./blocks/[id]/route");
const householdsRoute = await import("./households/route");
const householdRoute = await import("./households/[id]/route");
const revisitsRoute = await import("./sessions/[id]/revisits/route");

const pool = createTestPool();
const ADMIN = "b1a4cb1a-0000-4000-8000-000000000001";
const ALICE = "b1a4cb1a-0000-4000-8000-000000000002";
const BEN = "b1a4cb1a-0000-4000-8000-000000000003";
const BLOCK = "b1a4cb1a-0000-4000-8001-000000000001";
const TONIGHT = "b1a4cb1a-0000-4000-8002-000000000001";
const REVISIT = "b1a4cb1a-0000-4000-8002-000000000002";
const HOUSEHOLD = "b1a4cb1a-0000-4000-8003-000000000001";
const NOTE = "b1a4cb1a-0000-4000-8004-000000000001";
const VISIT = "01960000-0000-7000-8000-0000000b1a01";

const as = (id: string, role: "admin" | "member") => () =>
  auth.mockResolvedValue({ user: { id, role, deactivated: false } });
const asAdmin = as(ADMIN, "admin");
const asAlice = as(ALICE, "member");
const asBen = as(BEN, "member");

/* Spaces, and the kinds a phone keyboard or a paste can bring. */
const BLANKS = ["   ", " 　", "\t\n"];

let seq = 0;
const nextId = () => `01960000-0000-7000-8000-${String(++seq).padStart(12, "0")}`;

const json = (method: string, url: string, body: unknown) =>
  new Request(`https://test.local/api${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Failure = { error: { code: string; details?: { path: string; message: string }[] } };
async function refusal(response: Response): Promise<{ status: number } & Failure["error"]> {
  const body = (await response.json()) as Failure;
  return { status: response.status, ...body.error };
}
/* A 400 that names the field at fault. */
const refusedAt = (path: string) => ({
  status: 400,
  code: "validation_failed",
  details: [expect.objectContaining({ path })],
});

const recordVisit = (body: Record<string, unknown>) =>
  visitsRoute.POST(
    json("POST", "/visits", {
      id: nextId(),
      blockId: BLOCK,
      unitNumber: "#05-123",
      interestLevel: "low",
      ...body,
    }),
  );
const syncItem = (overrides: Partial<SyncItem> = {}): SyncItem => ({
  id: nextId(),
  blockId: BLOCK,
  unitNumber: "#06-201",
  interestLevel: "low",
  sessionId: TONIGHT,
  clientCreatedAt: new Date(Date.now() - 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
  ...overrides,
});

async function count(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? -1;
}
const counts = async () => ({
  households: await count("households"),
  visits: await count("visits"),
  followUps: await count("follow_ups"),
  blocks: await count("blocks"),
});

async function stored<T>(query: string, values: unknown[]): Promise<T | undefined> {
  return (await pool.query<T & Record<string, unknown>>(query, values)).rows[0];
}

beforeEach(async () => {
  seq = 0;
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
       ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'),
       ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, kind, status, started_at, created_by) VALUES
       ($1,'Tonight','regular','active', now() - interval '1 hour', $3),
       ($2,'Going back','follow_up','draft', null, $3)`,
    [TONIGHT, REVISIT, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$3), ($2,$3)`, [
    TONIGHT,
    REVISIT,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number, name, contact)
     VALUES ($1,$2,'#05-123','Tan','9000 0000')`,
    [HOUSEHOLD, BLOCK],
  );
  await pool.query(`INSERT INTO session_households (session_id, household_id) VALUES ($1,$2)`, [
    REVISIT,
    HOUSEHOLD,
  ]);
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
     VALUES ($1,$2,$3,$4,'medium')`,
    [VISIT, HOUSEHOLD, TONIGHT, ALICE],
  );
  await pool.query(
    `INSERT INTO follow_ups (id, household_id, author_id, note, status, listed_at, listed_by)
     VALUES ($1,$2,$3,'Bring the flyer','listed', now(), $4)`,
    [NOTE, HOUSEHOLD, ALICE, ADMIN],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("a blank unit number", () => {
  it("is refused by POST /visits, for a member and an admin, and writes nothing", async () => {
    const before = await counts();
    for (const unitNumber of BLANKS) {
      asAlice();
      expect(await refusal(await recordVisit({ unitNumber }))).toMatchObject(
        refusedAt("/unitNumber"),
      );
      asAdmin();
      expect(await refusal(await recordVisit({ unitNumber, memberId: BEN }))).toMatchObject(
        refusedAt("/unitNumber"),
      );
    }
    expect(await counts()).toEqual(before);
  });

  it("refuses a whole sync batch, at the item that broke it, and writes nothing", async () => {
    // Like any item that breaks the schema: the queue then sends each alone.
    asAlice();
    const before = await counts();
    const response = await syncRoute.POST(
      json("POST", "/visits/sync", {
        sentAt: new Date().toISOString(),
        items: [syncItem(), syncItem({ unitNumber: "   " })],
      }),
    );
    expect(await refusal(response)).toMatchObject(refusedAt("/items/1/unitNumber"));
    expect(await counts()).toEqual(before);
  });

  it("is one item's own refusal past the contract, and the items beside it still save", async () => {
    const [first, blank, last] = await syncVisits(
      getDatabase(),
      [syncItem(), syncItem({ unitNumber: " 　 " }), syncItem({ unitNumber: "#07-301" })],
      { id: ALICE, role: "member" },
      currentClock(),
    );
    expect(first?.status).toBe("applied");
    expect(blank).toMatchObject({ status: "rejected", visit: null });
    expect(blank?.error).toMatchObject(refusedAt("/unitNumber"));
    expect(last?.status).toBe("applied");
    expect(await count("visits")).toBe(3);
    const units = await pool.query<{ unit_number: string }>(
      `SELECT unit_number FROM households ORDER BY unit_number`,
    );
    expect(units.rows.map((row) => row.unit_number)).toEqual(["#05-123", "#06-201", "#07-301"]);
  });

  it("is stored trimmed when there is something in it", async () => {
    asAlice();
    expect((await recordVisit({ unitNumber: "  #08-401 " })).status).toBe(201);
    expect(
      await stored(`SELECT unit_number FROM households WHERE unit_number LIKE '%08-401%'`, []),
    ).toEqual({ unit_number: "#08-401" });
  });
});

describe("a blank follow-up note", () => {
  it("is refused by POST /follow-ups, for a member and an admin, and writes nothing", async () => {
    const before = await counts();
    for (const note of BLANKS) {
      for (const who of [asAlice, asAdmin]) {
        who();
        const response = await followUpsRoute.POST(
          json("POST", "/follow-ups", { householdId: HOUSEHOLD, note }),
        );
        expect(await refusal(response)).toMatchObject(refusedAt("/note"));
      }
    }
    expect(await counts()).toEqual(before);
  });

  it("is refused by PATCH /follow-ups/{id}, leaving the note as it was", async () => {
    // Ben has no right to change Alice's note: the blank is refused first,
    // as for anyone, and says nothing about the note.
    for (const who of [asAdmin, asAlice, asBen]) {
      for (const note of BLANKS) {
        who();
        const response = await followUpRoute.PATCH(
          json("PATCH", `/follow-ups/${NOTE}`, { note }),
          params(NOTE),
        );
        expect(await refusal(response)).toMatchObject(refusedAt("/note"));
      }
    }
    expect(
      await stored(`SELECT note, updated_at = created_at AS untouched FROM follow_ups`, []),
    ).toEqual({ note: "Bring the flyer", untouched: true });
  });
});

describe("a blank block name or street", () => {
  it("is refused by POST /blocks and PATCH /blocks/{id}, and changes nothing", async () => {
    asAdmin();
    const before = await counts();
    for (const blank of BLANKS) {
      for (const [field, body] of [
        ["/name", { name: blank, street: "Third Ave" }],
        ["/street", { name: "789", street: blank }],
      ] as const) {
        expect(await refusal(await blocksRoute.POST(json("POST", "/blocks", body)))).toMatchObject(
          refusedAt(field),
        );
        expect(
          await refusal(
            await blockRoute.PATCH(json("PATCH", `/blocks/${BLOCK}`, body), params(BLOCK)),
          ),
        ).toMatchObject(refusedAt(field));
      }
    }
    expect(await counts()).toEqual(before);
    expect(await stored(`SELECT name, street FROM blocks`, [])).toEqual({
      name: "123",
      street: "Test Ave",
    });
  });
});

describe("a name or contact of nothing but spaces", () => {
  const identity = () =>
    stored<{ name: string; contact: string }>(
      `SELECT name, contact FROM households WHERE id = $1`,
      [HOUSEHOLD],
    );

  it("is not learnt from a new visit, and what is learnt is stored trimmed", async () => {
    asAlice();
    expect((await recordVisit({ name: "   ", contact: " 　" })).status).toBe(201);
    expect(await identity()).toEqual({ name: "Tan", contact: "9000 0000" });

    expect((await recordVisit({ name: " Lim ", contact: "  " })).status).toBe(201);
    expect(await identity()).toEqual({ name: "Lim", contact: "9000 0000" });
  });

  it("is not learnt from an amendment either", async () => {
    asAlice();
    const amend = (body: Record<string, unknown>) =>
      visitRoute.PATCH(json("PATCH", `/visits/${VISIT}`, body), params(VISIT));

    expect((await amend({ name: "\t", contact: "   " })).status).toBe(200);
    expect(await identity()).toEqual({ name: "Tan", contact: "9000 0000" });

    expect((await amend({ contact: " 9123 4567 " })).status).toBe(200);
    expect(await identity()).toEqual({ name: "Tan", contact: "9123 4567" });
  });
});

describe("after every blank write was refused", () => {
  it("still answers the screens everyone shares", async () => {
    asAlice();
    await recordVisit({ unitNumber: "   " });
    await syncRoute.POST(
      json("POST", "/visits/sync", {
        sentAt: new Date().toISOString(),
        items: [syncItem({ unitNumber: " " })],
      }),
    );
    await followUpsRoute.POST(json("POST", "/follow-ups", { householdId: HOUSEHOLD, note: " " }));
    await followUpRoute.PATCH(json("PATCH", `/follow-ups/${NOTE}`, { note: " " }), params(NOTE));
    await syncVisits(
      getDatabase(),
      [syncItem({ unitNumber: "  " })],
      { id: ALICE, role: "member" },
      currentClock(),
    );

    const reads = [
      householdsRoute.GET(new Request(`https://test.local/api/households?blockId=${BLOCK}`)),
      householdRoute.GET(
        new Request(`https://test.local/api/households/${HOUSEHOLD}`),
        params(HOUSEHOLD),
      ),
      followUpsRoute.GET(new Request("https://test.local/api/follow-ups")),
    ];
    for (const response of await Promise.all(reads)) {
      expect(response.status).toBe(200);
    }
    // A draft's list is the admin's to check before starting it.
    asAdmin();
    const revisits = await revisitsRoute.GET(
      new Request(`https://test.local/api/sessions/${REVISIT}/revisits`),
      params(REVISIT),
    );
    expect(revisits.status).toBe(200);
    expect(await count("households")).toBe(1);
    expect(await count("follow_ups")).toBe(1);
  });
});
