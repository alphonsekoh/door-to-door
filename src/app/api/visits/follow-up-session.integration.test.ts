import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET, POST } = await import("./route");
const { PATCH: AMEND } = await import("./[id]/route");
const { POST: SYNC } = await import("./sync/route");
const { PATCH: CHANGE_NOTE } = await import("../follow-ups/[id]/route");

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
      results: {
        status: string;
        visit: { followUpsMarkedDone?: string[] } | null;
        error: { error: { code: string } } | null;
      }[];
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

/* Every note at a household, oldest first, as stored. */
const notesAt = async (household: string) =>
  (
    await pool.query<{
      id: string;
      note: string;
      status: string;
      done_at: Date | null;
      done_by: string | null;
      done_visit_id: string | null;
    }>(
      `SELECT id, note, status, done_at, done_by, done_visit_id FROM follow_ups
       WHERE household_id = $1 ORDER BY created_at, id`,
      [household],
    )
  ).rows;
const marked = async (response: Response) =>
  ((await response.json()) as { id: string; followUpsMarkedDone?: string[] }).followUpsMarkedDone;
const reopen = (id: string) =>
  CHANGE_NOTE(
    new Request(`https://test.local/api/follow-ups/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: false }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );

describe("recording a visit in a follow-up session marks the household's follow-ups done", () => {
  it("marks every owed listed note there, credited to the member, and says which", async () => {
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note, created_at)
       VALUES ($1,$2,'Bring the flyer', now() + interval '1 second')`,
      [LISTED, ADMIN],
    );
    asAlice();
    const before = Date.now();
    const response = await post("#01-01");
    expect(response.status).toBe(201);
    const notes = await notesAt(LISTED);
    expect(await marked(response)).toEqual(notes.map((note) => note.id));
    for (const note of notes) {
      expect(note.done_by).toBe(ALICE);
      expect(note.done_at?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    }

    // Done tonight, so the household stays on the list, and a second knock
    // there is still allowed and marks nothing more.
    const again = await post("#01-01");
    expect(again.status).toBe(201);
    expect(await marked(again)).toEqual([]);
  });

  it("marks them for an admin recording at a household on the list", async () => {
    asAdmin();
    const response = await post("#01-01");
    expect(await marked(response)).toHaveLength(1);
    expect((await notesAt(LISTED))[0]?.done_by).toBe(ADMIN);
  });

  it("credits the member an admin records for", async () => {
    asAdmin();
    await post("#01-01", { memberId: ALICE });
    expect((await notesAt(LISTED))[0]?.done_by).toBe(ALICE);
  });

  it("marks nothing where an admin records a household the session did not pick", async () => {
    const unpicked = "c7c7c7c7-0000-4000-8003-000000000009";
    await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#09-09')`, [
      unpicked,
      BLOCK,
    ]);
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Listed, not picked')`,
      [unpicked, ADMIN],
    );
    asAdmin();
    const response = await post("#09-09");
    expect(response.status).toBe(201);
    expect(await marked(response)).toEqual([]);
    expect((await notesAt(unpicked))[0]?.done_at).toBeNull();
  });

  it("marks nothing in a regular session", async () => {
    await pool.query(`UPDATE outing_sessions SET kind = 'regular' WHERE id = $1`, [SESSION]);
    asAlice();
    const response = await post("#01-01");
    expect(await marked(response)).toEqual([]);
    expect((await notesAt(LISTED))[0]?.done_at).toBeNull();
  });

  it("leaves a suggestion, a removed note and one done tonight by hand as they were", async () => {
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, status, note, done_at, done_by, deleted_at, created_at) VALUES
        ($1,$2,'suggested','Suggested too', null, null, null, now() + interval '1 second'),
        ($1,$3,'listed','Taken off', null, null, now(), now() + interval '2 seconds'),
        ($1,$3,'listed','Done by hand', now(), $3, null, now() + interval '3 seconds')`,
      [LISTED, ALICE, ADMIN],
    );
    const untouched = (await notesAt(LISTED)).slice(1);
    asAlice();
    const response = await post("#01-01");
    const [owed, ...rest] = await notesAt(LISTED);
    expect(await marked(response)).toEqual([owed?.id]);
    expect(rest).toEqual(untouched);
  });

  it("names the notes only in the answer to recording, never on a read", async () => {
    asAlice();
    await post("#01-01");
    const read = await GET(new Request(`https://test.local/api/visits?householdId=${LISTED}`));
    const { data } = (await read.json()) as { data: Record<string, unknown>[] };
    expect(data).toHaveLength(1);
    expect(data[0]).not.toHaveProperty("followUpsMarkedDone");
  });

  it("marks nothing on an amend, even with a note owed there since", async () => {
    asAlice();
    const created = (await (await post("#01-01")).json()) as { id: string };
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Listed since')`,
      [LISTED, ADMIN],
    );
    const amended = await AMEND(
      new Request(`https://test.local/api/visits/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ interestLevel: "high" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(amended.status).toBe(200);
    expect(await amended.json()).not.toHaveProperty("followUpsMarkedDone");
    expect((await notesAt(LISTED)).map((note) => note.done_at === null)).toEqual([false, true]);
  });
});

describe("recording through the queue in a follow-up session", () => {
  it("marks them as it is stored, and a replay names the same notes and marks nothing again", async () => {
    const queued = item("#01-01");
    asAlice();
    const [applied] = await sync([queued]);
    const [note] = await notesAt(LISTED);
    expect(applied?.status).toBe("applied");
    expect(applied?.visit?.followUpsMarkedDone).toEqual([note?.id]);

    const [replayed] = await sync([queued]);
    expect(replayed?.status).toBe("unchanged");
    expect(replayed?.visit?.followUpsMarkedDone).toEqual([note?.id]);
    expect(await notesAt(LISTED)).toEqual([note]);
  });

  it("marks nothing on a queued amend, and still names what the visit marked", async () => {
    const queued = item("#01-01");
    asAlice();
    const [first] = await sync([queued]);
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Listed since')`,
      [LISTED, ADMIN],
    );
    const [amend] = await sync([
      { ...queued, interestLevel: "high", updatedAt: new Date().toISOString() },
    ]);
    expect(amend?.status).toBe("applied");
    expect(amend?.visit?.followUpsMarkedDone).toEqual(first?.visit?.followUpsMarkedDone);
    expect((await notesAt(LISTED)).map((note) => note.done_at === null)).toEqual([false, true]);
  });

  it("marks a held record's household once it is listed and picked, when it lands", async () => {
    const held = item("#02-02");
    asAlice();
    expect((await sync([held]))[0]?.status).toBe("rejected");
    await pool.query(`UPDATE follow_ups SET status = 'listed' WHERE household_id = $1`, [
      SUGGESTED,
    ]);
    await pool.query(`INSERT INTO session_households (session_id, household_id) VALUES ($1,$2)`, [
      SESSION,
      SUGGESTED,
    ]);
    const [landed] = await sync([held]);
    const [note] = await notesAt(SUGGESTED);
    expect(landed?.visit?.followUpsMarkedDone).toEqual([note?.id]);
    expect(note?.done_by).toBe(ALICE);
  });

  it("says nothing was marked for a rejected record", async () => {
    asAlice();
    const [rejected] = await sync([item("#09-09")]);
    expect(rejected?.visit).toBeNull();
  });
});

