import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { POST } = await import("./route");
const { POST: SYNC } = await import("./sync/route");

/*
 * Recording in a follow-up session: a member records only at households on
 * the session's list, through the form and through the offline queue alike.
 */

const pool = createTestPool();
const ADMIN = "c7c7c7c7-0000-4000-8000-000000000001";
const ALICE = "c7c7c7c7-0000-4000-8000-000000000002";
const BLOCK = "c7c7c7c7-0000-4000-8001-000000000001";
const SESSION = "c7c7c7c7-0000-4000-8002-000000000001";
const LISTED = "c7c7c7c7-0000-4000-8003-000000000001";
const SUGGESTED = "c7c7c7c7-0000-4000-8003-000000000002";
const REMOVED = "c7c7c7c7-0000-4000-8003-000000000003";
const DONE_BEFORE = "c7c7c7c7-0000-4000-8003-000000000004";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asAlice = () =>
  auth.mockResolvedValue({ user: { id: ALICE, role: "member", deactivated: false } });

let seq = 0;
const nextId = () => `01960000-0000-7000-8000-${String(0xc700 + ++seq).padStart(12, "0")}`;

const post = (unitNumber: string, extra: Record<string, unknown> = {}) =>
  POST(
    new Request("https://test.local/api/visits", {
      method: "POST",
      body: JSON.stringify({
        id: nextId(),
        blockId: BLOCK,
        unitNumber,
        interestLevel: "medium",
        ...extra,
      }),
      headers: { "content-type": "application/json" },
    }),
  );

const knocked = () => new Date(Date.now() - 60_000).toISOString();
const item = (unitNumber: string, overrides: Record<string, unknown> = {}) => ({
  id: nextId(),
  blockId: BLOCK,
  unitNumber,
  sessionId: SESSION,
  interestLevel: "medium",
  clientCreatedAt: knocked(),
  updatedAt: knocked(),
  ...overrides,
});
const sync = async (items: unknown[]) => {
  const response = await SYNC(
    new Request("https://test.local/api/visits/sync", {
      method: "POST",
      body: JSON.stringify({ sentAt: new Date().toISOString(), items }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(response.status).toBe(200);
  return (
    (await response.json()) as {
      results: { status: string; error: { error: { code: string } } | null }[];
    }
  ).results;
};
const error = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string } }).error;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, kind, status, started_at, created_by)
     VALUES ($1,'Follow-up','follow_up','active', now() - interval '1 hour', $2)`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number) VALUES
      ($1,$5,'#01-01'), ($2,$5,'#02-02'), ($3,$5,'#03-03'), ($4,$5,'#04-04')`,
    [LISTED, SUGGESTED, REMOVED, DONE_BEFORE, BLOCK],
  );
  await pool.query(
    `INSERT INTO follow_ups (household_id, author_id, status, note, done_at, deleted_at) VALUES
      ($1,$5,'listed','On the list', null, null),
      ($2,$6,'suggested','Only suggested', null, null),
      ($3,$5,'listed','Taken off', null, now()),
      ($4,$5,'listed','Done last week', now() - interval '7 days', null)`,
    [LISTED, SUGGESTED, REMOVED, DONE_BEFORE, ADMIN, ALICE],
  );
  /* Picked while each was owed; the suggestion never was. */
  await pool.query(
    `INSERT INTO session_households (session_id, household_id) VALUES ($1,$2), ($1,$3), ($1,$4)`,
    [SESSION, LISTED, REMOVED, DONE_BEFORE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("POST /api/visits in a follow-up session", () => {
  it("records a member's visit at a household on the list", async () => {
    asAlice();
    expect((await post("#01-01")).status).toBe(201);
  });

  it("refuses a member at a unit nobody has visited, and says what to do", async () => {
    asAlice();
    const response = await post("#09-09");
    expect(response.status).toBe(409);
    expect(await error(response)).toEqual({
      code: "not_on_follow_up_list",
      message: "This unit is not on this session's list. Ask an admin to add it.",
    });
  });

  it.each([
    ["only a suggestion", "#02-02"],
    ["a removed note", "#03-03"],
    ["a note resolved before the session started", "#04-04"],
  ])("refuses a member at a household with %s", async (_case, unit) => {
    asAlice();
    expect((await error(await post(unit))).code).toBe("not_on_follow_up_list");
  });

  it("lets an admin record anywhere in the session's blocks", async () => {
    asAdmin();
    expect((await post("#09-09")).status).toBe(201);
  });

  it("lets an admin record an unlisted unit on a member's behalf", async () => {
    // The caller's role decides, not the author's.
    asAdmin();
    const response = await post("#09-09", { memberId: ALICE });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { member: { id: string } }).member.id).toBe(ALICE);
  });

  it("leaves a regular session open to every unit", async () => {
    await pool.query(`UPDATE outing_sessions SET kind = 'regular' WHERE id = $1`, [SESSION]);
    asAlice();
    expect((await post("#09-09")).status).toBe(201);
  });
});

describe("POST /api/visits/sync in a follow-up session", () => {
  it("rejects an unlisted record with the same code while its siblings apply", async () => {
    asAlice();
    const results = await sync([item("#01-01"), item("#09-09"), item("#01-01")]);
    expect(results.map((result) => result.status)).toEqual(["applied", "rejected", "applied"]);
    expect(results[1]?.error?.error.code).toBe("not_on_follow_up_list");
  });

  it("lets the same record through once an admin lists the unit and adds it", async () => {
    const held = item("#02-02");
    asAlice();
    expect((await sync([held]))[0]?.status).toBe("rejected");
    await pool.query(`UPDATE follow_ups SET status = 'listed' WHERE household_id = $1`, [
      SUGGESTED,
    ]);
    // Listed, but this session did not pick it: still held.
    expect((await sync([held]))[0]?.status).toBe("rejected");
    await pool.query(`INSERT INTO session_households (session_id, household_id) VALUES ($1,$2)`, [
      SESSION,
      SUGGESTED,
    ]);
    expect((await sync([held]))[0]?.status).toBe("applied");
  });

  it("lets a removed note's record through once it is listed again", async () => {
    // Its household stayed picked when the note was removed.
    const held = item("#03-03");
    asAlice();
    expect((await sync([held]))[0]?.status).toBe("rejected");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Listed again')`,
      [REMOVED, ADMIN],
    );
    expect((await sync([held]))[0]?.status).toBe("applied");
  });

  it("never judges an amend to a stored visit against the list", async () => {
    // An amend corrects what was allowed when it was recorded.
    const first = item("#01-01");
    asAlice();
    expect((await sync([first]))[0]?.status).toBe("applied");
    await pool.query(`UPDATE follow_ups SET deleted_at = now() WHERE household_id = $1`, [LISTED]);
    const amended = { ...first, interestLevel: "high", updatedAt: new Date().toISOString() };
    expect((await sync([amended]))[0]?.status).toBe("applied");
  });

  it("lets an admin's queue record an unlisted unit", async () => {
    asAdmin();
    expect((await sync([item("#09-09")]))[0]?.status).toBe("applied");
  });
});
