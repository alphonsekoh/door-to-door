import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET, POST } = await import("./route");
const { PATCH } = await import("./[id]/route");
const { POST: REMOVE } = await import("./[id]/remove/route");

const pool = createTestPool();
const ADMIN = "aceaceac-0000-4000-8000-000000000001";
const ALICE = "aceaceac-0000-4000-8000-000000000002";
const BEN = "aceaceac-0000-4000-8000-000000000003";
const BLOCK = "aceaceac-0000-4000-8001-000000000001";
const HOUSEHOLD = "aceaceac-0000-4000-8003-000000000001";
const OTHER_HOUSEHOLD = "aceaceac-0000-4000-8003-000000000002";
const PAST = "aceaceac-0000-4000-8002-000000000001";
const TONIGHT = "aceaceac-0000-4000-8002-000000000002";
const VISIT = "01960000-0000-7000-8000-00000000ce01";

const as = (id: string, role: "admin" | "member") => () =>
  auth.mockImplementation(() => signedInAs(pool, { id, role }));
const asAdmin = as(ADMIN, "admin");
const asAlice = as(ALICE, "member");
const asBen = as(BEN, "member");

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
/* Every removal gives a reason, in the body. */
const removeWith = (id: string, body: unknown) =>
  REMOVE(
    new Request(url(`/${id}/remove`), {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );
const remove = (id: string, reason = "No longer needed") => removeWith(id, { reason });
const list = async (q = "") => {
  const response = await GET(new Request(url(q)));
  return {
    status: response.status,
    body: (await response.json()) as {
      data: { id: string; note: string; status: string; [key: string]: unknown }[];
      pagination: { total: number; hasMore: boolean };
    },
  };
};

type Note = {
  id: string;
  note: string;
  status: string;
  listedAt: string | null;
  listedBy: { name: string } | null;
  doneAt: string | null;
  doneBy: { name: string } | null;
  author: { name: string };
};
const read = async (response: Response) => (await response.json()) as Note;
type Failure = { error: { code: string; message: string } };
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

/* An admin's note: straight on the list. */
const listed = async (note: string, householdId = HOUSEHOLD, dueDate?: string) => {
  asAdmin();
  const response = await create({ householdId, note, ...(dueDate ? { dueDate } : {}) });
  expect(response.status).toBe(201);
  return (await read(response)).id;
};
/* A member's note: a suggestion waiting for review. */
const suggested = async (who: () => unknown, note: string, householdId = HOUSEHOLD) => {
  who();
  const response = await create({ householdId, note });
  expect(response.status).toBe(201);
  return (await read(response)).id;
};
/* Alice's words, put on the list by an admin. */
const alicesListed = async (note = "Alice's wording") => {
  const id = await suggested(asAlice, note);
  asAdmin();
  expect((await patch(id, { status: "listed" })).status).toBe(200);
  return id;
};

/* A running session; a follow-up session picked the households given. */
const run = async (kind: "regular" | "follow_up", householdIds: string[] = [HOUSEHOLD]) => {
  await pool.query(
    `INSERT INTO outing_sessions (id, title, kind, status, started_at, created_by)
     VALUES ($1,'Tonight',$2,'active', now() - interval '1 hour', $3)`,
    [TONIGHT, kind, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    TONIGHT,
    BLOCK,
  ]);
  if (kind === "regular") return;
  for (const householdId of householdIds) {
    await pool.query(`INSERT INTO session_households (session_id, household_id) VALUES ($1,$2)`, [
      TONIGHT,
      householdId,
    ]);
  }
};

const stored = async (id: string) =>
  (
    await pool.query<{
      deleted_at: Date | null;
      deleted_by: string | null;
      delete_reason: string | null;
    }>(`SELECT deleted_at, deleted_by, delete_reason FROM follow_ups WHERE id = $1`, [id])
  ).rows[0];

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
    `INSERT INTO outing_sessions (id, title, status, started_at, ended_at, created_by)
     VALUES ($1,'March','ended', now() - interval '30 days', now() - interval '29 days', $2)`,
    [PAST, ADMIN],
  );
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
     VALUES ($1,$2,$3,$4,'high')`,
    [VISIT, HOUSEHOLD, PAST, ALICE],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("creating a note", () => {
  it("puts an admin's note straight on the follow-up list", async () => {
    asAdmin();
    const response = await create({ householdId: HOUSEHOLD, note: "Bring the flyer." });
    expect(response.status).toBe(201);
    const body = await read(response);
    expect(body).toMatchObject({ status: "listed", listedBy: { name: "Admin" } });
    expect(body.listedAt).not.toBeNull();
  });

  it("makes a member's note a suggestion for an admin to review", async () => {
    asAlice();
    const body = await read(await create({ householdId: HOUSEHOLD, note: "Come back at 7pm." }));
    expect(body).toMatchObject({
      status: "suggested",
      listedAt: null,
      listedBy: null,
      author: { name: "Alice" },
    });
  });

  it("names the door and block it was left at", async () => {
    asAlice();
    const body = (await (
      await create({ householdId: HOUSEHOLD, note: "Bring the flyer." })
    ).json()) as unknown;
    expect(body).toMatchObject({
      householdId: HOUSEHOLD,
      blockId: BLOCK,
      blockName: "123",
      unitNumber: "#05-123",
    });
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

describe("suggesting a return visit", () => {
  it("is allowed with no session running", async () => {
    asAlice();
    expect((await create({ householdId: HOUSEHOLD, note: "Worth a visit" })).status).toBe(201);
  });

  it("is refused while the household is on the list and not yet done", async () => {
    await listed("Bring the flyer");
    asBen();
    const response = await create({ householdId: HOUSEHOLD, note: "Me too" });
    expect(response.status).toBe(409);
    expect(await code(response)).toBe("follow_up_exists");
  });

  it("is refused while another member's suggestion is waiting", async () => {
    await suggested(asAlice, "Asked us back");
    asBen();
    const response = await create({ householdId: HOUSEHOLD, note: "Also asked me" });
    expect(response.status).toBe(409);
    expect(await code(response)).toBe("follow_up_exists");
  });

  it("is refused while the member's own suggestion is waiting", async () => {
    await suggested(asAlice, "Asked us back");
    asAlice();
    expect(await code(await create({ householdId: HOUSEHOLD, note: "Again" }))).toBe(
      "follow_up_exists",
    );
  });

  it("is allowed again once the listed note is resolved", async () => {
    const id = await listed("Bring the flyer");
    asAdmin();
    await patch(id, { done: true });
    asAlice();
    expect((await create({ householdId: HOUSEHOLD, note: "Wants another" })).status).toBe(201);
  });

  it("is allowed again once a suggestion is dismissed", async () => {
    const id = await suggested(asAlice, "Asked us back");
    asAdmin();
    await remove(id, "Already visited");
    asBen();
    expect((await create({ householdId: HOUSEHOLD, note: "Asked again" })).status).toBe(201);
  });

  it("is allowed again once a listed note is removed from the list", async () => {
    const id = await listed("Bring the flyer");
    asAdmin();
    await remove(id);
    asAlice();
    expect((await create({ householdId: HOUSEHOLD, note: "Still keen" })).status).toBe(201);
  });

  it("lets exactly one of two members suggesting the same door at once succeed", async () => {
    // The database decides the race; there is no window between a check and the insert.
    auth
      .mockImplementationOnce(() => signedInAs(pool, { id: ALICE, role: "member" }))
      .mockImplementationOnce(() => signedInAs(pool, { id: BEN, role: "member" }));
    const responses = await Promise.all([
      create({ householdId: HOUSEHOLD, note: "Alice's" }),
      create({ householdId: HOUSEHOLD, note: "Ben's" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const { rows } = await pool.query(`SELECT 1 FROM follow_ups WHERE status = 'suggested'`);
    expect(rows).toHaveLength(1);
  });

  it("lets an admin add a second note to a household already on the list", async () => {
    // A household may carry several listed notes; only members are limited.
    await listed("First");
    asAdmin();
    expect((await create({ householdId: HOUSEHOLD, note: "Second" })).status).toBe(201);
  });

  it("refuses an admin's own note while a suggestion for the household waits", async () => {
    // Listed beside it, the suggestion would wait on a listed household, and
    // dismissing it would tell Alice it was declined when it was not.
    const id = await suggested(asAlice, "Waiting");
    asAdmin();
    const response = await create({ householdId: HOUSEHOLD, note: "Listed too" });
    expect(response.status).toBe(409);
    expect(await code(response)).toBe("follow_up_exists");
    const { rows } = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM follow_ups WHERE household_id = $1`,
      [HOUSEHOLD],
    );
    expect(rows).toEqual([{ id, status: "suggested" }]);
  });

  it("lets an admin add the household once the waiting suggestion is dismissed", async () => {
    const id = await suggested(asAlice, "Waiting");
    asAdmin();
    await remove(id, "Not this time");
    expect((await create({ householdId: HOUSEHOLD, note: "Listed after all" })).status).toBe(201);
  });
});

