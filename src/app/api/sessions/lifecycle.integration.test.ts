import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { POST: createSessionRoute } = await import("./route");
const { GET: getActive } = await import("./active/route");
const { GET: getOne } = await import("./[id]/route");
const { POST: start } = await import("./[id]/start/route");
const { POST: end } = await import("./[id]/end/route");
const { POST: reopen } = await import("./[id]/reopen/route");

const pool = createTestPool();
const ADMIN = "ffffffff-0000-4000-8000-000000000001";
const MEMBER = "ffffffff-0000-4000-8000-000000000002";
const BLOCK = "ffffffff-0000-4000-8001-000000000001";
const HOUSEHOLD = "ffffffff-0000-4000-8003-000000000001";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asMember = () =>
  auth.mockResolvedValue({ user: { id: MEMBER, role: "member", deactivated: false } });

const url = (path: string) => `https://test.local/api/sessions${path}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (path: string) => new Request(url(path), { method: "POST" });

async function newDraft(
  title = "Outing",
  blockIds?: string[],
  kind?: "regular" | "follow_up",
): Promise<string> {
  asAdmin();
  const response = await createSessionRoute(
    new Request(url(""), {
      method: "POST",
      body: JSON.stringify({
        title,
        ...(blockIds ? { blockIds } : {}),
        ...(kind ? { kind } : {}),
        // A follow-up session is created with the households it goes back to.
        ...(kind === "follow_up" ? { householdIds: [HOUSEHOLD] } : {}),
      }),
      headers: { "content-type": "application/json" },
    }),
  );
  const body = (await response.json()) as { id: string };
  return body.id;
}

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'a@t.local','Admin','admin'), ($2,'m@t.local','Member','member')`,
    [ADMIN, MEMBER],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1, '123', 'Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number) VALUES ($1, $2, '#05-123')`,
    [HOUSEHOLD, BLOCK],
  );
  await pool.query(
    `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1, $2, 'Bring the flyer')`,
    [HOUSEHOLD, ADMIN],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("the lifecycle over HTTP", () => {
  it("runs draft -> active -> ended -> active", async () => {
    const id = await newDraft();
    asAdmin();

    expect(
      ((await (await start(post(`/${id}/start`), ctx(id))).json()) as { status: string }).status,
    ).toBe("active");
    expect(
      ((await (await end(post(`/${id}/end`), ctx(id))).json()) as { status: string }).status,
    ).toBe("ended");
    expect(
      ((await (await reopen(post(`/${id}/reopen`), ctx(id))).json()) as { status: string }).status,
    ).toBe("active");
  });

  it("returns 409 when starting a second session", async () => {
    const first = await newDraft("First");
    const second = await newDraft("Second");
    asAdmin();
    await start(post(`/${first}/start`), ctx(first));

    const response = await start(post(`/${second}/start`), ctx(second));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("session_already_active");
  });

  it("allows one active session whatever its kind", async () => {
    const regular = await newDraft("Door-to-door");
    const followUp = await newDraft("Follow-up", undefined, "follow_up");
    asAdmin();
    await start(post(`/${regular}/start`), ctx(regular));

    const response = await start(post(`/${followUp}/start`), ctx(followUp));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "session_already_active",
    );
  });

  it("keeps a session's kind through start, end and reopen", async () => {
    const id = await newDraft("Follow-up", undefined, "follow_up");
    asAdmin();
    await start(post(`/${id}/start`), ctx(id));
    await end(post(`/${id}/end`), ctx(id));
    const reopened = (await (await reopen(post(`/${id}/reopen`), ctx(id))).json()) as {
      kind: string;
    };
    expect(reopened.kind).toBe("follow_up");
  });

  it("returns 409 for an illegal transition", async () => {
    const id = await newDraft();
    asAdmin();
    expect((await end(post(`/${id}/end`), ctx(id))).status).toBe(409);
  });

  it("returns 404 for a session that does not exist", async () => {
    asAdmin();
    const missing = "ffffffff-0000-4000-8002-00000000ffff";
    expect((await start(post(`/${missing}/start`), ctx(missing))).status).toBe(404);
  });

  it("returns 400 for a malformed id, not 404", async () => {
    asAdmin();
    expect((await getOne(new Request(url("/nope")), ctx("not-a-uuid"))).status).toBe(400);
  });

  it.each([
    ["start", start],
    ["end", end],
    ["reopen", reopen],
  ])("refuses a member calling %s", async (name, handler) => {
    const id = await newDraft();
    asMember();
    expect((await handler(post(`/${id}/${name}`), ctx(id))).status).toBe(403);
  });
});

describe("GET /api/sessions/active", () => {
  it("returns 404 when no session is running", async () => {
    // A normal empty state, which the contract documents deliberately.
    asMember();
    const response = await getActive(new Request(url("/active")));
    expect(response.status).toBe(404);
  });

  it("is available to members, not just admins", async () => {
    const id = await newDraft("Outing", [BLOCK]);
    asAdmin();
    await start(post(`/${id}/start`), ctx(id));

    asMember();
    const response = await getActive(new Request(url("/active")));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: { id: string };
      blocks: { block: { name: string }; visitCount: number; activeMembers: unknown[] }[];
    };
    expect(body.session.id).toBe(id);
    expect(body.blocks[0]?.block.name).toBe("123");
    expect(body.blocks[0]?.visitCount).toBe(0);
    expect(body.blocks[0]?.activeMembers).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    expect((await getActive(new Request(url("/active")))).status).toBe(401);
  });
});

describe("GET /api/sessions/{id}", () => {
  it("returns the session for an admin", async () => {
    const id = await newDraft("Readable");
    asAdmin();
    const body = (await (await getOne(new Request(url(`/${id}`)), ctx(id))).json()) as {
      title: string;
    };
    expect(body.title).toBe("Readable");
  });

  it("refuses a member", async () => {
    const id = await newDraft();
    asMember();
    expect((await getOne(new Request(url(`/${id}`)), ctx(id))).status).toBe(403);
  });
});
