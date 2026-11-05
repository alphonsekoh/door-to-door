import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET } = await import("./mine/sessions/route");

const pool = createTestPool();
const ADMIN = "badbadba-0000-4000-8010-000000000001";
const ALICE = "badbadba-0000-4000-8010-000000000002";
const BEN = "badbadba-0000-4000-8010-000000000003";
const BLOCK_A = "badbadba-0000-4000-8011-000000000001";
const BLOCK_B = "badbadba-0000-4000-8011-000000000002";
const MARCH = "badbadba-0000-4000-8012-000000000001";
const JUNE = "badbadba-0000-4000-8012-000000000002";
const H_A1 = "badbadba-0000-4000-8013-000000000001";
const H_A2 = "badbadba-0000-4000-8013-000000000002";
const H_B1 = "badbadba-0000-4000-8013-000000000003";

const asAdmin = () => auth.mockImplementation(() => signedInAs(pool, { id: ADMIN, role: "admin" }));
const asAlice = () =>
  auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));

const call = (q = "") => GET(new Request(`https://test.local/api/history/mine/sessions${q}`));

type Summary = {
  session: { id: string; title: string };
  blocks: { name: string }[];
  visitCount: number;
  householdCount: number;
  interest: { low: number; medium: number; high: number; noResponse: number };
  firstRecordedAt: string;
  lastRecordedAt: string;
};

const summaries = async (response: Response) =>
  ((await response.json()) as { data: Summary[] }).data;

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
    `INSERT INTO households (id, block_id, unit_number) VALUES
      ($1,$4,'#05-123'), ($2,$4,'#05-124'), ($3,$5,'#03-45')`,
    [H_A1, H_A2, H_B1, BLOCK_A, BLOCK_B],
  );
  /*
   * March: Alice records two units on block A, revisiting one of them.
   * June: Alice works both blocks; Ben works block B alone.
   */
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, created_at) VALUES
      ('01960000-0000-7000-8010-00000000e001',$1,$4,$6,'low',   '2026-03-14T10:00:00Z'),
      ('01960000-0000-7000-8010-00000000e002',$2,$4,$6,'no_response','2026-03-14T10:20:00Z'),
      ('01960000-0000-7000-8010-00000000e003',$1,$4,$6,'medium','2026-03-14T11:00:00Z'),
      ('01960000-0000-7000-8010-00000000e004',$2,$5,$6,'high',  '2026-06-20T10:00:00Z'),
      ('01960000-0000-7000-8010-00000000e005',$3,$5,$6,'low',   '2026-06-20T10:30:00Z'),
      ('01960000-0000-7000-8010-00000000e006',$3,$5,$7,'high',  '2026-06-20T12:00:00Z')`,
    [H_A1, H_A2, H_B1, MARCH, JUNE, ALICE, BEN],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("the outings a member worked", () => {
  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("lists one row per outing, newest first", async () => {
    asAlice();
    const data = await summaries(await call());
    expect(data.map((row) => row.session.title)).toEqual(["June outing", "March outing"]);
  });

  it("counts the member's own records, not the outing's", async () => {
    // Ben also recorded in June; his visit must not inflate Alice's numbers.
    asAlice();
    const [june] = await summaries(await call());
    expect(june?.visitCount).toBe(2);
    expect(june?.interest).toEqual({ low: 1, medium: 0, high: 1, noResponse: 0 });
  });

  it("separates visits from distinct units, so a revisit is not a second door", async () => {
    asAlice();
    const march = (await summaries(await call())).at(-1);
    expect(march?.visitCount).toBe(3);
    expect(march?.householdCount).toBe(2);
  });

  it("counts no-response as an outcome rather than a gap", async () => {
    asAlice();
    const march = (await summaries(await call())).at(-1);
    expect(march?.interest).toEqual({ low: 1, medium: 1, high: 0, noResponse: 1 });
  });

  it("lists the blocks the member worked, and only those", async () => {
    asAlice();
    const data = await summaries(await call());
    expect(data[0]?.blocks.map((block) => block.name)).toEqual(["123", "125"]);
    expect(data[1]?.blocks.map((block) => block.name)).toEqual(["123"]);
  });

  it("reports when the member started and finished, not the outing's own dates", async () => {
    // The outing was never started, so its startedAt is null; the member's
    // own first and last record are what the screen has to show.
    asAlice();
    const march = (await summaries(await call())).at(-1);
    expect(march?.firstRecordedAt).toBe("2026-03-14T10:00:00.000Z");
    expect(march?.lastRecordedAt).toBe("2026-03-14T11:00:00.000Z");
  });

  it("shows a member with no history an empty list, not an error", async () => {
    asAdmin();
    const response = await call();
    expect(response.status).toBe(200);
    expect(await summaries(response)).toEqual([]);
  });

  it("counts outings, not visits, when paginating", async () => {
    asAlice();
    const body = (await (await call("?limit=1")).json()) as {
      data: unknown[];
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 2, hasMore: true });
  });

  it("pages through to the end", async () => {
    asAlice();
    const body = (await (await call("?limit=1&offset=1")).json()) as {
      data: Summary[];
      pagination: { hasMore: boolean };
    };
    expect(body.data[0]?.session.title).toBe("March outing");
    expect(body.pagination.hasMore).toBe(false);
  });

  it("rejects a limit outside the contract", async () => {
    asAlice();
    expect((await call("?limit=500")).status).toBe(400);
  });
});