describe("promoting a suggestion", () => {
  it("puts it on the list and records the admin who did", async () => {
    const id = await suggested(asAlice, "Asked us back");
    asAdmin();
    const body = await read(await patch(id, { status: "listed" }));
    expect(body).toMatchObject({
      status: "listed",
      listedBy: { name: "Admin" },
      author: { name: "Alice" },
    });
    expect(body.listedAt).not.toBeNull();
  });

  it("changes nothing when the note is already listed", async () => {
    const id = await alicesListed();
    asAdmin();
    const before = (await list(`?householdId=${HOUSEHOLD}`)).body.data[0];
    const after = await read(await patch(id, { status: "listed" }));
    expect(after.listedAt).toBe(before?.["listedAt"]);
  });

  it("refuses a member, even the author", async () => {
    const id = await suggested(asAlice, "Asked us back");
    asAlice();
    expect((await patch(id, { status: "listed" })).status).toBe(403);
  });

  it("can resolve in the same request", async () => {
    const id = await suggested(asAlice, "Asked us back");
    asAdmin();
    const body = await read(await patch(id, { status: "listed", done: true }));
    expect(body.status).toBe("listed");
    expect(body.doneBy?.name).toBe("Admin");
  });

  it("refuses an admin resolving a suggestion without listing it", async () => {
    const id = await suggested(asAlice, "Asked us back");
    asAdmin();
    const response = await patch(id, { done: true });
    expect(response.status).toBe(409);
    expect(await code(response)).toBe("conflict");
  });

  it("lets an admin reword a suggestion", async () => {
    const id = await suggested(asAlice, "Asked us bak");
    asAdmin();
    expect((await read(await patch(id, { note: "Asked us back" }))).note).toBe("Asked us back");
  });
});

