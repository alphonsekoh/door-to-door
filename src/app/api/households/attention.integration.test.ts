import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET } = await import("./attention/route");

const pool = createTestPool();
const ADMIN = "abababab-0000-4000-8000-000000000001";
const ALICE = "abababab-0000-4000-8000-000000000002";
const BLOCK_A = "abababab-0000-4000-8001-000000000001";
const BLOCK_B = "abababab-0000-4000-8001-000000000002";
const MARCH = "abababab-0000-4000-8002-000000000001";
const JUNE = "abababab-0000-4000-8002-000000000002";

/* Named for what each unit is meant to prove. */
const KEEN = "abababab-0000-4000-8003-000000000001";
const COOLED = "abababab-0000-4000-8003-000000000002";
const WARMED = "abababab-0000-4000-8003-000000000003";
const CHASED = "abababab-0000-4000-8003-000000000004";
const DONE = "abababab-0000-4000-8003-000000000005";
const MIDDLING = "abababab-0000-4000-8003-000000000006";
const OTHER_BLOCK = "abababab-0000-4000-8003-000000000007";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asMember = () =>
  auth.mockResolvedValue({ user: { id: ALICE, role: "member", deactivated: false } });

const call = (q = "") => GET(new Request(`https://test.local/api/households/attention${q}`));

type Row = {
  household: { id: string; unitNumber: string };
  block: { name: string };
  latestVisit: { interestLevel: string };
  visitCount: number;
  lastVisitedAt: string;
};
const rows = async (response: Response) => ((await response.json()) as { data: Row[] }).data;
const units = async (response: Response) =>
  (await rows(response)).map((row) => row.household.unitNumber);

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
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
    `INSERT INTO households (id, block_id, unit_number) VALUES
      ($1,$8,'#01-01'), ($2,$8,'#02-02'), ($3,$8,'#03-03'),
      ($4,$8,'#04-04'), ($5,$8,'#05-05'), ($6,$8,'#06-06'), ($7,$9,'#07-07')`,
    [KEEN, COOLED, WARMED, CHASED, DONE, MIDDLING, OTHER_BLOCK, BLOCK_A, BLOCK_B],
  );

  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, created_at) VALUES
      -- high in March, never seen again: the case this list exists for
      ('01960000-0000-7000-8020-000000000001',$1,$8,$10,'high','2026-03-01T10:00:00Z'),
      -- high in March, declined in June: the last word is what counts
      ('01960000-0000-7000-8020-000000000002',$2,$8,$10,'high','2026-03-01T10:00:00Z'),
      ('01960000-0000-7000-8020-000000000003',$2,$9,$10,'low','2026-06-01T10:00:00Z'),
      -- silent in March, high in June: belongs on the list
      ('01960000-0000-7000-8020-000000000004',$3,$8,$10,'no_response','2026-03-01T10:00:00Z'),
      ('01960000-0000-7000-8020-000000000005',$3,$9,$10,'high','2026-06-01T10:00:00Z'),
      -- high, but someone already owes a follow-up
      ('01960000-0000-7000-8020-000000000006',$4,$8,$10,'high','2026-03-02T10:00:00Z'),
      -- high, and the follow-up was resolved: back on the list
      ('01960000-0000-7000-8020-000000000007',$5,$8,$10,'high','2026-03-03T10:00:00Z'),
      -- medium only
      ('01960000-0000-7000-8020-000000000008',$6,$8,$10,'medium','2026-03-04T10:00:00Z'),
      -- high on the other block
      ('01960000-0000-7000-8020-000000000009',$7,$8,$10,'high','2026-03-05T10:00:00Z')`,
    [KEEN, COOLED, WARMED, CHASED, DONE, MIDDLING, OTHER_BLOCK, MARCH, JUNE, ALICE],
  );

  await pool.query(
    `INSERT INTO follow_ups (id, household_id, author_id, note, done_at) VALUES
      ('abababab-0000-4000-8004-000000000001',$1,$3,'Bring the book back',null),
      ('abababab-0000-4000-8004-000000000002',$2,$3,'Already done',now())`,
    [CHASED, DONE, ALICE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("GET /api/households/attention", () => {
  it("refuses a member", async () => {
    asMember();
    expect((await call()).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("lists a door that said yes and was never gone back to", async () => {
    asAdmin();
    expect(await units(await call())).toContain("#01-01");
  });

  it("leaves out a household whose interest has since cooled", async () => {
    // High in March, low in June. The last thing it said is what matters.
    asAdmin();
    expect(await units(await call())).not.toContain("#02-02");
  });

  it("includes a household that only became interested later", async () => {
    asAdmin();
    expect(await units(await call())).toContain("#03-03");
  });

  it("leaves out a household somebody already owes a follow-up", async () => {
    // It is already someone's job; repeating it makes the list scrollable-past.
    asAdmin();
    expect(await units(await call())).not.toContain("#04-04");
  });

  it("brings back a household once its follow-up is resolved", async () => {
    asAdmin();
    expect(await units(await call())).toContain("#05-05");
  });

  it("counts only high interest by default", async () => {
    asAdmin();
    expect(await units(await call())).not.toContain("#06-06");
  });

  it("widens to medium when asked", async () => {
    asAdmin();
    expect(await units(await call("?minimumInterest=medium"))).toContain("#06-06");
  });

  it("still excludes low and no-response when widened", async () => {
    asAdmin();
    const listed = await units(await call("?minimumInterest=medium"));
    expect(listed).not.toContain("#02-02");
  });

  it("puts the longest-neglected door first", async () => {
    asAdmin();
    const listed = await units(await call());
    expect(listed[0]).toBe("#01-01");
    expect(listed.at(-1)).toBe("#03-03");
  });

  it("narrows to a block", async () => {
    asAdmin();
    const listed = await units(await call(`?blockId=${BLOCK_B}`));
    expect(listed).toEqual(["#07-07"]);
  });

  it("carries the block, the visit and how many times the door was knocked", async () => {
    asAdmin();
    const [first] = await rows(await call(`?blockId=${BLOCK_B}`));
    expect(first?.block.name).toBe("125");
    expect(first?.latestVisit.interestLevel).toBe("high");
    expect(first?.visitCount).toBe(1);
    expect(first?.lastVisitedAt).toBe("2026-03-05T10:00:00.000Z");
  });

  it("counts every visit to the door, not only the qualifying one", async () => {
    asAdmin();
    const listed = await rows(await call());
    expect(listed.find((row) => row.household.unitNumber === "#03-03")?.visitCount).toBe(2);
  });

  it("counts what the filter matched when paginating", async () => {
    asAdmin();
    const body = (await (await call("?limit=1")).json()) as {
      data: unknown[];
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 4, hasMore: true });
  });

  it("rejects an interest level outside the contract", async () => {
    asAdmin();
    expect((await call("?minimumInterest=warm")).status).toBe(400);
  });

  it("treats a level that is not interest as high, rather than lying", async () => {
    // The enum has four values; only two of them mean interest.
    asAdmin();
    expect(await units(await call("?minimumInterest=no_response"))).not.toContain("#06-06");
  });
});
