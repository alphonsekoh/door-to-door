import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const sessions = await import("./route");
const { GET: getActive } = await import("./active/route");
const picks = await import("./[id]/households/route");
const { DELETE: unpick } = await import("./[id]/households/[householdId]/route");
const { POST: attach } = await import("./[id]/blocks/route");
const { DELETE: detach } = await import("./[id]/blocks/[blockId]/route");
const { POST: removeNote } = await import("../follow-ups/[id]/remove/route");
const { POST: startRoute } = await import("./[id]/start/route");

/*
 * A follow-up session's households: an admin picks them, at least one, and
 * the session's blocks follow, so a member never opens an empty block. Every
 * refusal here leaves the picks and blocks exactly as they were.
 */

const pool = createTestPool();
const ADMIN = "b5b5b5b5-0000-4000-8000-000000000001";
const ALICE = "b5b5b5b5-0000-4000-8000-000000000002";
const BLOCK_A = "b5b5b5b5-0000-4000-8001-000000000001";
const BLOCK_B = "b5b5b5b5-0000-4000-8001-000000000002";
/* Listed and owed: may be picked. Two in Blk 123, one in Blk 125. */
const OWED_1 = "b5b5b5b5-0000-4000-8003-000000000001";
const OWED_2 = "b5b5b5b5-0000-4000-8003-000000000002";
const OWED_B = "b5b5b5b5-0000-4000-8003-000000000003";
/* Not on the follow-up list, each for its own reason. */
const SUGGESTED = "b5b5b5b5-0000-4000-8003-000000000004";
const RESOLVED = "b5b5b5b5-0000-4000-8003-000000000005";
const REMOVED = "b5b5b5b5-0000-4000-8003-000000000006";
const UNKNOWN = "b5b5b5b5-0000-4000-8003-00000000ffff";
const NO_SESSION = "b5b5b5b5-0000-4000-8002-00000000ffff";

const asAdmin = () => auth.mockImplementation(() => signedInAs(pool, { id: ADMIN, role: "admin" }));
const asAlice = () =>
  auth.mockImplementation(() => signedInAs(pool, { id: ALICE, role: "member" }));

const url = (path: string) => `https://test.local/api/sessions${path}`;
const json = (method: string, path: string, body?: unknown) =>
  new Request(url(path), {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json" },
  });
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

type Failure = { error: { code: string; message: string; details?: { path: string }[] } };
const failure = async (response: Response) => ((await response.json()) as Failure).error;

const create = (body: unknown) => sessions.POST(json("POST", "", body));
const list = (id: string) => picks.GET(json("GET", `/${id}/households`), ctx({ id }));
const add = (id: string, householdIds: unknown) =>
  picks.POST(json("POST", `/${id}/households`, { householdIds }), ctx({ id }));
const remove = (id: string, householdId: string) =>
  unpick(json("DELETE", `/${id}/households/${householdId}`), ctx({ id, householdId }));
const start = (id: string) => startRoute(json("POST", `/${id}/start`), ctx({ id }));
const statusOf = async (id: string) =>
  (await pool.query<{ status: string }>(`SELECT status FROM outing_sessions WHERE id = $1`, [id]))
    .rows[0]?.status;