describe("a member and a suggestion", () => {
  it("lets the author reword it with no session running", async () => {
    const id = await suggested(asAlice, "Typo");
    asAlice();
    expect((await read(await patch(id, { note: "Corrected" }))).note).toBe("Corrected");
  });

  it("lets the author set its due date", async () => {
    const id = await suggested(asAlice, "Soon");
    asAlice();
    const body = (await (await patch(id, { dueDate: "2026-10-01T00:00:00.000Z" })).json()) as {
      dueDate: string;
    };
    expect(body.dueDate).toBe("2026-10-01T00:00:00.000Z");
  });

  it("refuses another member rewording it", async () => {
    const id = await suggested(asAlice, "Alice's");
    asBen();
    expect((await patch(id, { note: "Ben's" })).status).toBe(403);
  });

  it("refuses another member marking it done", async () => {
    const id = await suggested(asAlice, "Alice's");
    asBen();
    expect((await patch(id, { done: true })).status).toBe(403);
  });

  it("refuses the author marking it done, since it is not on the list", async () => {
    const id = await suggested(asAlice, "Alice's");
    asAlice();
    const response = await patch(id, { done: true });
    expect(response.status).toBe(409);
    expect(await code(response)).toBe("conflict");
  });

  it("lets the author withdraw it", async () => {
    const id = await suggested(asAlice, "Changed my mind");
    asAlice();
    expect((await remove(id)).status).toBe(204);
    expect((await stored(id))?.deleted_by).toBe(ALICE);
  });

  it("refuses another member withdrawing it", async () => {
    const id = await suggested(asAlice, "Alice's");
    asBen();
    expect((await remove(id)).status).toBe(403);
  });
});

describe("a member and a listed note outside its follow-up session", () => {
  it("refuses resolving it with no session running", async () => {
    const id = await listed("Bring the flyer");
    asAlice();
    const response = await patch(id, { done: true });
    expect(response.status).toBe(409);
    expect(await code(response)).toBe("not_on_follow_up_list");
  });

  it("refuses resolving it in a regular session", async () => {
    await run("regular");
    const id = await listed("Bring the flyer");
    asAlice();
    expect(await code(await patch(id, { done: true }))).toBe("not_on_follow_up_list");
  });

  it("refuses resolving it in a follow-up session that did not pick its household", async () => {
    await run("follow_up", [OTHER_HOUSEHOLD]);
    const id = await listed("Bring the flyer");
    asAlice();
    expect(await code(await patch(id, { done: true }))).toBe("not_on_follow_up_list");
  });

  it("refuses the author rewording it", async () => {
    const id = await alicesListed();
    asAlice();
    expect(await code(await patch(id, { note: "New words" }))).toBe("not_on_follow_up_list");
  });

  it("refuses another member's rewording as forbidden before anything else", async () => {
    // 403 is a right they never have; 409 only says when they would have it.
    const id = await alicesListed();
    asBen();
    expect((await patch(id, { note: "Ben's" })).status).toBe(403);
  });

  it("refuses removing it, even for its author", async () => {
    const id = await alicesListed();
    asAlice();
    expect((await remove(id)).status).toBe(403);
  });
});