describe("undoing what a visit marked done", () => {
  it("reopens the note and leaves the visit exactly as it was", async () => {
    const queued = item("#01-01");
    asAlice();
    await sync([queued]);
    const visitRow = async () =>
      (await pool.query<Record<string, unknown>>(`SELECT * FROM visits WHERE id = $1`, [queued.id]))
        .rows;
    const stored = await visitRow();
    const [note] = await notesAt(LISTED);
    if (note === undefined) throw new Error("expected the listed note");
    // Marked by the queued visit when it landed: there is something to undo.
    expect(note).toMatchObject({ done_by: ALICE, done_visit_id: queued.id });
    expect(note.done_at).not.toBeNull();

    const undone = await reopen(note.id);
    expect(undone.status).toBe(200);
    expect(await notesAt(LISTED)).toEqual([
      { ...note, done_at: null, done_by: null, done_visit_id: null },
    ]);
    expect(await visitRow()).toEqual(stored);

    // A replay after Undo names nothing, and closes nothing again.
    const [replayed] = await sync([queued]);
    expect(replayed?.visit?.followUpsMarkedDone).toEqual([]);
    expect((await notesAt(LISTED))[0]?.done_at).toBeNull();
  });

  it("refuses a member's undo while a suggestion waits, and lets an admin's through", async () => {
    asAlice();
    await post("#01-01");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, status, note) VALUES ($1,$2,'suggested','Again')`,
      [LISTED, ALICE],
    );
    const [note] = await notesAt(LISTED);
    if (note === undefined) throw new Error("expected the listed note");

    const refused = await reopen(note.id);
    expect(refused.status).toBe(409);
    expect((await error(refused)).code).toBe("follow_up_exists");
    expect((await notesAt(LISTED))[0]?.done_visit_id).not.toBeNull();

    asAdmin();
    expect((await reopen(note.id)).status).toBe(200);
    expect((await notesAt(LISTED))[0]).toMatchObject({ done_at: null, done_visit_id: null });
  });
});
