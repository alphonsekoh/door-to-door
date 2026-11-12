import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET: listHouseholds } = await import("./route");
const { GET: history } = await import("./[id]/route");
const { GET: attention } = await import("./attention/route");

/*
 * What a household's screens make of suggestions and removed notes: a
 * suggestion is shown but owes nothing, and a removed note is gone everywhere.
 */

const pool = createTestPool();
const ADMIN = "b9b9b9b9-0000-4000-8000-000000000001";
const ALICE = "b9b9b9b9-0000-4000-8000-000000000002";
const BLOCK = "b9b9b9b9-0000-4000-8001-000000000001";
const PAST = "b9b9b9b9-0000-4000-8002-000000000001";

/* Named for the notes each one carries. */
const LISTED = "b9b9b9b9-0000-4000-8003-000000000001";
const SUGGESTED = "b9b9b9b9-0000-4000-8003-000000000002";
const REMOVED = "b9b9b9b9-0000-4000-8003-000000000003";
const DISMISSED = "b9b9b9b9-0000-4000-8003-000000000004";
const RESOLVED = "b9b9b9b9-0000-4000-8003-000000000005";

const asAdmin = () => auth.mockImplementation(() => signedInAs(pool, { id: ADMIN, role: "admin" }));
const asAlice = () =>
  auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, started_at, ended_at, created_by)
     VALUES ($1,'March','ended', now() - interval '30 days', now() - interval '29 days', $2)`,
    [PAST, ADMIN],
  );
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number) VALUES
      ($1,$6,'#01-01'), ($2,$6,'#02-02'), ($3,$6,'#03-03'), ($4,$6,'#04-04'), ($5,$6,'#05-05')`,
    [LISTED, SUGGESTED, REMOVED, DISMISSED, RESOLVED, BLOCK],
  );
  // Every door said yes, so only its notes decide whether it needs attention.
  for (const [i, household] of [LISTED, SUGGESTED, REMOVED, DISMISSED, RESOLVED].entries()) {
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
       VALUES ($1,$2,$3,$4,'high')`,
      [`01960000-0000-7000-8000-${String(0xb900 + i).padStart(12, "0")}`, household, PAST, ALICE],
    );
  }
  await pool.query(
    `INSERT INTO follow_ups (household_id, author_id, status, note, done_at, deleted_at, deleted_by, delete_reason) VALUES
      ($1,$6,'listed','On the list', null, null, null, null),
      ($2,$7,'suggested','Waiting for review', null, null, null, null),
      ($3,$6,'listed','Taken off', null, now(), $6, null),
      ($4,$7,'suggested','Declined', null, now(), $6, 'Already visited'),
      ($5,$6,'listed','Done', now(), null, null, null)`,
    [LISTED, SUGGESTED, REMOVED, DISMISSED, RESOLVED, ADMIN, ALICE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

const notesAt = async (householdId: string) => {
  const response = await history(new Request(`https://test.local/api/households/${householdId}`), {
    params: Promise.resolve({ id: householdId }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { followUps: { note: string; status: string }[] }).followUps;
};

describe("a household's history", () => {
  it("shows a pending suggestion to every member, as a suggestion", async () => {
    asAlice();
    expect(await notesAt(SUGGESTED)).toEqual([
      expect.objectContaining({ note: "Waiting for review", status: "suggested" }),
    ]);
  });

  it("leaves removed notes out", async () => {
    asAlice();
    expect(await notesAt(REMOVED)).toEqual([]);
    expect(await notesAt(DISMISSED)).toEqual([]);
  });
});

describe("the outstanding count on a block's households", () => {
  it("counts only listed notes nobody has resolved or removed", async () => {
    asAlice();
    const response = await listHouseholds(
      new Request(`https://test.local/api/households?blockId=${BLOCK}`),
    );
    const body = (await response.json()) as {
      data: { household: { unitNumber: string }; outstandingFollowUps: number }[];
    };
    expect(
      Object.fromEntries(
        body.data.map((row) => [row.household.unitNumber, row.outstandingFollowUps]),
      ),
    ).toEqual({ "#01-01": 1, "#02-02": 0, "#03-03": 0, "#04-04": 0, "#05-05": 0 });
  });
});

describe("the households needing a return visit", () => {
  it("leaves out a household on the list or with a suggestion waiting", async () => {
    // Removed and resolved notes ask nothing, so those doors are back.
    asAdmin();
    const response = await attention(new Request("https://test.local/api/households/attention"));
    const body = (await response.json()) as { data: { household: { unitNumber: string } }[] };
    expect(body.data.map((row) => row.household.unitNumber).sort()).toEqual([
      "#03-03",
      "#04-04",
      "#05-05",
    ]);
  });
});