describe("a member and a listed note in its follow-up session", () => {
  beforeEach(async () => {
    await run("follow_up", [HOUSEHOLD, OTHER_HOUSEHOLD]);
  });

  it("lets any member resolve it, and records who did", async () => {
    const id = await listed("Bring the flyer");
    asBen();
    const response = await patch(id, { done: true });
    expect(response.status).toBe(200);
    expect((await read(response)).doneBy?.name).toBe("Ben");
  });

  it("keeps the first resolver when it is marked done again", async () => {
    const id = await listed("Bring the flyer");
    asAlice();
    const first = await read(await patch(id, { done: true }));
    asBen();
    const second = await read(await patch(id, { done: true }));
    expect(second.doneBy?.name).toBe("Alice");
    expect(second.doneAt).toBe(first.doneAt);
  });

  it("lets another member reopen one resolved during the session", async () => {
    const id = await listed("Bring the flyer");
    asAlice();
    await patch(id, { done: true });
    asBen();
    const body = await read(await patch(id, { done: false }));
    expect(body.doneAt).toBeNull();
    expect(body.doneBy).toBeNull();
  });

  it("refuses reopening one resolved before the session started", async () => {
    // It is not on tonight's list, so it is not tonight's to change.
    const id = await listed("Bring the flyer");
    await pool.query(`UPDATE follow_ups SET done_at = now() - interval '2 hours' WHERE id = $1`, [
      id,
    ]);
    asAlice();
    expect(await code(await patch(id, { done: false }))).toBe("not_on_follow_up_list");
  });

  it("lets the author reword it", async () => {
    const id = await alicesListed();
    asAlice();
    expect((await read(await patch(id, { note: "Better words" }))).note).toBe("Better words");
  });

  it("refuses another member rewording it", async () => {
    const id = await alicesListed();
    asBen();
    expect((await patch(id, { note: "Ben's rewrite" })).status).toBe(403);
  });

  it("refuses another member changing its due date", async () => {
    const id = await alicesListed();
    asBen();
    expect((await patch(id, { dueDate: "2026-12-01T00:00:00.000Z" })).status).toBe(403);
  });

  it("refuses a resolution bundled with another member's edit", async () => {
    // Otherwise `done` would be a way to smuggle in a rewrite.
    const id = await alicesListed();
    asBen();
    expect((await patch(id, { done: true, note: "and rewritten" })).status).toBe(403);
  });

  it("refuses removing it", async () => {
    const id = await alicesListed();
    asAlice();
    expect((await remove(id)).status).toBe(403);
  });

  it("still names the door after an update", async () => {
    const id = await listed("Call back", OTHER_HOUSEHOLD);
    asAlice();
    const body = (await (await patch(id, { done: true })).json()) as unknown;
    expect(body).toMatchObject({ blockName: "123", unitNumber: "#06-201" });
  });
});

describe("an admin and a listed note", () => {
  it("resolves it with no session running", async () => {
    const id = await listed("Bring the flyer");
    asAdmin();
    expect((await read(await patch(id, { done: true }))).doneBy?.name).toBe("Admin");
  });

  it("rewords anyone's", async () => {
    const id = await alicesListed();
    asAdmin();
    expect((await patch(id, { note: "Tidied" })).status).toBe(200);
  });

  it("can set and clear a due date", async () => {
    const id = await listed("No date yet");
    asAdmin();
    const set = (await (await patch(id, { dueDate: "2026-10-01T00:00:00.000Z" })).json()) as {
      dueDate: string | null;
    };
    expect(set.dueDate).toBe("2026-10-01T00:00:00.000Z");
    const cleared = (await (await patch(id, { dueDate: null })).json()) as {
      dueDate: string | null;
    };
    expect(cleared.dueDate).toBeNull();
  });

  it("rejects an empty change with 400", async () => {
    const id = await listed("x");
    asAdmin();
    expect((await patch(id, {})).status).toBe(400);
  });

  it("returns 404 for an unknown note", async () => {
    asAdmin();
    expect((await patch("aceaceac-0000-4000-8004-00000000ffff", { note: "x" })).status).toBe(404);
  });
});