/* A follow-up draft over the households given, created as an admin would. */
async function followUp(householdIds: string[] = [OWED_1]): Promise<string> {
  asAdmin();
  const response = await create({ title: "Follow-up", kind: "follow_up", householdIds });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

const setStatus = (id: string, status: "active" | "ended") =>
  pool.query(
    `UPDATE outing_sessions SET status = $2::session_status,
       started_at = coalesce(started_at, now() - interval '1 hour'),
       ended_at = CASE WHEN $2::text = 'ended' THEN now() ELSE NULL END WHERE id = $1`,
    [id, status],
  );

const pickedIds = async (id: string) =>
  (
    await pool.query<{ household_id: string }>(
      `SELECT household_id FROM session_households WHERE session_id = $1 ORDER BY household_id`,
      [id],
    )
  ).rows.map((row) => row.household_id);
const pickedAt = async (id: string, householdId: string) =>
  (
    await pool.query<{ added_at: Date }>(
      `SELECT added_at FROM session_households WHERE session_id = $1 AND household_id = $2`,
      [id, householdId],
    )
  ).rows.map((row) => row.added_at.toISOString());
const blockIds = async (id: string) =>
  (
    await pool.query<{ block_id: string }>(
      `SELECT block_id FROM session_blocks WHERE session_id = $1 ORDER BY block_id`,
      [id],
    )
  ).rows.map((row) => row.block_id);
const sessionCount = async () =>
  Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM outing_sessions`)).rows[0]?.n);

let visitSeq = 0;
const visit = (sessionId: string, householdId: string) =>
  pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
     VALUES ($1, $2, $3, $4, 'medium')`,
    [
      `01960000-0000-7000-8000-${(0xb500 + (visitSeq += 1)).toString(16).padStart(12, "0")}`,
      householdId,
      sessionId,
      ADMIN,
    ],
  );

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave'), ($2,'125','Test Ave')`,
    [BLOCK_A, BLOCK_B],
  );
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number) VALUES
      ($1,$7,'#01-01'), ($2,$7,'#02-02'), ($3,$8,'#01-01'),
      ($4,$7,'#04-04'), ($5,$7,'#05-05'), ($6,$7,'#06-06')`,
    [OWED_1, OWED_2, OWED_B, SUGGESTED, RESOLVED, REMOVED, BLOCK_A, BLOCK_B],
  );
  await pool.query(
    `INSERT INTO follow_ups (household_id, author_id, status, note, done_at, deleted_at, due_date) VALUES
      ($1,$7,'listed','Due later', null, null, now() + interval '9 days'),
      ($1,$7,'listed','Due soon', null, null, now() + interval '1 day'),
      ($1,$7,'listed','Done already', now() - interval '3 days', null, null),
      ($2,$7,'listed','Second door', null, null, null),
      ($3,$7,'listed','Other block', null, null, null),
      ($4,$8,'suggested','Only suggested', null, null, null),
      ($5,$7,'listed','Resolved', now() - interval '3 days', null, null),
      ($6,$7,'listed','Removed', null, now(), null)`,
    [OWED_1, OWED_2, OWED_B, SUGGESTED, RESOLVED, REMOVED, ADMIN, ALICE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("creating a follow-up session", () => {
  it("picks its households and attaches each of their blocks once", async () => {
    const id = await followUp([OWED_1, OWED_2, OWED_B, OWED_1]);
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_2, OWED_B]);
    expect(await blockIds(id)).toEqual([BLOCK_A, BLOCK_B]);
  });

  it("picks one household named in two letter cases once", async () => {
    const id = await followUp([OWED_1, OWED_1.toUpperCase()]);
    expect(await pickedIds(id)).toEqual([OWED_1]);
  });

  it("refuses one with no households, and says what to do", async () => {
    asAdmin();
    const response = await create({ title: "Follow-up", kind: "follow_up" });
    expect(response.status).toBe(400);
    expect((await failure(response)).details).toEqual([
      { path: "/householdIds", message: "Pick at least one household to visit." },
    ]);
    expect(await sessionCount()).toBe(0);
  });

  it("refuses an empty list of households", async () => {
    asAdmin();
    const response = await create({ title: "Follow-up", kind: "follow_up", householdIds: [] });
    expect(response.status).toBe(400);
    expect((await failure(response)).details?.map((d) => d.path)).toEqual(["/householdIds"]);
    expect(await sessionCount()).toBe(0);
  });

  it("refuses blocks given by hand", async () => {
    asAdmin();
    const response = await create({
      title: "Follow-up",
      kind: "follow_up",
      householdIds: [OWED_1],
      blockIds: [BLOCK_B],
    });
    expect(response.status).toBe(400);
    expect((await failure(response)).details?.map((d) => d.path)).toEqual(["/blockIds"]);
    expect(await sessionCount()).toBe(0);
  });

  it("refuses households for a door-to-door session", async () => {
    asAdmin();
    const response = await create({ title: "Door-to-door", householdIds: [OWED_1] });
    expect(response.status).toBe(400);
    expect((await failure(response)).details?.map((d) => d.path)).toEqual(["/householdIds"]);
    expect(await sessionCount()).toBe(0);
  });

  it("creates nothing when a household does not exist", async () => {
    asAdmin();
    const response = await create({
      title: "Follow-up",
      kind: "follow_up",
      householdIds: [OWED_1, UNKNOWN],
    });
    expect(response.status).toBe(404);
    expect(await sessionCount()).toBe(0);
  });

  it.each([
    ["only a suggestion", SUGGESTED],
    ["every note resolved", RESOLVED],
    ["its note removed", REMOVED],
  ])("creates nothing when a household has %s", async (_case, household) => {
    asAdmin();
    const response = await create({
      title: "Follow-up",
      kind: "follow_up",
      householdIds: [OWED_1, household],
    });
    expect(response.status).toBe(409);
    expect((await failure(response)).code).toBe("not_on_follow_up_list");
    expect(await sessionCount()).toBe(0);
  });

  it("refuses a member", async () => {
    asAlice();
    expect(
      (await create({ title: "Follow-up", kind: "follow_up", householdIds: [OWED_1] })).status,
    ).toBe(403);
  });
});

describe("GET /api/sessions?kind=", () => {
  it("lists only sessions of that kind", async () => {
    await followUp();
    asAdmin();
    await create({ title: "Door-to-door" });
    const titles = async (query: string) =>
      (
        (await (await sessions.GET(json("GET", query))).json()) as { data: { title: string }[] }
      ).data.map((session) => session.title);
    expect(await titles("?kind=follow_up")).toEqual(["Follow-up"]);
    expect(await titles("?kind=regular&status=draft")).toEqual(["Door-to-door"]);
    expect(await titles("?kind=follow_up&status=active")).toEqual([]);
  });
});

describe("GET /api/sessions/active", () => {
  it("names a follow-up session's households and when each was picked", async () => {
    const id = await followUp([OWED_1, OWED_B]);
    await pool.query(
      `UPDATE session_households SET added_at = '2026-10-18T09:00:00Z' WHERE household_id = $1`,
      [OWED_B],
    );
    await setStatus(id, "active");
    asAlice();
    const body = (await (await getActive(json("GET", "/active"))).json()) as {
      picks: { householdId: string; addedAt: string }[];
    };
    expect(body.picks.map((pick) => pick.householdId)).toEqual([OWED_1, OWED_B]);
    expect(body.picks[1]?.addedAt).toBe("2026-10-18T09:00:00.000Z");
    const [added] = await pickedAt(id, OWED_1);
    expect(body.picks[0]?.addedAt).toBe(added);
  });

  it("names none for a door-to-door session", async () => {
    asAdmin();
    const created = await create({ title: "Door-to-door", blockIds: [BLOCK_A] });
    const { id } = (await created.json()) as { id: string };
    await setStatus(id, "active");
    asAlice();
    const body = (await (await getActive(json("GET", "/active"))).json()) as { picks: unknown[] };
    expect(body.picks).toEqual([]);
  });
});

describe("GET /api/sessions/{id}/households", () => {
  type Entry = {
    household: { id: string; unitNumber: string };
    block: { name: string; street: string };
    addedAt: string;
    notes: { note: string }[];
    onList: boolean;
    visitedInSession: boolean;
  };
  const read = async (id: string) => ((await (await list(id)).json()) as { data: Entry[] }).data;

  it("gives each pick by block then unit, with its listed notes, owed first", async () => {
    const id = await followUp([OWED_B, OWED_2, OWED_1]);
    asAdmin();
    const entries = await read(id);
    expect(entries.map((e) => `${e.block.name} ${e.household.unitNumber}`)).toEqual([
      "123 #01-01",
      "123 #02-02",
      "125 #01-01",
    ]);
    expect(entries[0]?.notes.map((note) => note.note)).toEqual([
      "Due soon",
      "Due later",
      "Done already",
    ]);
  });

  it("puts the note resolved since the pick ahead of one resolved before it", async () => {
    const id = await followUp([OWED_1]);
    await setStatus(id, "active");
    // "Due later" is resolved during the session; "Done already" was resolved
    // three days before the pick, and "Due soon" is still owed.
    await pool.query(
      `UPDATE follow_ups SET done_at = now() WHERE household_id = $1 AND note = 'Due later'`,
      [OWED_1],
    );
    asAdmin();
    expect((await read(id))[0]?.notes.map((note) => note.note)).toEqual([
      "Due soon",
      "Due later",
      "Done already",
    ]);
    await pool.query(
      `UPDATE follow_ups SET done_at = now() - interval '1 minute' WHERE household_id = $1 AND note = 'Due soon'`,
      [OWED_1],
    );
    // All done: the newest resolved first, the one from before the pick last.
    expect((await read(id))[0]?.notes.map((note) => note.note)).toEqual([
      "Due later",
      "Due soon",
      "Done already",
    ]);
  });

  it("keeps two blocks that share a name apart, each block's households together", async () => {
    const OTHER_ROAD = "b5b5b5b5-0000-4000-8001-000000000003";
    const ELSEWHERE = "b5b5b5b5-0000-4000-8003-000000000007";
    await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Other Rd')`, [
      OTHER_ROAD,
    ]);
    // Its unit sorts between Test Ave's two, which a sort by name alone interleaves.
    await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#01-50')`, [
      ELSEWHERE,
      OTHER_ROAD,
    ]);
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, status, note) VALUES ($1,$2,'listed','Other road')`,
      [ELSEWHERE, ADMIN],
    );
    const id = await followUp([OWED_1, OWED_2, ELSEWHERE]);
    asAdmin();
    expect(
      (await read(id)).map((e) => `${e.block.name} ${e.block.street} ${e.household.unitNumber}`),
    ).toEqual(["123 Other Rd #01-50", "123 Test Ave #01-01", "123 Test Ave #02-02"]);
  });

  it("says when each was picked", async () => {
    const id = await followUp([OWED_1]);
    await pool.query(
      `UPDATE session_households SET added_at = '2026-10-18T09:00:00Z' WHERE session_id = $1`,
      [id],
    );
    asAdmin();
    expect((await add(id, [OWED_2])).status).toBe(200);
    const entries = await read(id);
    expect(entries[0]?.addedAt).toBe("2026-10-18T09:00:00.000Z");
    expect(Date.parse(entries[1]?.addedAt ?? "")).toBeGreaterThan(Date.parse("2026-10-19"));
  });

  it("says which picks are on the list now, and which were visited in this session", async () => {
    const id = await followUp([OWED_1, OWED_2]);
    await setStatus(id, "active");
    await visit(id, OWED_1);
    await pool.query(`UPDATE follow_ups SET deleted_at = now() WHERE household_id = $1`, [OWED_2]);
    asAdmin();
    expect(
      (await read(id)).map((e) => [e.household.id, e.onList, e.visitedInSession, e.notes.length]),
    ).toEqual([
      [OWED_1, true, true, 3],
      [OWED_2, false, false, 0],
    ]);
  });

  it("refuses a member", async () => {
    const id = await followUp();
    asAlice();
    expect((await list(id)).status).toBe(403);
  });

  it("says a regular session has no households", async () => {
    asAdmin();
    const { id } = (await (await create({ title: "Door-to-door" })).json()) as { id: string };
    const response = await list(id);
    expect(response.status).toBe(409);
    expect(await failure(response)).toEqual({
      code: "conflict",
      message: "This is a regular session, so it has no households.",
    });
  });

  it("is 404 for a session that does not exist", async () => {
    asAdmin();
    expect((await list(NO_SESSION)).status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    const id = await followUp();
    auth.mockResolvedValue(null);
    expect((await list(id)).status).toBe(401);
  });
});

describe("POST /api/sessions/{id}/households", () => {
  it("adds households and their blocks, and answers with the picks", async () => {
    const id = await followUp([OWED_1]);
    asAdmin();
    const response = await add(id, [OWED_B]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { household: { id: string } }[] };
    expect(body.data.map((entry) => entry.household.id)).toEqual([OWED_1, OWED_B]);
    expect(await blockIds(id)).toEqual([BLOCK_A, BLOCK_B]);
  });

  it("leaves a household already picked as it is", async () => {
    const id = await followUp([OWED_1]);
    const before = (await pool.query<{ added_at: Date }>(`SELECT added_at FROM session_households`))
      .rows;
    asAdmin();
    expect((await add(id, [OWED_1, OWED_2])).status).toBe(200);
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_2]);
    const after = await pool.query<{ added_at: Date }>(
      `SELECT added_at FROM session_households WHERE household_id = $1`,
      [OWED_1],
    );
    expect(after.rows).toEqual(before);
  });

  it("adds one household named in two letter cases once", async () => {
    const id = await followUp([OWED_1]);
    asAdmin();
    expect((await add(id, [OWED_2, OWED_2.toUpperCase()])).status).toBe(200);
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_2]);
  });

  it("adds to a running session", async () => {
    const id = await followUp([OWED_1]);
    await setStatus(id, "active");
    asAdmin();
    expect((await add(id, [OWED_2])).status).toBe(200);
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_2]);
  });

  it("adds nothing when one household is not on the follow-up list", async () => {
    const id = await followUp([OWED_1]);
    asAdmin();
    const response = await add(id, [OWED_B, RESOLVED]);
    expect(response.status).toBe(409);
    expect((await failure(response)).code).toBe("not_on_follow_up_list");
    expect(await pickedIds(id)).toEqual([OWED_1]);
    expect(await blockIds(id)).toEqual([BLOCK_A]);
  });

  it("adds nothing when one household does not exist", async () => {
    const id = await followUp([OWED_1]);
    asAdmin();
    expect((await add(id, [OWED_B, UNKNOWN])).status).toBe(404);
    expect(await pickedIds(id)).toEqual([OWED_1]);
  });

  it("refuses an ended session, whose picks are its record", async () => {
    const id = await followUp([OWED_1]);
    await setStatus(id, "ended");
    asAdmin();
    const response = await add(id, [OWED_2]);
    expect(response.status).toBe(409);
    expect((await failure(response)).code).toBe("conflict");
    expect(await pickedIds(id)).toEqual([OWED_1]);
  });

  it("refuses a regular session", async () => {
    asAdmin();
    const { id } = (await (await create({ title: "Door-to-door" })).json()) as { id: string };
    expect((await add(id, [OWED_1])).status).toBe(409);
    expect(await pickedIds(id)).toEqual([]);
  });

  it("refuses an empty list", async () => {
    const id = await followUp();
    asAdmin();
    expect((await add(id, [])).status).toBe(400);
  });

  it("is 404 for a session that does not exist", async () => {
    asAdmin();
    expect((await add(NO_SESSION, [OWED_1])).status).toBe(404);
  });

  it("refuses a member before anything else", async () => {
    const id = await followUp();
    asAlice();
    expect((await add(id, [OWED_2])).status).toBe(403);
    expect((await add(NO_SESSION, [OWED_2])).status).toBe(403);
    expect(await pickedIds(id)).toEqual([OWED_1]);
  });
});

describe("DELETE /api/sessions/{id}/households/{householdId}", () => {
  it("removes a household and keeps its block while another pick is in it", async () => {
    const id = await followUp([OWED_1, OWED_2, OWED_B]);
    asAdmin();
    expect((await remove(id, OWED_2)).status).toBe(204);
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_B]);
    expect(await blockIds(id)).toEqual([BLOCK_A, BLOCK_B]);
  });

  it("takes the block away with the last pick in it", async () => {
    const id = await followUp([OWED_1, OWED_B]);
    await setStatus(id, "active");
    asAdmin();
    expect((await remove(id, OWED_B)).status).toBe(204);
    expect(await blockIds(id)).toEqual([BLOCK_A]);
  });

  it("leaves the household on the follow-up list", async () => {
    const id = await followUp([OWED_1, OWED_2]);
    asAdmin();
    await remove(id, OWED_2);
    const { rows } = await pool.query(
      `SELECT 1 FROM follow_ups WHERE household_id = $1 AND deleted_at IS NULL`,
      [OWED_2],
    );
    expect(rows).toHaveLength(1);
  });

  it("never removes the last household", async () => {
    const id = await followUp([OWED_1]);
    asAdmin();
    const response = await remove(id, OWED_1);
    expect(response.status).toBe(409);
    expect(await failure(response)).toEqual({
      code: "conflict",
      message:
        "A follow-up session needs at least one household, so the last one can't be removed.",
    });
    expect(await pickedIds(id)).toEqual([OWED_1]);
  });

  it("keeps a household visited in this session", async () => {
    const id = await followUp([OWED_1, OWED_B]);
    await setStatus(id, "active");
    await visit(id, OWED_B);
    asAdmin();
    const response = await remove(id, OWED_B);
    expect(response.status).toBe(409);
    expect((await failure(response)).code).toBe("conflict");
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_B]);
  });

  it("says a lone household visited in this session was visited, as the page does", async () => {
    const id = await followUp([OWED_1]);
    await setStatus(id, "active");
    await visit(id, OWED_1);
    asAdmin();
    const response = await remove(id, OWED_1);
    expect(response.status).toBe(409);
    expect(await failure(response)).toEqual({
      code: "conflict",
      message: "Someone has recorded a visit here in this session, so it stays in the session.",
    });
  });

  it("keeps a block holding an admin's visits off the list in this session", async () => {
    // Its block would leave the session with this session's work in it (D-18-3).
    const id = await followUp([OWED_1, OWED_B]);
    await setStatus(id, "active");
    await pool.query(
      `INSERT INTO households (id, block_id, unit_number) VALUES ('b5b5b5b5-0000-4000-8003-0000000000aa', $1, '#09-09')`,
      [BLOCK_B],
    );
    await visit(id, "b5b5b5b5-0000-4000-8003-0000000000aa");
    asAdmin();
    const response = await remove(id, OWED_B);
    expect(response.status).toBe(409);
    expect((await failure(response)).code).toBe("block_in_use");
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_B]);
    expect(await blockIds(id)).toEqual([BLOCK_A, BLOCK_B]);
  });

  it("is 404 for a household the session did not pick, before whether it has ended", async () => {
    const id = await followUp([OWED_1, OWED_2]);
    asAdmin();
    expect((await remove(id, OWED_B)).status).toBe(404);
    await setStatus(id, "ended");
    expect((await remove(id, OWED_B)).status).toBe(404);
  });

  it("is 404 for a session that does not exist", async () => {
    asAdmin();
    expect((await remove(NO_SESSION, OWED_1)).status).toBe(404);
  });

  it("refuses an ended session", async () => {
    const id = await followUp([OWED_1, OWED_2]);
    await setStatus(id, "ended");
    asAdmin();
    expect((await remove(id, OWED_2)).status).toBe(409);
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_2]);
  });

  it("is 404 for a regular session, which picks no households", async () => {
    asAdmin();
    const { id } = (await (await create({ title: "Door-to-door" })).json()) as { id: string };
    expect((await remove(id, OWED_1)).status).toBe(404);
  });

  it("refuses a member", async () => {
    const id = await followUp([OWED_1, OWED_2]);
    asAlice();
    expect((await remove(id, OWED_2)).status).toBe(403);
    expect(await pickedIds(id)).toEqual([OWED_1, OWED_2]);
  });
});

describe("blocks of a follow-up session", () => {
  it("cannot be attached by hand", async () => {
    const id = await followUp([OWED_1]);
    asAdmin();
    const response = await attach(
      json("POST", `/${id}/blocks`, { blockIds: [BLOCK_B] }),
      ctx({ id }),
    );
    expect(response.status).toBe(409);
    expect(await failure(response)).toEqual({
      code: "conflict",
      message:
        "A follow-up session's blocks follow its households. Add or remove households instead.",
    });
    expect(await blockIds(id)).toEqual([BLOCK_A]);
  });

  it("cannot be detached by hand", async () => {
    const id = await followUp([OWED_1]);
    asAdmin();
    const response = await detach(json("DELETE", `/${id}/blocks/${BLOCK_A}`), {
      params: Promise.resolve({ id, blockId: BLOCK_A }),
    });
    expect(response.status).toBe(409);
    expect(await blockIds(id)).toEqual([BLOCK_A]);
  });
});

describe("a pick whose note leaves the follow-up list", () => {
  it("stays picked, off the session's list, and the removal is never refused for it", async () => {
    const id = await followUp([OWED_2]);
    await setStatus(id, "active");
    const note = (
      await pool.query<{ id: string }>(`SELECT id FROM follow_ups WHERE household_id = $1`, [
        OWED_2,
      ])
    ).rows[0]?.id;
    if (note === undefined) throw new Error("expected the seeded note");
    asAdmin();
    const response = await removeNote(
      new Request(`https://test.local/api/follow-ups/${note}/remove`, {
        method: "POST",
        body: JSON.stringify({ reason: "Moved away" }),
        headers: { "content-type": "application/json" },
      }),
      ctx({ id: note }),
    );
    expect(response.status).toBe(204);
    expect(await pickedIds(id)).toEqual([OWED_2]);
    const entries = (
      (await (await list(id)).json()) as { data: { onList: boolean; notes: unknown[] }[] }
    ).data;
    expect(entries).toEqual([expect.objectContaining({ onList: false, notes: [] })]);
  });

  it("leaves the list when added midway, whatever was resolved before it was added", async () => {
    type Entry = { household: { id: string }; onList: boolean; notes: { note: string }[] };
    const read = async (id: string) => ((await (await list(id)).json()) as { data: Entry[] }).data;
    const id = await followUp([OWED_2]);
    await setStatus(id, "active");
    // Resolved half an hour into the session, before an admin added the door
    // for "Due later", which is then taken off the follow-up list.
    await pool.query(
      `UPDATE follow_ups SET done_at = now() - interval '30 minutes'
       WHERE household_id = $1 AND note = 'Due soon'`,
      [OWED_1],
    );
    asAdmin();
    expect((await add(id, [OWED_1])).status).toBe(200);
    expect(
      (await read(id)).find((entry) => entry.household.id === OWED_1)?.onList,
      "owed when added",
    ).toBe(true);
    await pool.query(
      `UPDATE follow_ups SET deleted_at = now(), deleted_by = $2, delete_reason = 'Moved'
       WHERE household_id = $1 AND note = 'Due later'`,
      [OWED_1, ADMIN],
    );
    const entry = (await read(id)).find((candidate) => candidate.household.id === OWED_1);
    expect(entry?.onList).toBe(false);
    // Still read, for the page to tell they were resolved before the pick.
    expect(entry?.notes.map((note) => note.note)).toEqual(["Due soon", "Done already"]);
  });
});

