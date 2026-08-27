import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { ConflictError, NotFoundError } from "@/server/http/errors";
import {
  attachBlocks,
  createSession,
  findActiveSession,
  getSession,
  listSessionBlocks,
  listSessions,
  transitionSession,
} from "@/server/sessions/service";

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "dddddddd-0000-4000-8000-000000000001";
const MEMBER = "dddddddd-0000-4000-8000-000000000002";
const BLOCK_A = "dddddddd-0000-4000-8001-000000000001";
const BLOCK_B = "dddddddd-0000-4000-8001-000000000002";

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
       ($1, 'admin@t.local', 'Admin', 'admin'),
       ($2, 'member@t.local', 'Member', 'member')`,
    [ADMIN, MEMBER],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1, '123', 'Test Ave'), ($2, '125', 'Test Ave')`,
    [BLOCK_A, BLOCK_B],
  );
});

afterAll(async () => {
  await pool.end();
});

const draft = (title = "Outing") => createSession(db, { title, createdBy: ADMIN });

describe("createSession", () => {
  it("creates a draft, not an active session", async () => {
    // Starting is a separate step, so an admin can prepare an outing quietly.
    expect((await draft()).status).toBe("draft");
  });

  it("attaches blocks supplied up front", async () => {
    const session = await createSession(db, {
      title: "Outing",
      blockIds: [BLOCK_A, BLOCK_B],
      createdBy: ADMIN,
    });
    expect(await listSessionBlocks(db, session.id)).toHaveLength(2);
  });

  it("records who created it", async () => {
    expect((await draft()).createdById).toBe(ADMIN);
  });

  it("rejects the whole request if any block is unknown", async () => {
    await expect(
      createSession(db, {
        title: "Outing",
        blockIds: [BLOCK_A, "dddddddd-0000-4000-8001-00000000ffff"],
        createdBy: ADMIN,
      }),
    ).rejects.toThrow(NotFoundError);

    // All or nothing: the valid block must not have been attached either.
    const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM session_blocks`);
    expect(rows[0]?.count).toBe("0");
  });
});

describe("transitions", () => {
  it("starts a draft", async () => {
    const started = await transitionSession(db, (await draft()).id, "start");
    expect(started.status).toBe("active");
    expect(started.startedAt).toBeInstanceOf(Date);
  });

  it("ends an active session", async () => {
    const session = await draft();
    await transitionSession(db, session.id, "start");
    const ended = await transitionSession(db, session.id, "end");
    expect(ended.status).toBe("ended");
    expect(ended.endedAt).toBeInstanceOf(Date);
  });

  it("reopens an ended session and clears its end time", async () => {
    /*
     * The recovery path for a session ended by mistake. A member locked out
     * mid-amendment loses work, so this has to restore full write access.
     */
    const session = await draft();
    await transitionSession(db, session.id, "start");
    await transitionSession(db, session.id, "end");
    const reopened = await transitionSession(db, session.id, "reopen");

    expect(reopened.status).toBe("active");
    expect(reopened.endedAt).toBeNull();
    expect(await findActiveSession(db)).toMatchObject({ id: session.id });
  });

  it("keeps the original start time when reopening", async () => {
    const session = await draft();
    const started = await transitionSession(db, session.id, "start");
    await transitionSession(db, session.id, "end");
    const reopened = await transitionSession(db, session.id, "reopen");
    expect(reopened.startedAt?.toISOString()).toBe(started.startedAt?.toISOString());
  });

  it.each([
    ["starting an active session", "start"],
    ["starting an ended session", "start"],
    ["ending a draft", "end"],
    ["reopening a draft", "reopen"],
    ["reopening an active session", "reopen"],
  ] as const)("refuses %s", async (label, transition) => {
    const session = await draft();
    if (label.includes("active")) {
      await transitionSession(db, session.id, "start");
    }
    if (label.includes("ended")) {
      await transitionSession(db, session.id, "start");
      await transitionSession(db, session.id, "end");
    }
    await expect(transitionSession(db, session.id, transition)).rejects.toThrow(ConflictError);
  });

  it("refuses a transition on a session that does not exist", async () => {
    await expect(
      transitionSession(db, "dddddddd-0000-4000-8002-00000000ffff", "start"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("one active session app-wide", () => {
  it("refuses to start a second", async () => {
    await transitionSession(db, (await draft("First")).id, "start");
    await expect(transitionSession(db, (await draft("Second")).id, "start")).rejects.toThrow(
      /Another session is already active/,
    );
  });

  it("reports the clash with a distinct code, not a generic conflict", async () => {
    // A client should be able to say "end the other one first".
    await transitionSession(db, (await draft("First")).id, "start");
    const second = await draft("Second");
    try {
      await transitionSession(db, second.id, "start");
      expect.unreachable();
    } catch (error) {
      expect((error as ConflictError).code).toBe("session_already_active");
    }
  });

  it("refuses to reopen while another is active", async () => {
    const first = await draft("First");
    await transitionSession(db, first.id, "start");
    await transitionSession(db, first.id, "end");
    await transitionSession(db, (await draft("Second")).id, "start");

    await expect(transitionSession(db, first.id, "reopen")).rejects.toThrow(
      /Another session is already active/,
    );
  });

  it("leaves exactly one active session under concurrent starts", async () => {
    /*
     * The acceptance criterion, and the reason the constraint lives in the
     * database: no amount of application-level checking closes this race.
     */
    const sessions = await Promise.all([draft("A"), draft("B"), draft("C"), draft("D")]);
    const results = await Promise.allSettled(
      sessions.map((session) => transitionSession(db, session.id, "start")),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM outing_sessions WHERE status = 'active'`,
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("allows starting another once the first ends", async () => {
    const first = await draft("First");
    await transitionSession(db, first.id, "start");
    await transitionSession(db, first.id, "end");
    await expect(transitionSession(db, (await draft("Second")).id, "start")).resolves.toMatchObject(
      { status: "active" },
    );
  });
});

describe("listSessions", () => {
  it("returns newest first with a total", async () => {
    await draft("First");
    await draft("Second");
    const { rows, total } = await listSessions(db, { limit: 10, offset: 0 });
    expect(total).toBe(2);
    expect(rows[0]?.title).toBe("Second");
  });

  it("paginates", async () => {
    await draft("First");
    await draft("Second");
    const page = await listSessions(db, { limit: 1, offset: 1 });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it("filters by status", async () => {
    await transitionSession(db, (await draft("Active")).id, "start");
    await draft("Draft");
    const { rows, total } = await listSessions(db, { limit: 10, offset: 0, status: "draft" });
    expect(total).toBe(1);
    expect(rows[0]?.title).toBe("Draft");
  });

  it("returns nothing when there are no sessions", async () => {
    expect(await listSessions(db, { limit: 10, offset: 0 })).toEqual({ rows: [], total: 0 });
  });
});

describe("getSession", () => {
  it("throws for an unknown id", async () => {
    await expect(getSession(db, "dddddddd-0000-4000-8002-00000000ffff")).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("findActiveSession", () => {
  it("returns undefined when none is active", async () => {
    await draft();
    expect(await findActiveSession(db)).toBeUndefined();
  });
});

describe("attachBlocks", () => {
  it("is idempotent", async () => {
    const session = await draft();
    await attachBlocks(db, session.id, [BLOCK_A]);
    await attachBlocks(db, session.id, [BLOCK_A]);
    expect(await listSessionBlocks(db, session.id)).toHaveLength(1);
  });

  it("de-duplicates within one request", async () => {
    const session = await draft();
    await attachBlocks(db, session.id, [BLOCK_A, BLOCK_A]);
    expect(await listSessionBlocks(db, session.id)).toHaveLength(1);
  });

  it("can add a block to a running session", async () => {
    // Contingency: an admin adds a block mid-outing without ending it.
    const session = await draft();
    await attachBlocks(db, session.id, [BLOCK_A]);
    await transitionSession(db, session.id, "start");
    await attachBlocks(db, session.id, [BLOCK_B]);
    expect(await listSessionBlocks(db, session.id)).toHaveLength(2);
  });
});

describe("block progress", () => {
  /*
   * Visits reach a block through households, so this exercises the join that
   * makes the counts right - and the member list the block picker shows.
   */
  const HOUSEHOLD_A = "dddddddd-0000-4000-8003-000000000001";
  const HOUSEHOLD_B = "dddddddd-0000-4000-8003-000000000002";

  async function recordVisit(
    sessionId: string,
    householdId: string,
    visitId: string,
    memberId = MEMBER,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
       VALUES ($1, $2, $3, $4, 'low')`,
      [visitId, householdId, sessionId, memberId],
    );
  }

  beforeEach(async () => {
    await pool.query(
      `INSERT INTO households (id, block_id, unit_number) VALUES ($1, $2, '#01-01'), ($3, $2, '#01-02')`,
      [HOUSEHOLD_A, BLOCK_A, HOUSEHOLD_B],
    );
  });

  it("reports zero for a block nobody has worked", async () => {
    const session = await draft();
    await attachBlocks(db, session.id, [BLOCK_A]);
    const [block] = await listSessionBlocks(db, session.id);
    expect(block).toMatchObject({ visitCount: 0, householdCount: 0, activeMembers: [] });
  });

  it("counts visits and distinct households", async () => {
    const session = await draft();
    await attachBlocks(db, session.id, [BLOCK_A]);
    await recordVisit(session.id, HOUSEHOLD_A, "01960000-0000-7000-8000-00000000a001");
    await recordVisit(session.id, HOUSEHOLD_A, "01960000-0000-7000-8000-00000000a002");
    await recordVisit(session.id, HOUSEHOLD_B, "01960000-0000-7000-8000-00000000a003");

    const [block] = await listSessionBlocks(db, session.id);
    // Three knocks across two units.
    expect(block).toMatchObject({ visitCount: 3, householdCount: 2 });
  });

  it("lists who has recorded on the block", async () => {
    const session = await draft();
    await attachBlocks(db, session.id, [BLOCK_A]);
    await recordVisit(session.id, HOUSEHOLD_A, "01960000-0000-7000-8000-00000000b001", MEMBER);
    await recordVisit(session.id, HOUSEHOLD_B, "01960000-0000-7000-8000-00000000b002", ADMIN);

    const [block] = await listSessionBlocks(db, session.id);
    expect(block?.activeMembers).toHaveLength(2);
    expect(block?.activeMembers.map((m) => m.name).sort()).toEqual(["Admin", "Member"]);
  });

  it("lists a member once however many units they record", async () => {
    const session = await draft();
    await attachBlocks(db, session.id, [BLOCK_A]);
    await recordVisit(session.id, HOUSEHOLD_A, "01960000-0000-7000-8000-00000000c001");
    await recordVisit(session.id, HOUSEHOLD_B, "01960000-0000-7000-8000-00000000c002");

    const [block] = await listSessionBlocks(db, session.id);
    expect(block?.activeMembers).toHaveLength(1);
  });

  it("does not count another session's visits", async () => {
    // Blocks are reused across outings; each session shows only its own work.
    const first = await draft("First");
    await attachBlocks(db, first.id, [BLOCK_A]);
    await recordVisit(first.id, HOUSEHOLD_A, "01960000-0000-7000-8000-00000000d001");

    const second = await draft("Second");
    await attachBlocks(db, second.id, [BLOCK_A]);

    const [block] = await listSessionBlocks(db, second.id);
    expect(block).toMatchObject({ visitCount: 0, activeMembers: [] });
  });

  it("does not attribute a visit to a block it did not happen on", async () => {
    const session = await draft();
    await attachBlocks(db, session.id, [BLOCK_A, BLOCK_B]);
    await recordVisit(session.id, HOUSEHOLD_A, "01960000-0000-7000-8000-00000000e001");

    const rows = await listSessionBlocks(db, session.id);
    expect(rows.find((r) => r.blockId === BLOCK_A)?.visitCount).toBe(1);
    expect(rows.find((r) => r.blockId === BLOCK_B)?.visitCount).toBe(0);
  });
});