describe("removing a note", () => {
  it("keeps the row, with who removed it, when and why, trimmed", async () => {
    const id = await listed("Bring the flyer");
    asAdmin();
    expect((await remove(id, "  Moved away  ")).status).toBe(204);
    const row = await stored(id);
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.deleted_by).toBe(ADMIN);
    expect(row?.delete_reason).toBe("Moved away");
  });

  it.each<[string, unknown]>([
    ["no body", undefined],
    ["no reason", {}],
    ["an empty reason", { reason: "" }],
    ["a reason of spaces", { reason: "   " }],
    ["a reason over 500 characters", { reason: "x".repeat(501) }],
  ])("refuses %s with 400 and removes nothing", async (_case, body) => {
    const id = await suggested(asAlice, "Asked us back");
    asAdmin();
    const response = await removeWith(id, body);
    expect(response.status).toBe(400);
    expect(await code(response)).toBe("validation_failed");
    expect((await stored(id))?.deleted_at).toBeNull();
  });

  it("takes a reason of exactly 500 characters", async () => {
    const id = await listed("Bring the flyer");
    asAdmin();
    expect((await remove(id, "x".repeat(500))).status).toBe(204);
  });

  it("asks for the reason in the body, never the address", async () => {
    // Free text about a household must not land in a proxy or access log.
    const id = await listed("Bring the flyer");
    asAdmin();
    const response = await REMOVE(
      new Request(url(`/${id}/remove?reason=Moved`), { method: "POST" }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(400);
    expect((await stored(id))?.deleted_at).toBeNull();
  });

  it("refuses a member removing a listed note, even their own", async () => {
    const id = await alicesListed();
    asAlice();
    expect((await remove(id)).status).toBe(403);
    expect((await stored(id))?.deleted_at).toBeNull();
  });

  it("refuses a member withdrawing another member's suggestion", async () => {
    const id = await suggested(asAlice, "Alice's");
    asBen();
    expect((await remove(id)).status).toBe(403);
    expect((await stored(id))?.deleted_at).toBeNull();
  });

  it("treats a removed note as gone to anyone changing it", async () => {
    const id = await suggested(asAlice, "Asked us back");
    asAdmin();
    await remove(id);
    expect((await patch(id, { status: "listed" })).status).toBe(404);
    expect((await remove(id)).status).toBe(404);
    asAlice();
    expect((await patch(id, { note: "Again" })).status).toBe(404);
    expect((await remove(id)).status).toBe(404);
  });

  it("keeps the first removal's reason", async () => {
    const id = await listed("Bring the flyer");
    asAdmin();
    await remove(id, "Moved away");
    await remove(id, "Second thoughts");
    expect((await stored(id))?.delete_reason).toBe("Moved away");
  });

  it("returns 404 for an unknown note", async () => {
    asAdmin();
    expect((await remove("aceaceac-0000-4000-8004-00000000ffff")).status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    const id = await listed("x");
    auth.mockResolvedValue(null);
    expect((await remove(id)).status).toBe(401);
  });
});

describe("a suggestion waiting at a door with a resolved listed note", () => {
  /* Bring the flyer, listed and resolved in tonight's session, with Ben's
     suggestion sent since. */
  const setUp = async () => {
    await run("follow_up");
    const note = await listed("Bring the flyer");
    asAlice();
    expect((await patch(note, { done: true })).status).toBe(200);
    const suggestion = await suggested(asBen, "Asked us back again");
    return { note, suggestion };
  };
  type Waiting = { waitingSuggestionBy: { id: string; name: string } | null };
  const noteOf = async (id: string) =>
    (await list(`?householdId=${HOUSEHOLD}`)).body.data.find((n) => n.id === id) as
      (Note & Waiting) | undefined;

  it("is named on the listed note, and on nothing else", async () => {
    const { note, suggestion } = await setUp();
    asAlice();
    expect((await noteOf(note))?.waitingSuggestionBy).toEqual({
      id: BEN,
      name: "Ben",
      image: null,
    });
    expect((await noteOf(suggestion))?.waitingSuggestionBy).toBeNull();
  });

  it("is not named on a removed note", async () => {
    const { note } = await setUp();
    asAdmin();
    await remove(note);
    const { body } = await list(`?deleted=true&householdId=${HOUSEHOLD}`);
    expect(body.data.map((n) => [n.id, n["waitingSuggestionBy"]])).toEqual([[note, null]]);
  });

  it("is null once the suggestion is listed", async () => {
    const { note, suggestion } = await setUp();
    asAdmin();
    await patch(suggestion, { status: "listed" });
    expect((await noteOf(note))?.waitingSuggestionBy).toBeNull();
  });

  it("is listed by an admin's reopen, in the same change", async () => {
    const { note, suggestion } = await setUp();
    asAdmin();
    const response = await patch(note, { done: false });
    expect(response.status).toBe(200);
    expect((await read(response)).doneAt).toBeNull();
    const listedNow = await noteOf(suggestion);
    expect(listedNow).toMatchObject({ status: "listed", listedBy: { name: "Admin" } });
    expect(listedNow?.listedAt).not.toBeNull();
    // Off the review queue, so its author is never told it was declined.
    expect((await list("?status=suggested")).body.data).toEqual([]);
  });

  it("refuses a member's reopen, says why, and changes nothing", async () => {
    const { note, suggestion } = await setUp();
    asAlice();
    const response = await patch(note, { done: false });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: unknown }).error).toEqual({
      code: "follow_up_exists",
      message: "Ben's suggestion for this door is waiting for an admin. Ask an admin to review it.",
    });
    expect((await noteOf(note))?.doneAt).not.toBeNull();
    expect((await noteOf(suggestion))?.status).toBe("suggested");
  });

  /* As the screen says it: a first name, "Your" to the suggester, "Someone". */
  const refusal = async (note: string) =>
    ((await (await patch(note, { done: false })).json()) as Failure).error.message;

  it("names the suggester by first name, as the screen does", async () => {
    const { note } = await setUp();
    await pool.query(`UPDATE users SET name = 'Ben Tan' WHERE id = $1`, [BEN]);
    asAlice();
    expect(await refusal(note)).toBe(
      "Ben's suggestion for this door is waiting for an admin. Ask an admin to review it.",
    );
  });

  it("says Your to the member whose suggestion waits", async () => {
    const { note } = await setUp();
    asBen();
    expect(await refusal(note)).toBe(
      "Your suggestion for this door is waiting for an admin. Ask an admin to review it.",
    );
  });

  it("says Someone's when the suggester has no name", async () => {
    const { note } = await setUp();
    await pool.query(`UPDATE users SET name = NULL WHERE id = $1`, [BEN]);
    asAlice();
    expect(await refusal(note)).toBe(
      "Someone's suggestion for this door is waiting for an admin. Ask an admin to review it.",
    );
  });

  it("refuses the member as off the list first, outside the session", async () => {
    const { note } = await setUp();
    await pool.query(`UPDATE outing_sessions SET status = 'ended' WHERE id = $1`, [TONIGHT]);
    asAlice();
    expect(await code(await patch(note, { done: false }))).toBe("not_on_follow_up_list");
  });

  it("lets a member reopen when no suggestion waits", async () => {
    const { note, suggestion } = await setUp();
    asBen();
    await remove(suggestion, "Changed my mind");
    asAlice();
    expect((await patch(note, { done: false })).status).toBe(200);
  });

  it("is left alone by a reopen of a note that is not resolved", async () => {
    await run("follow_up");
    const note = await listed("Bring the flyer");
    await pool.query(
      `INSERT INTO follow_ups (household_id, note, author_id, status) VALUES ($1,'Leftover',$2,'suggested')`,
      [HOUSEHOLD, BEN],
    );
    asAlice();
    expect((await patch(note, { done: false })).status).toBe(200);
    expect((await list("?status=suggested")).body.data.map((n) => n.note)).toEqual(["Leftover"]);
  });
});