describe("starting a follow-up session", () => {
  it("starts while a household it picked is still owed a visit", async () => {
    const id = await followUp([OWED_1, OWED_2]);
    await pool.query(`UPDATE follow_ups SET done_at = now() WHERE household_id = $1`, [OWED_2]);
    asAdmin();
    expect((await start(id)).status).toBe(200);
    expect(await statusOf(id)).toBe("active");
  });

  it("refuses once every pick was resolved since, so members never open an empty list", async () => {
    const id = await followUp([OWED_2]);
    await pool.query(`UPDATE follow_ups SET done_at = now() WHERE household_id = $1`, [OWED_2]);
    asAdmin();
    const response = await start(id);
    expect(response.status).toBe(409);
    expect(await failure(response)).toEqual({
      code: "conflict",
      message:
        "Every household in this session is done or off the follow-up list, so members would find nothing to visit. Add households before starting it.",
    });
    expect(await statusOf(id)).toBe("draft");
  });

  it("refuses once every pick's note was taken off the follow-up list", async () => {
    const id = await followUp([OWED_2]);
    await pool.query(`UPDATE follow_ups SET deleted_at = now() WHERE household_id = $1`, [OWED_2]);
    asAdmin();
    expect((await start(id)).status).toBe(409);
    expect(await statusOf(id)).toBe("draft");
  });

  it("starts once a household still owed is added", async () => {
    const id = await followUp([OWED_2]);
    await pool.query(`UPDATE follow_ups SET done_at = now() WHERE household_id = $1`, [OWED_2]);
    asAdmin();
    expect((await start(id)).status).toBe(409);
    expect((await add(id, [OWED_B])).status).toBe(200);
    expect((await start(id)).status).toBe(200);
  });

  it("is never asked of a door-to-door session, which starts with no households", async () => {
    asAdmin();
    const created = await create({ title: "Saturday", kind: "regular" });
    const { id } = (await created.json()) as { id: string };
    expect((await start(id)).status).toBe(200);
  });
});
