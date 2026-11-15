import type * as ConfigModule from "@/server/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

/* The database client reads its URL from the same config, so only the tolerance is overridden. */
const tolerance = vi.hoisted(() => ({ seconds: 300 }));
vi.mock("@/server/config", async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>();
  return {
    ...actual,
    getConfig: () => {
      const config = actual.getConfig();
      return { ...config, sync: { ...config.sync, clockSkewToleranceSeconds: tolerance.seconds } };
    },
  };
});

const { GET, POST } = await import("./route");
const { PATCH } = await import("./[id]/route");
const { GET: listHouseholdsRoute } = await import("../households/route");
const { GET: householdHistory } = await import("../households/[id]/route");
const { POST: sync } = await import("./sync/route");
const { recordLimiter, syncLimiter } = await import("@/server/visits/rate-limits");

const pool = createTestPool();
const ADMIN = "dededede-0000-4000-8000-000000000001";
const ALICE = "dededede-0000-4000-8000-000000000002";
const BEN = "dededede-0000-4000-8000-000000000003";
const BLOCK = "dededede-0000-4000-8001-000000000001";
const SESSION = "dededede-0000-4000-8002-000000000001";

const asAdmin = () => auth.mockImplementation(() => signedInAs(pool, { id: ADMIN, role: "admin" }));
const asAlice = () =>
  auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));
const asBen = () => auth.mockImplementation(() => signedInAs(pool, { id: BEN, role: "member" }));

let seq = 0;
const nextId = () => `01960000-0000-7000-8000-${String(++seq).padStart(12, "0")}`;