describe("listing", () => {
  const seedNotes = async () => {
    await listed("Due soon", HOUSEHOLD, "2026-07-15T00:00:00.000Z");
    await listed("Due later", HOUSEHOLD, "2026-09-30T00:00:00.000Z");
    const done = await listed("Finished", OTHER_HOUSEHOLD);
    asAdmin();
    await patch(done, { done: true });
  };

  it("puts outstanding notes before resolved ones, earliest due first", async () => {
    // This is the actionable list, so the next thing to do sits at the top.
    await seedNotes();
    expect((await list()).body.data.map((n) => n.note)).toEqual([
      "Due soon",
      "Due later",
      "Finished",
    ]);
  });

  it("filters to outstanding notes", async () => {
    await seedNotes();
    expect((await list("?outstanding=true")).body.data).toHaveLength(2);
  });

  it("filters to resolved notes", async () => {
    await seedNotes();
    expect((await list("?outstanding=false")).body.data.map((n) => n.note)).toEqual(["Finished"]);
  });

  it("filters by household", async () => {
    await seedNotes();
    expect((await list(`?householdId=${OTHER_HOUSEHOLD}`)).body.data).toHaveLength(1);
  });

  it("filters by status", async () => {
    await seedNotes();
    await suggested(asAlice, "Asked us back", OTHER_HOUSEHOLD);
    asAdmin();
    expect((await list("?status=suggested")).body.data.map((n) => n.note)).toEqual([
      "Asked us back",
    ]);
    expect((await list("?status=listed")).body.data).toHaveLength(3);
  });

  it("finds overdue notes with dueBefore", async () => {
    await seedNotes();
    expect(
      (await list("?outstanding=true&dueBefore=2026-08-01T00:00:00.000Z")).body.data.map(
        (n) => n.note,
      ),
    ).toEqual(["Due soon"]);
  });

  it("treats dueBefore as strictly before, so a note due today is not yet overdue", async () => {
    // Callers pass the start of today; a note due on that day starts at that instant.
    await listed("Due today", HOUSEHOLD, "2026-10-13T16:00:00.000Z");
    await listed("Due yesterday", HOUSEHOLD, "2026-10-12T16:00:00.000Z");
    await listed("Undated");
    expect(
      (await list("?outstanding=true&dueBefore=2026-10-13T16:00:00.000Z")).body.data.map(
        (n) => n.note,
      ),
    ).toEqual(["Due yesterday"]);
  });

  it("names each note's door in a list across households", async () => {
    await seedNotes();
    expect((await list()).body.data.map((n) => [n.note, n["blockName"], n["unitNumber"]])).toEqual([
      ["Due soon", "123", "#05-123"],
      ["Due later", "123", "#05-123"],
      ["Finished", "123", "#06-201"],
    ]);
  });

  it("leaves removed notes out", async () => {
    await seedNotes();
    const gone = await listed("Removed overdue", OTHER_HOUSEHOLD, "2026-07-01T00:00:00.000Z");
    asAdmin();
    await remove(gone);
    const { body } = await list();
    expect(body.data.map((n) => n.note)).not.toContain("Removed overdue");
    expect(body.pagination.total).toBe(3);
    // Nor is it overdue any more.
    expect(
      (await list("?outstanding=true&dueBefore=2026-08-01T00:00:00.000Z")).body.data.map(
        (n) => n.note,
      ),
    ).toEqual(["Due soon"]);
  });

  it("lets a member filter to their own notes", async () => {
    await suggested(asAlice, "Mine", HOUSEHOLD);
    await listed("Not mine", OTHER_HOUSEHOLD);
    asAlice();
    expect((await list(`?authorId=${ALICE}`)).body.data.map((n) => n.note)).toEqual(["Mine"]);
  });

  it("refuses a member asking for another member's notes", async () => {
    asBen();
    expect((await list(`?authorId=${ALICE}`)).status).toBe(403);
  });

  it("lets an admin filter by any author", async () => {
    asAdmin();
    expect((await list(`?authorId=${ALICE}`)).status).toBe(200);
  });

  it("shows a household's notes, suggestions included, to any member", async () => {
    /*
     * Notes are not private to their author - the point of writing one down is
     * that whoever knocks next reads it.
     */
    await listed("On the list");
    await suggested(asAlice, "Suggested by Alice", OTHER_HOUSEHOLD);
    asBen();
    expect((await list()).body.data.map((n) => n.note)).toEqual([
      "On the list",
      "Suggested by Alice",
    ]);
  });

  it("paginates", async () => {
    await seedNotes();
    const { body } = await list("?limit=1");
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 3, hasMore: true });
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
  });
});

