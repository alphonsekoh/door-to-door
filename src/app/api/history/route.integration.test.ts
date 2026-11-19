import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET: allHistory } = await import("./route");
const { GET: ownHistory } = await import("./mine/route");

const pool = createTestPool();
const ADMIN = "badbadba-0000-4000-8000-000000000001";
const ALICE = "badbadba-0000-4000-8000-000000000002";
const BEN = "badbadba-0000-4000-8000-000000000003";
const BLOCK_A = "badbadba-0000-4000-8001-000000000001";
const BLOCK_B = "badbadba-0000-4000-8001-000000000002";
const MARCH = "badbadba-0000-4000-8002-000000000001";
const JUNE = "badbadba-0000-4000-8002-000000000002";
const H_A = "badbadba-0000-4000-8003-000000000001";
const H_B = "badbadba-0000-4000-8003-000000000002";

const asAdmin = () => auth.mockImplementation(() => signedInAs(pool, { id: ADMIN, role: "admin" }));
const asAlice = () =>
  auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));

const all = (q = "") => allHistory(new Request(`https://test.local/api/history${q}`));
const mine = (q = "") => ownHistory(new Request(`https://test.local/api/history/mine${q}`));

type Entry = {
  visit: { interestLevel: string; member: { name: string } };
  household: { unitNumber: string; religion: string | null };
  block: { name: string };
  session: { title: string; createdBy: { name: string } };
};
const entries = async (response: Response) => ((await response.json()) as { data: Entry[] }).data;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'), ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave'), ($2,'125','Test Ave')`,
    [BLOCK_A, BLOCK_B],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES
      ($1,'March outing','ended',$3), ($2,'June outing','ended',$3)`,
    [MARCH, JUNE, ADMIN],
  );
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number, religion) VALUES
      ($1,$3,'#05-123','buddhist'), ($2,$4,'#03-45','christian')`,
    [H_A, H_B, BLOCK_A, BLOCK_B],
  );
  /* Alice in March on block A, Ben in June on block B. */
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, created_at) VALUES
      ('01960000-0000-7000-8000-00000000d001',$1,$3,$5,'low','2026-03-14T10:00:00Z'),
      ('01960000-0000-7000-8000-00000000d002',$1,$4,$5,'high','2026-06-20T10:00:00Z'),
      ('01960000-0000-7000-8000-00000000d003',$2,$4,$6,'medium','2026-06-20T11:00:00Z')`,
    [H_A, H_B, MARCH, JUNE, ALICE, BEN],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("a member cannot reach the consolidated view", () => {
  it("refuses a member outright", async () => {
    asAlice();
    expect((await all()).status).toBe(403);
  });

  it("refuses a member even naming their own id", async () => {
    // The operation is admin-only; there is no combination that opens it.
    asAlice();
    expect((await all(`?memberId=${ALICE}`)).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await all()).status).toBe(401);
  });
});

describe("/history/mine is scoped by the session, not the request", () => {
  it("returns only the caller's records", async () => {
    asAlice();
    const data = await entries(await mine());
    expect(data).toHaveLength(2);
    expect(new Set(data.map((e) => e.visit.member.name))).toEqual(new Set(["Alice"]));
  });

  it("ignores a memberId in the query, since there is none to give", async () => {
    /*
     * The contract has no memberId on this operation. Passing one must not
     * widen the result - it is simply not read.
     */
    asAlice();
    const data = await entries(await mine(`?memberId=${BEN}`));
    expect(new Set(data.map((e) => e.visit.member.name))).toEqual(new Set(["Alice"]));
  });

  it("is available to an admin too, showing their own records", async () => {
    asAdmin();
    expect(await entries(await mine())).toHaveLength(0);
  });
});

describe("the consolidated view", () => {
  it("returns every member's records, newest first", async () => {
    asAdmin();
    const data = await entries(await all());
    expect(data).toHaveLength(3);
    expect(data[0]?.visit.interestLevel).toBe("medium");
  });

  it("carries the household, block and session with each visit", async () => {
    // So the screen can say "Alice, #05-123, Blk 123, March outing".
    asAdmin();
    const [first] = await entries(await all("?interestLevel=low"));
    expect(first?.household.unitNumber).toBe("#05-123");
    expect(first?.block.name).toBe("123");
    expect(first?.session.title).toBe("March outing");
    expect(first?.session.createdBy.name).toBe("Admin");
  });
});

