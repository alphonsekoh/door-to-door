import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { GET, POST } = await import("./route");
const { PATCH, DELETE } = await import("./[id]/route");

const pool = createTestPool();
const ADMIN = "aceaceac-0000-4000-8000-000000000001";
const ALICE = "aceaceac-0000-4000-8000-000000000002";
const BEN = "aceaceac-0000-4000-8000-000000000003";
const BLOCK = "aceaceac-0000-4000-8001-000000000001";
const HOUSEHOLD = "aceaceac-0000-4000-8003-000000000001";
const OTHER_HOUSEHOLD = "aceaceac-0000-4000-8003-000000000002";
const SESSION = "aceaceac-0000-4000-8002-000000000001";
const VISIT = "01960000-0000-7000-8000-00000000ce01";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asAlice = () =>
  auth.mockResolvedValue({ user: { id: ALICE, role: "member", deactivated: false } });
const asBen = () =>
  auth.mockResolvedValue({ user: { id: BEN, role: "member", deactivated: false } });

const url = (q = "") => `https://test.local/api/follow-ups${q}`;
const create = (body: unknown) =>
  POST(
    new Request(url(), {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(url(`/${id}`), {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );
const remove = (id: string) =>
  DELETE(new Request(url(`/${id}`), { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

const noteId = async (response: Response) => ((await response.json()) as { id: string }).id;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'), ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#05-123'), ($3,$2,'#06-201')`,
    [HOUSEHOLD, BLOCK, OTHER_HOUSEHOLD],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Outing','active',$2)`,
    [SESSION, ADMIN],
  );
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
     VALUES ($1,$2,$3,$4,'high')`,
    [VISIT, HOUSEHOLD, SESSION, ALICE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("creating a note", () => {
  it("attaches it to the household", async () => {
    asAlice();
    const response = await create({ householdId: HOUSEHOLD, note: "Bring the flyer." });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { note: string; author: { name: string } };
    expect(body).toMatchObject({ note: "Bring the flyer.", author: { name: "Alice" } });
  });

  it("can anchor it to a specific visit", async () => {
    asAlice();
    const body = (await (
      await create({ householdId: HOUSEHOLD, visitId: VISIT, note: "As promised." })
    ).json()) as { visitId: string };
    expect(body.visitId).toBe(VISIT);
  });

  it("refuses a visit belonging to a different household", async () => {
    // A note anchored to a visit at another door would read as nonsense.
    asAlice();
    expect(
      (await create({ householdId: OTHER_HOUSEHOLD, visitId: VISIT, note: "Mismatched." })).status,
    ).toBe(404);
  });

  it("returns 404 for a visit that does not exist", async () => {
    asAlice();
    expect(
      (
        await create({
          householdId: HOUSEHOLD,
          visitId: "01960000-0000-7000-8000-0000000000ff",
          note: "Anchored to nothing",
        })
      ).status,
    ).toBe(404);
  });

  it("returns 404 for an unknown household", async () => {
    asAlice();
    expect(
      (await create({ householdId: "aceaceac-0000-4000-8003-00000000ffff", note: "x" })).status,
    ).toBe(404);
  });

  it("rejects an empty note with 400", async () => {
    asAlice();
    expect((await create({ householdId: HOUSEHOLD, note: "" })).status).toBe(400);
  });

  it("accepts a due date", async () => {
    asAlice();
    const body = (await (
      await create({ householdId: HOUSEHOLD, note: "Soon", dueDate: "2026-09-30T00:00:00.000Z" })
    ).json()) as { dueDate: string };
    expect(body.dueDate).toBe("2026-09-30T00:00:00.000Z");
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await create({ householdId: HOUSEHOLD, note: "x" })).status).toBe(401);
  });
});

describe("resolving a note", () => {
  it("records who closed it, not just that it closed", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Send pamphlet" }));

    // An admin, because only the author or an admin may change a note.
    asAdmin();
    const body = (await (await patch(id, { done: true })).json()) as {
      doneAt: string | null;
      doneBy: { name: string } | null;
    };
    expect(body.doneAt).not.toBeNull();
    expect(body.doneBy?.name).toBe("Admin");
  });

  it("lets another member resolve a note they acted on", async () => {
    /*
     * Alice writes "bring the flyer" in March; Ben works the block in June,
     * reads the note and brings it. He must be able to tick it off, or the
     * outstanding list fills with things that already happened.
     */
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Bring the flyer" }));

    asBen();
    const response = await patch(id, { done: true });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { doneBy: { name: string } | null };
    // Attributable to whoever actually did it, not to the author.
    expect(body.doneBy?.name).toBe("Ben");
  });

  it("lets another member reopen a note ticked off by mistake", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Bring the flyer" }));
    asBen();
    await patch(id, { done: true });
    const body = (await (await patch(id, { done: false })).json()) as { doneAt: null };
    expect(body.doneAt).toBeNull();
  });

  it("still refuses another member editing the note text", async () => {
    // The words belong to whoever wrote them.
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Alice's wording" }));
    asBen();
    expect((await patch(id, { note: "Ben's rewrite" })).status).toBe(403);
  });

  it("still refuses another member changing the due date", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Alice's" }));
    asBen();
    expect((await patch(id, { dueDate: "2026-12-01T00:00:00.000Z" })).status).toBe(403);
  });

  it("refuses a resolution bundled with an edit", async () => {
    // Otherwise `done` would be a way to smuggle in a rewrite.
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Alice's" }));
    asBen();
    expect((await patch(id, { done: true, note: "and rewritten" })).status).toBe(403);
  });

  it("can reopen a note that was closed too early", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Not done after all" }));
    await patch(id, { done: true });

    const body = (await (await patch(id, { done: false })).json()) as {
      doneAt: string | null;
      doneBy: unknown;
    };
    expect(body.doneAt).toBeNull();
    expect(body.doneBy).toBeNull();
  });

  it("lets the author amend the note text", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Typo" }));
    const body = (await (await patch(id, { note: "Corrected" })).json()) as { note: string };
    expect(body.note).toBe("Corrected");
  });

  it("can set a due date that was not there before", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "No date yet" }));
    const body = (await (await patch(id, { dueDate: "2026-10-01T00:00:00.000Z" })).json()) as {
      dueDate: string;
    };
    expect(body.dueDate).toBe("2026-10-01T00:00:00.000Z");
  });

  it("can clear a due date", async () => {
    asAlice();
    const id = await noteId(
      await create({ householdId: HOUSEHOLD, note: "x", dueDate: "2026-09-30T00:00:00.000Z" }),
    );
    const body = (await (await patch(id, { dueDate: null })).json()) as { dueDate: null };
    expect(body.dueDate).toBeNull();
  });

  it("refuses a member amending someone else's note", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Alice's" }));
    asBen();
    expect((await patch(id, { note: "Ben's edit" })).status).toBe(403);
  });

  it("lets an admin amend anyone's note", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Alice's" }));
    asAdmin();
    expect((await patch(id, { note: "Tidied" })).status).toBe(200);
  });

  it("rejects an empty change with 400", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "x" }));
    expect((await patch(id, {})).status).toBe(400);
  });

  it("returns 404 for an unknown note", async () => {
    asAdmin();
    expect((await patch("aceaceac-0000-4000-8004-00000000ffff", { note: "x" })).status).toBe(404);
  });
});

describe("deleting a note", () => {
  it("lets the author delete it", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Mistake" }));
    expect((await remove(id)).status).toBe(204);
  });

  it("refuses a member deleting someone else's", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Alice's" }));
    asBen();
    expect((await remove(id)).status).toBe(403);
  });

  it("lets an admin delete anyone's", async () => {
    asAlice();
    const id = await noteId(await create({ householdId: HOUSEHOLD, note: "Alice's" }));
    asAdmin();
    expect((await remove(id)).status).toBe(204);
  });

  it("returns 404 for an unknown note", async () => {
    asAdmin();
    expect((await remove("aceaceac-0000-4000-8004-00000000ffff")).status).toBe(404);
  });
});

describe("listing", () => {
  const seedNotes = async () => {
    asAlice();
    await create({ householdId: HOUSEHOLD, note: "Due soon", dueDate: "2026-07-15T00:00:00.000Z" });
    await create({
      householdId: HOUSEHOLD,
      note: "Due later",
      dueDate: "2026-09-30T00:00:00.000Z",
    });
    const done = await noteId(await create({ householdId: OTHER_HOUSEHOLD, note: "Finished" }));
    await patch(done, { done: true });
  };

  it("puts outstanding notes before resolved ones, earliest due first", async () => {
    // This is the actionable list, so the next thing to do sits at the top.
    await seedNotes();
    const body = (await (await GET(new Request(url()))).json()) as { data: { note: string }[] };
    expect(body.data.map((n) => n.note)).toEqual(["Due soon", "Due later", "Finished"]);
  });

  it("filters to outstanding notes", async () => {
    await seedNotes();
    const body = (await (await GET(new Request(url("?outstanding=true")))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(2);
  });

  it("filters to resolved notes", async () => {
    await seedNotes();
    const body = (await (await GET(new Request(url("?outstanding=false")))).json()) as {
      data: { note: string }[];
    };
    expect(body.data.map((n) => n.note)).toEqual(["Finished"]);
  });

  it("filters by household", async () => {
    await seedNotes();
    const body = (await (
      await GET(new Request(url(`?householdId=${OTHER_HOUSEHOLD}`)))
    ).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("finds overdue notes with dueBefore", async () => {
    await seedNotes();
    const body = (await (
      await GET(new Request(url("?outstanding=true&dueBefore=2026-08-01T00:00:00.000Z")))
    ).json()) as { data: { note: string }[] };
    expect(body.data.map((n) => n.note)).toEqual(["Due soon"]);
  });

  it("lets a member filter to their own notes", async () => {
    await seedNotes();
    asAlice();
    const body = (await (await GET(new Request(url(`?authorId=${ALICE}`)))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(3);
  });

  it("refuses a member asking for another member's notes", async () => {
    await seedNotes();
    asBen();
    expect((await GET(new Request(url(`?authorId=${ALICE}`)))).status).toBe(403);
  });

  it("lets an admin filter by any author", async () => {
    await seedNotes();
    asAdmin();
    expect((await GET(new Request(url(`?authorId=${ALICE}`)))).status).toBe(200);
  });

  it("shows a household's notes to any member who can reach the unit", async () => {
    /*
     * Notes are not private to their author - the point of writing one down is
     * that whoever knocks next reads it.
     */
    await seedNotes();
    asBen();
    const body = (await (await GET(new Request(url(`?householdId=${HOUSEHOLD}`)))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(2);
  });

  it("paginates", async () => {
    await seedNotes();
    const body = (await (await GET(new Request(url("?limit=1")))).json()) as {
      data: unknown[];
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 3, hasMore: true });
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await GET(new Request(url()))).status).toBe(401);
  });
});