describe("reading removed notes", () => {
  const seedRemoved = async () => {
    const dismissed = await suggested(asAlice, "Dismissed one");
    asAdmin();
    await remove(dismissed, "Already visited");
    const taken = await listed("Taken off", OTHER_HOUSEHOLD);
    asAdmin();
    await remove(taken);
    await listed("Still listed");
  };

  it("gives an admin only removed notes, newest removal first", async () => {
    await seedRemoved();
    asAdmin();
    const { status, body } = await list("?deleted=true");
    expect(status).toBe(200);
    expect(body.data.map((n) => n.note)).toEqual(["Taken off", "Dismissed one"]);
    expect(body.data[1]).toMatchObject({
      deletedBy: { name: "Admin" },
      deleteReason: "Already visited",
    });
  });

  it("lets a member read their own removed notes, with the reason", async () => {
    await seedRemoved();
    asAlice();
    const { status, body } = await list(`?deleted=true&authorId=${ALICE}`);
    expect(status).toBe(200);
    expect(body.data.map((n) => [n.note, n["deleteReason"]])).toEqual([
      ["Dismissed one", "Already visited"],
    ]);
  });

  it("refuses a member reading everyone's removed notes", async () => {
    asAlice();
    expect((await list("?deleted=true")).status).toBe(403);
  });

  it("refuses a member reading another member's removed notes", async () => {
    asBen();
    expect((await list(`?deleted=true&authorId=${ALICE}`)).status).toBe(403);
  });
});