describe("filters", () => {
  beforeEach(() => {
    asAdmin();
  });

  it.each([
    ["member", `?memberId=${BEN}`, 1],
    ["block", `?blockId=${BLOCK_A}`, 2],
    ["session", `?sessionId=${MARCH}`, 1],
    ["interest level", "?interestLevel=high", 1],
    ["religion", "?religion=christian", 1],
    ["from", "?from=2026-06-01T00:00:00.000Z", 2],
    ["to", "?to=2026-04-01T00:00:00.000Z", 1],
  ])("filters by %s", async (_name, query, expected) => {
    expect(await entries(await all(query))).toHaveLength(expected);
  });

  it("composes several filters", async () => {
    // Block A, in June, high interest: one of the three.
    const data = await entries(
      await all(`?blockId=${BLOCK_A}&sessionId=${JUNE}&interestLevel=high`),
    );
    expect(data).toHaveLength(1);
    expect(data[0]?.visit.member.name).toBe("Alice");
  });

  it("returns nothing when filters exclude everything", async () => {
    expect(await entries(await all(`?blockId=${BLOCK_B}&interestLevel=low`))).toHaveLength(0);
  });

  it("narrows a date range from both ends", async () => {
    const data = await entries(
      await all("?from=2026-06-20T10:30:00.000Z&to=2026-06-20T11:30:00.000Z"),
    );
    expect(data).toHaveLength(1);
    expect(data[0]?.visit.member.name).toBe("Ben");
  });

  it("rejects an interest level outside the contract", async () => {
    expect((await all("?interestLevel=maybe")).status).toBe(400);
  });

  it("paginates", async () => {
    const body = (await (await all("?limit=2")).json()) as {
      data: unknown[];
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toMatchObject({ total: 3, hasMore: true });
  });

  it("lists every record once, in id order, across a page edge inside a tie (#212)", async () => {
    const tied = (n: number) => `01960000-0000-7000-8000-00000000f00${String(n)}`;
    // Stored neither in id order nor its reverse, so only the id puts them
    // 3, 2, 1, and a page of three ends between the first and the second.
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, created_at)
       VALUES ($1,$4,$5,$6,'low',$7), ($2,$4,$5,$6,'low',$7), ($3,$4,$5,$6,'low',$7)`,
      [tied(2), tied(3), tied(1), H_B, JUNE, BEN, "2026-05-01T10:00:00Z"],
    );

    const ids = async (offset: string) => {
      const body = (await (await all(`?limit=3&offset=${offset}`)).json()) as {
        data: { visit: { id: string } }[];
      };
      return body.data.map((entry) => entry.visit.id);
    };
    expect([...(await ids("0")), ...(await ids("3"))]).toEqual([
      "01960000-0000-7000-8000-00000000d003",
      "01960000-0000-7000-8000-00000000d002",
      tied(3),
      tied(2),
      tied(1),
      "01960000-0000-7000-8000-00000000d001",
    ]);
  });
});

describe("filters on /history/mine", () => {
  it("narrows within the caller's own records", async () => {
    asAlice();
    const data = await entries(await mine(`?sessionId=${MARCH}`));
    expect(data).toHaveLength(1);
    expect(data[0]?.visit.interestLevel).toBe("low");
  });

  it("filters by interest level", async () => {
    asAlice();
    expect(await entries(await mine("?interestLevel=high"))).toHaveLength(1);
  });

  it("filters by block", async () => {
    asAlice();
    expect(await entries(await mine(`?blockId=${BLOCK_B}`))).toHaveLength(0);
  });

  it("filters by date range", async () => {
    asAlice();
    expect(await entries(await mine("?from=2026-06-01T00:00:00.000Z"))).toHaveLength(1);
  });

  it("filters by an upper date bound", async () => {
    asAlice();
    expect(await entries(await mine("?to=2026-04-01T00:00:00.000Z"))).toHaveLength(1);
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await mine()).status).toBe(401);
  });
});
