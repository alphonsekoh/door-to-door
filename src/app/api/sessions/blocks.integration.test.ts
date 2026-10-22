import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET: listBlocks, POST: attach } = await import("./[id]/blocks/route");
const { DELETE: detach } = await import("./[id]/blocks/[blockId]/route");
const { POST: startSession } = await import("./[id]/start/route");

const pool = createTestPool();
const ADMIN = "bcbcbcbc-0000-4000-8000-000000000001";
const MEMBER = "bcbcbcbc-0000-4000-8000-000000000002";
const SESSION = "bcbcbcbc-0000-4000-8002-000000000001";
const BLOCK_A = "bcbcbcbc-0000-4000-8001-000000000001";
const BLOCK_B = "bcbcbcbc-0000-4000-8001-000000000002";
const HOUSEHOLD = "bcbcbcbc-0000-4000-8003-000000000001";

const asAdmin = () =>
  auth.mockResolvedValue({ user: { id: ADMIN, role: "admin", deactivated: false } });
const asMember = () =>
  auth.mockResolvedValue({ user: { id: MEMBER, role: "member", deactivated: false } });

const url = (p: string) => `https://test.local/api/sessions${p}`;
const ctx = (id = SESSION, blockId?: string) => ({
  params: Promise.resolve(blockId === undefined ? { id } : { id, blockId }),
});

const attachRequest = (blockIds: string[]) =>
  new Request(url(`/${SESSION}/blocks`), {
    method: "POST",
    body: JSON.stringify({ blockIds }),
    headers: { "content-type": "application/json" },
  });

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'a@t.local','Admin','admin'), ($2,'m@t.local','Member','member')`,
    [ADMIN, MEMBER],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave'), ($2,'125','Test Ave')`,
    [BLOCK_A, BLOCK_B],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Outing','draft',$2)`,
    [SESSION, ADMIN],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("attaching", () => {
  it("attaches blocks and returns them with progress", async () => {
    asAdmin();
    const response = await attach(attachRequest([BLOCK_A, BLOCK_B]), ctx());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { block: { name: string }; visitCount: number }[];
    expect(body.map((b) => b.block.name)).toEqual(["123", "125"]);
    expect(body[0]?.visitCount).toBe(0);
  });

  it("is idempotent", async () => {
    asAdmin();
    await attach(attachRequest([BLOCK_A]), ctx());
    const body = (await (await attach(attachRequest([BLOCK_A]), ctx())).json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  it("can add a block to a session that is already running", async () => {
    // The contingency path: members pick it up on their next refresh.
    asAdmin();
    await attach(attachRequest([BLOCK_A]), ctx());
    await startSession(new Request(url(`/${SESSION}/start`), { method: "POST" }), ctx());

    const response = await attach(attachRequest([BLOCK_B]), ctx());
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown[]).toHaveLength(2);
  });

  it("returns 404 for an unknown block, attaching nothing", async () => {
    asAdmin();
    const response = await attach(
      attachRequest([BLOCK_A, "bcbcbcbc-0000-4000-8001-00000000ffff"]),
      ctx(),
    );
    expect(response.status).toBe(404);
    const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM session_blocks`);
    expect(rows[0]?.count).toBe("0");
  });

  it("returns 404 for an unknown session", async () => {
    asAdmin();
    const missing = "bcbcbcbc-0000-4000-8002-00000000ffff";
    expect((await attach(attachRequest([BLOCK_A]), ctx(missing))).status).toBe(404);
  });

  it("refuses a member", async () => {
    asMember();
    expect((await attach(attachRequest([BLOCK_A]), ctx())).status).toBe(403);
  });

  it("rejects an empty list with 400", async () => {
    asAdmin();
    expect((await attach(attachRequest([]), ctx())).status).toBe(400);
  });
});

describe("listing", () => {
  it("is readable by members, who pick a block from it", async () => {
    asAdmin();
    await attach(attachRequest([BLOCK_A]), ctx());
    asMember();
    const response = await listBlocks(new Request(url(`/${SESSION}/blocks`)), ctx());
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown[]).toHaveLength(1);
  });

  it("returns 404 for an unknown session rather than an empty list", async () => {
    asMember();
    const missing = "bcbcbcbc-0000-4000-8002-00000000ffff";
    expect((await listBlocks(new Request(url("/x/blocks")), ctx(missing))).status).toBe(404);
  });
});

describe("detaching", () => {
  it("detaches a block with no visits", async () => {
    asAdmin();
    await attach(attachRequest([BLOCK_A]), ctx());
    const response = await detach(
      new Request(url(`/${SESSION}/blocks/${BLOCK_A}`), { method: "DELETE" }),
      ctx(SESSION, BLOCK_A),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("refuses to detach a block that has visits", async () => {
    /*
     * History is never orphaned by a UI action - detaching would strip a
     * member's recorded work off the session.
     */
    asAdmin();
    await attach(attachRequest([BLOCK_A]), ctx());
    await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#01-01')`, [
      HOUSEHOLD,
      BLOCK_A,
    ]);
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
       VALUES ('01960000-0000-7000-8000-0000000000f1', $1, $2, $3, 'low')`,
      [HOUSEHOLD, SESSION, MEMBER],
    );

    const response = await detach(
      new Request(url(`/${SESSION}/blocks/${BLOCK_A}`), { method: "DELETE" }),
      ctx(SESSION, BLOCK_A),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("block_in_use");
  });

  it("allows detaching a block whose visits belong to another session", async () => {
    // Only this session's work should block it.
    asAdmin();
    await attach(attachRequest([BLOCK_A]), ctx());
    const other = "bcbcbcbc-0000-4000-8002-000000000002";
    await pool.query(
      `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Other','ended',$2)`,
      [other, ADMIN],
    );
    await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#01-01')`, [
      HOUSEHOLD,
      BLOCK_A,
    ]);
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
       VALUES ('01960000-0000-7000-8000-0000000000f2', $1, $2, $3, 'low')`,
      [HOUSEHOLD, other, MEMBER],
    );

    expect(
      (
        await detach(
          new Request(url(`/${SESSION}/blocks/${BLOCK_A}`), { method: "DELETE" }),
          ctx(SESSION, BLOCK_A),
        )
      ).status,
    ).toBe(204);
  });

  it("returns 404 for a block that is not attached", async () => {
    asAdmin();
    expect(
      (
        await detach(
          new Request(url(`/${SESSION}/blocks/${BLOCK_B}`), { method: "DELETE" }),
          ctx(SESSION, BLOCK_B),
        )
      ).status,
    ).toBe(404);
  });

  it("refuses a member", async () => {
    asAdmin();
    await attach(attachRequest([BLOCK_A]), ctx());
    asMember();
    expect(
      (
        await detach(
          new Request(url(`/${SESSION}/blocks/${BLOCK_A}`), { method: "DELETE" }),
          ctx(SESSION, BLOCK_A),
        )
      ).status,
    ).toBe(403);
  });
});