const post = (body: unknown) =>
  POST(
    new Request("https://test.local/api/visits", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`https://test.local/api/visits/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );

const record = (unit: string, extra: Record<string, unknown> = {}) =>
  post({ id: nextId(), blockId: BLOCK, unitNumber: unit, interestLevel: "low", ...extra });

beforeEach(async () => {
  seq = 0;
  tolerance.seconds = 300;
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'), ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Outing','active',$2)`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  vi.clearAllMocks();
  recordLimiter.reset();
  syncLimiter.reset();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("POST /api/visits", () => {
  it("records a visit and creates the household", async () => {
    asAlice();
    const response = await record("#05-123", { name: "Mr Tan", religion: "buddhist" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { interestLevel: string; member: { name: string } };
    expect(body).toMatchObject({ interestLevel: "low", member: { name: "Alice" } });
  });

  it("takes two fields for a silent door", async () => {
    // The most common outcome must be the cheapest to record.
    asAlice();
    const response = await post({
      id: nextId(),
      blockId: BLOCK,
      unitNumber: "#06-201",
      interestLevel: "no_response",
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { description: string }).description).toBe("");
  });

  it("rejects a missing unit number with 400", async () => {
    asAlice();
    const response = await post({ id: nextId(), blockId: BLOCK, interestLevel: "low" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { details: { path: string }[] } };
    expect(body.error.details.map((d) => d.path)).toContain("/unitNumber");
  });

  it("rejects a non-uuid visit id with 400", async () => {
    asAlice();
    expect(
      (await post({ id: "nope", blockId: BLOCK, unitNumber: "#01-01", interestLevel: "low" }))
        .status,
    ).toBe(400);
  });

  it("returns 409 for a duplicate id", async () => {
    asAlice();
    const id = nextId();
    const args = { id, blockId: BLOCK, unitNumber: "#05-123", interestLevel: "low" };
    await post(args);
    expect((await post(args)).status).toBe(409);
  });

  it("returns 404 for an unknown block", async () => {
    asAlice();
    expect(
      (
        await post({
          id: nextId(),
          blockId: "dededede-0000-4000-8001-00000000ffff",
          unitNumber: "#01-01",
          interestLevel: "low",
        })
      ).status,
    ).toBe(404);
  });

  it("returns 409 when no session is active", async () => {
    await pool.query(`UPDATE outing_sessions SET status='ended' WHERE id=$1`, [SESSION]);
    asAlice();
    const response = await record("#05-123");
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("session_not_active");
  });

  it("accepts clientCreatedAt within the tolerance ahead and refuses beyond it", async () => {
    asAlice();
    const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
    expect((await record("#05-120", { clientCreatedAt: ahead(240_000) })).status).toBe(201);

    const response = await record("#05-121", { clientCreatedAt: ahead(3_600_000) });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("clock_skew");
    expect(body.error.message).toMatch(/minutes ahead/);
    const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM visits`);
    expect(rows[0]?.count).toBe("1");
  });

  it("follows the configured tolerance for clientCreatedAt", async () => {
    asAlice();
    tolerance.seconds = 7200;
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    expect((await record("#05-122", { clientCreatedAt: ahead })).status).toBe(201);
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await record("#05-123")).status).toBe(401);
  });
});

describe("PATCH /api/visits/{id}", () => {
  const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;

  it("amends a member's own record", async () => {
    asAlice();
    const id = await idOf(await record("#05-123"));
    const response = await patch(id, { interestLevel: "high" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { interestLevel: string }).interestLevel).toBe("high");
  });

  it("refuses a member amending another member's record", async () => {
    asAlice();
    const id = await idOf(await record("#05-123"));
    asBen();
    expect((await patch(id, { interestLevel: "high" })).status).toBe(403);
  });

  it("lets an admin amend anyone's record", async () => {
    asAlice();
    const id = await idOf(await record("#05-123"));
    asAdmin();
    expect((await patch(id, { description: "Corrected" })).status).toBe(200);
  });

  it("rejects an empty body with 400, not a database error", async () => {
    asAlice();
    const id = await idOf(await record("#05-123"));
    expect((await patch(id, {})).status).toBe(400);
  });

  it("returns 404 for an unknown visit", async () => {
    asAdmin();
    expect((await patch("01960000-0000-7000-8000-0000000000ff", { description: "x" })).status).toBe(
      404,
    );
  });
});

describe("GET /api/visits", () => {
  it("scopes a member to their own records", async () => {
    asAlice();
    await record("#05-123");
    asBen();
    await record("#06-201");

    asAlice();
    const body = (await (await GET(new Request("https://test.local/api/visits"))).json()) as {
      data: { member: { name: string } }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.member.name).toBe("Alice");
  });

  it("refuses a member asking for someone else's records", async () => {
    // No parameter combination may widen a member's view.
    asAlice();
    const response = await GET(new Request(`https://test.local/api/visits?memberId=${BEN}`));
    expect(response.status).toBe(403);
  });

  it("lets an admin see everyone's", async () => {
    asAlice();
    await record("#05-123");
    asBen();
    await record("#06-201");

    asAdmin();
    const body = (await (await GET(new Request("https://test.local/api/visits"))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(2);
  });

  it("lets an admin filter to one member", async () => {
    asAlice();
    await record("#05-123");
    asBen();
    await record("#06-201");

    asAdmin();
    const body = (await (
      await GET(new Request(`https://test.local/api/visits?memberId=${BEN}`))
    ).json()) as { data: { member: { name: string } }[] };
    expect(body.data.map((v) => v.member.name)).toEqual(["Ben"]);
  });

  it("filters by session", async () => {
    asAlice();
    await record("#05-123");
    const body = (await (
      await GET(new Request(`https://test.local/api/visits?sessionId=${SESSION}`))
    ).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("filters by household", async () => {
    asAlice();
    const created = (await (await record("#05-123")).json()) as { householdId: string };
    await record("#06-201");

    const body = (await (
      await GET(new Request(`https://test.local/api/visits?householdId=${created.householdId}`))
    ).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("filters by block", async () => {
    asAlice();
    await record("#05-123");
    const body = (await (
      await GET(new Request(`https://test.local/api/visits?blockId=${BLOCK}`))
    ).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe("households over HTTP", () => {
  it("lists a block's units with their latest visit", async () => {
    asAlice();
    await record("#05-123", { interestLevel: "medium" });
    const response = await listHouseholdsRoute(
      new Request(`https://test.local/api/households?blockId=${BLOCK}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { household: { unitNumber: string }; latestVisit: { interestLevel: string } }[];
    };
    expect(body.data[0]?.household.unitNumber).toBe("#05-123");
    expect(body.data[0]?.latestVisit.interestLevel).toBe("medium");
  });

  it("scopes the unit list to one session", async () => {
    // The block unit list shows tonight's work, not everything ever recorded.
    asAlice();
    await record("#05-123");
    const response = await listHouseholdsRoute(
      new Request(`https://test.local/api/households?blockId=${BLOCK}&sessionId=${SESSION}`),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: unknown[] }).data).toHaveLength(1);
  });

  it("lists a unit that has no visits in the scope, with a null latest visit", async () => {
    asAlice();
    await record("#05-123");
    await pool.query(`INSERT INTO households (block_id, unit_number) VALUES ($1, '#09-99')`, [
      BLOCK,
    ]);

    const body = (await (
      await listHouseholdsRoute(new Request(`https://test.local/api/households?blockId=${BLOCK}`))
    ).json()) as { data: { household: { unitNumber: string }; latestVisit: unknown }[] };

    const untouched = body.data.find((d) => d.household.unitNumber === "#09-99");
    expect(untouched?.latestVisit).toBeNull();
  });

  it("requires a blockId", async () => {
    asAlice();
    expect(
      (await listHouseholdsRoute(new Request("https://test.local/api/households"))).status,
    ).toBe(400);
  });

  it("returns a unit's timeline, newest first", async () => {
    asAlice();
    const created = (await (await record("#05-123", { name: "Mr Tan" })).json()) as {
      householdId: string;
    };
    asBen();
    await record("#05-123", { interestLevel: "high" });

    asAlice();
    const response = await householdHistory(
      new Request(`https://test.local/api/households/${created.householdId}`),
      { params: Promise.resolve({ id: created.householdId }) },
    );
    const body = (await response.json()) as {
      household: { name: string };
      block: { name: string };
      visits: { interestLevel: string }[];
    };
    expect(body.household.name).toBe("Mr Tan");
    expect(body.block.name).toBe("123");
    expect(body.visits.map((v) => v.interestLevel)).toEqual(["high", "low"]);
  });

  it("names the door on each follow-up in a unit's timeline", async () => {
    asAlice();
    const created = (await (await record("#05-123")).json()) as { householdId: string };
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Todo')`,
      [created.householdId, ALICE],
    );
    const response = await householdHistory(
      new Request(`https://test.local/api/households/${created.householdId}`),
      { params: Promise.resolve({ id: created.householdId }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { followUps: unknown[] };
    expect(body.followUps).toEqual([
      expect.objectContaining({ blockName: "123", unitNumber: "#05-123", note: "Todo" }),
    ]);
  });

  it("returns 404 for an unknown household", async () => {
    asAlice();
    const missing = "dededede-0000-4000-8003-00000000ffff";
    expect(
      (
        await householdHistory(new Request(`https://test.local/api/households/${missing}`), {
          params: Promise.resolve({ id: missing }),
        })
      ).status,
    ).toBe(404);
  });
});

describe("recording on someone else's behalf", () => {
  it("lets an admin attribute a visit to a member", async () => {
    // A record phoned in, or captured on paper, belongs to whoever knocked.
    asAdmin();
    const response = await post({
      id: nextId(),
      blockId: BLOCK,
      unitNumber: "#09-01",
      interestLevel: "high",
      memberId: ALICE,
    });

    expect(response.status).toBe(201);
    const visit = (await response.json()) as { member: { id: string; name: string } };
    expect(visit.member.id).toBe(ALICE);
  });

  it("refuses a member attributing a visit to anyone else", async () => {
    asBen();
    const response = await post({
      id: nextId(),
      blockId: BLOCK,
      unitNumber: "#09-02",
      interestLevel: "low",
      memberId: ALICE,
    });

    expect(response.status).toBe(403);
  });

  it("lets a member name themselves, since that changes nothing", async () => {
    asAlice();
    const response = await post({
      id: nextId(),
      blockId: BLOCK,
      unitNumber: "#09-03",
      interestLevel: "low",
      memberId: ALICE,
    });

    expect(response.status).toBe(201);
  });

  it("still attributes to the caller when no member is named", async () => {
    asBen();
    const response = await post({
      id: nextId(),
      blockId: BLOCK,
      unitNumber: "#09-04",
      interestLevel: "medium",
    });

    const visit = (await response.json()) as { member: { id: string } };
    expect(visit.member.id).toBe(BEN);
  });

  it("rejects a member id that does not exist", async () => {
    // A foreign-key crash would surface a constraint name, not a message.
    asAdmin();
    const response = await post({
      id: nextId(),
      blockId: BLOCK,
      unitNumber: "#09-05",
      interestLevel: "low",
      memberId: "dededede-0000-4000-8000-0000000000ff",
    });

    expect(response.status).toBe(404);
    expect((await response.json()) as { error: { message: string } }).toMatchObject({
      error: { message: "No such member." },
    });
  });

  describe("naming a deactivated member", () => {
    const forAlice = () =>
      post({
        id: nextId(),
        blockId: BLOCK,
        unitNumber: "#09-07",
        interestLevel: "high",
        name: "Mr Lim",
        memberId: ALICE,
      });
    const written = async () => ({
      visits: (await pool.query(`SELECT 1 FROM visits WHERE member_id = $1`, [ALICE])).rows.length,
      households: (await pool.query(`SELECT 1 FROM households WHERE unit_number = '#09-07'`)).rows
        .length,
      participants: (
        await pool.query(`SELECT 1 FROM session_participants WHERE user_id = $1`, [ALICE])
      ).rows.length,
    });

    beforeEach(async () => {
      await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]);
      asAdmin();
    });

    it("is refused with 409, and nothing is written", async () => {
      const response = await forAlice();

      expect(response.status).toBe(409);
      expect((await response.json()) as { error: { code: string; message: string } }).toEqual({
        error: { code: "conflict", message: "That member's account is deactivated." },
      });
      expect(await written()).toEqual({ visits: 0, households: 0, participants: 0 });
    });

    it("is recorded once the member is restored", async () => {
      await pool.query(`UPDATE users SET deactivated_at = NULL WHERE id = $1`, [ALICE]);

      expect((await forAlice()).status).toBe(201);
      expect(await written()).toEqual({ visits: 1, households: 1, participants: 1 });
    });
  });

  it("does not reassign authorship when an admin later amends the record", async () => {
    asAdmin();
    const id = nextId();
    await post({
      id,
      blockId: BLOCK,
      unitNumber: "#09-06",
      interestLevel: "low",
      memberId: ALICE,
    });

    const amended = await patch(id, { interestLevel: "high" });
    const visit = (await amended.json()) as { member: { id: string } };
    expect(visit.member.id).toBe(ALICE);
  });
});

describe("the rate limit on recording (#126)", () => {
  const visitsStored = async () =>
    Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM visits`)).rows[0]?.n);
  const thirty = async (memberId?: string) => {
    for (let i = 0; i < 30; i += 1) {
      const unit = `#01-${String(i).padStart(3, "0")}`;
      const response = await record(unit, memberId === undefined ? {} : { memberId });
      expect(response.status).toBe(201);
    }
  };

  it("refuses the 31st visit in a minute from one caller, and records nothing", async () => {
    asAlice();
    await thirty();

    const refused = await record("#09-999");
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({
      code: "rate_limited",
      message: "Too many visits recorded. Try again shortly.",
    });
    expect(await visitsStored()).toBe(30);
  });

  it("leaves another member, and the caller's own sync, their own budgets", async () => {
    asAlice();
    await thirty();
    expect((await record("#09-999")).status).toBe(429);

    asBen();
    expect((await record("#09-998")).status).toBe(201);

    // The queue is the same member's other way in: it is not starved (D-126-8).
    await pool.query(`UPDATE outing_sessions SET started_at = now() - interval '1 hour'`);
    asAlice();
    const flushed = await sync(
      new Request("https://test.local/api/visits/sync", {
        method: "POST",
        body: JSON.stringify({
          sentAt: new Date().toISOString(),
          items: [
            {
              id: nextId(),
              blockId: BLOCK,
              unitNumber: "#09-999",
              interestLevel: "low",
              clientCreatedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(flushed.status).toBe(200);
    expect(((await flushed.json()) as { results: { status: string }[] }).results).toEqual([
      expect.objectContaining({ status: "applied" }),
    ]);
  });

  it("charges an admin recording on a member's behalf, not the member", async () => {
    asAdmin();
    await thirty(ALICE);
    expect((await record("#09-999", { memberId: ALICE })).status).toBe(429);

    asAlice();
    expect((await record("#09-999")).status).toBe(201);
  });
});