describe("reading the removals an author is told about", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const since = () => new Date(Date.now() - 30 * DAY).toISOString();

  /*
   * 105 of Alice's notes removed by the admin in the last month, one every
   * five hours; 30 she withdrew herself, every 17 hours, so they fall
   * between them; two the admin removed 40 days ago; one of Ben's.
   */
  const seed = async () => {
    await pool.query(
      `INSERT INTO follow_ups (household_id, note, author_id, status, deleted_at, deleted_by, delete_reason)
       SELECT $1, 'Removed ' || i, $2, CASE WHEN i % 2 = 0 THEN 'listed' ELSE 'suggested' END::follow_up_status,
              now() - i * interval '5 hours', $3, 'Reason ' || i
       FROM generate_series(1, 105) AS i`,
      [HOUSEHOLD, ALICE, ADMIN],
    );
    await pool.query(
      `INSERT INTO follow_ups (household_id, note, author_id, status, deleted_at, deleted_by, delete_reason)
       SELECT $1, 'Withdrawn ' || i, $2, 'suggested', now() - i * interval '17 hours', $2, 'Changed my mind'
       FROM generate_series(1, 30) AS i`,
      [HOUSEHOLD, ALICE],
    );
    await pool.query(
      `INSERT INTO follow_ups (household_id, note, author_id, status, deleted_at, deleted_by, delete_reason)
       SELECT $1, 'Long ago ' || i, $2, 'suggested', now() - interval '40 days', $3, 'Old'
       FROM generate_series(1, 2) AS i`,
      [HOUSEHOLD, ALICE, ADMIN],
    );
    await pool.query(
      `INSERT INTO follow_ups (household_id, note, author_id, status, deleted_at, deleted_by, delete_reason)
       VALUES ($1, 'Ben''s', $2, 'suggested', now() - interval '1 hour', $3, 'Visited')`,
      [HOUSEHOLD, BEN, ADMIN],
    );
  };
  const told = (extra = "") =>
    `?deleted=true&authorId=${ALICE}&removedByOthers=true&deletedSince=${encodeURIComponent(since())}${extra}`;

  it("pages through every removal by others in the window, and none of her own", async () => {
    await seed();
    asAlice();
    const first = await list(told("&limit=100"));
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(100);
    expect(first.body.pagination).toMatchObject({ total: 105, hasMore: true });

    const second = await list(told("&limit=100&offset=100"));
    expect(second.body.data).toHaveLength(5);
    expect(second.body.pagination).toMatchObject({ total: 105, hasMore: false });

    // Exactly the 105, newest removal first, each with who removed it and why.
    const all = [...first.body.data, ...second.body.data];
    expect(all.map((n) => n.note)).toEqual(
      Array.from({ length: 105 }, (_, i) => `Removed ${String(i + 1)}`),
    );
    expect(new Set(all.map((n) => n.id)).size).toBe(105);
    expect(all[1]).toMatchObject({
      status: "listed",
      deletedBy: { id: ADMIN, name: "Admin" },
      deleteReason: "Reason 2",
    });
  });

  it("counts removals older than the window only without it", async () => {
    await seed();
    asAlice();
    const { body } = await list(`?deleted=true&authorId=${ALICE}&removedByOthers=true&limit=1`);
    expect(body.pagination.total).toBe(107);
  });

  it("gives only the author's own withdrawals with removedByOthers=false", async () => {
    await seed();
    asAlice();
    const { status, body } = await list(
      `?deleted=true&authorId=${ALICE}&removedByOthers=false&limit=100`,
    );
    expect(status).toBe(200);
    expect(body.pagination.total).toBe(30);
    expect(body.data.every((n) => n.note.startsWith("Withdrawn "))).toBe(true);
  });

  it("gives an admin everyone's removals by others", async () => {
    await seed();
    asAdmin();
    const { body } = await list(
      `?deleted=true&removedByOthers=true&deletedSince=${encodeURIComponent(since())}&limit=1`,
    );
    expect(body.pagination.total).toBe(106);
  });

  it("tells the author of a backfilled listed note an admin removed it, and why", async () => {
    // Written before suggestions existed: listed, by a member, with no lister.
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO follow_ups (household_id, note, author_id, status) VALUES ($1,'Bring the flyer',$2,'listed') RETURNING id`,
      [HOUSEHOLD, ALICE],
    );
    const id = inserted.rows[0]?.id ?? "";
    asAdmin();
    expect((await remove(id, "The family has moved")).status).toBe(204);

    asAlice();
    for (const query of [`?deleted=true&authorId=${ALICE}`, told()]) {
      const { status, body } = await list(query);
      expect(status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        id,
        status: "listed",
        listedBy: null,
        author: { id: ALICE },
        deletedBy: { id: ADMIN, name: "Admin" },
        deleteReason: "The family has moved",
      });
    }
  });

  it.each([
    ["removedByOthers", "?removedByOthers=true"],
    ["deletedSince", `?deletedSince=${encodeURIComponent(new Date().toISOString())}`],
    ["removedByOthers", "?deleted=false&removedByOthers=false"],
  ])("refuses %s without deleted=true as a bad request", async (name, query) => {
    asAdmin();
    const response = await GET(new Request(url(query)));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: unknown }).error).toEqual({
      code: "validation_failed",
      message: "Invalid query parameters.",
      details: [{ path: `/${name}`, message: "Only with deleted=true." }],
    });
  });

  it("is a bad request before it is a refusal, for a member asking about someone else", async () => {
    asAlice();
    const response = await GET(
      new Request(
        url(`?authorId=${BEN}&removedByOthers=true&deletedSince=${encodeURIComponent(since())}`),
      ),
    );
    expect(response.status).toBe(400);
    const details = ((await response.json()) as { error: { details: { path: string }[] } }).error
      .details;
    expect(details.map((detail) => detail.path)).toEqual(["/removedByOthers", "/deletedSince"]);
  });

  it("never widens what a member may read", async () => {
    await seed();
    asAlice();
    expect((await list("?deleted=true&removedByOthers=true")).status).toBe(403);
    expect(
      (
        await list(
          `?deleted=true&authorId=${BEN}&removedByOthers=true&deletedSince=${encodeURIComponent(since())}`,
        )
      ).status,
    ).toBe(403);
  });
});
