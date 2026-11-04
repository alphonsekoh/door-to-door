import { drizzle } from "drizzle-orm/node-postgres";
import type { Clock } from "@/lib/clock";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import type { Religion } from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { ClockSkewError, ConflictError, ForbiddenError, NotFoundError } from "@/server/http/errors";
import { getHouseholdHistory, listHouseholds } from "@/server/visits/queries";
import { createVisit, updateVisit, upsertHousehold } from "@/server/visits/service";

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;

const ADMIN = "cdcdcdcd-0000-4000-8000-000000000001";
const ALICE = "cdcdcdcd-0000-4000-8000-000000000002";
const BEN = "cdcdcdcd-0000-4000-8000-000000000003";
const BLOCK = "cdcdcdcd-0000-4000-8001-000000000001";
const OTHER_BLOCK = "cdcdcdcd-0000-4000-8001-000000000002";
const SESSION = "cdcdcdcd-0000-4000-8002-000000000001";

let visitSeq = 0;
const nextVisitId = () => `01960000-0000-7000-8000-${String(++visitSeq).padStart(12, "0")}`;

beforeEach(async () => {
  visitSeq = 0;
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'), ($3,'ben@t.local','Ben','member')`,
    [ADMIN, ALICE, BEN],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave'), ($2,'125','Test Ave')`,
    [BLOCK, OTHER_BLOCK],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Outing','active',$2)`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2), ($1,$3)`, [
    SESSION,
    BLOCK,
    OTHER_BLOCK,
  ]);
});

const CLOCK: Clock = { now: new Date(), toleranceMs: 300_000 };
const MEMBER = { role: "member" } as const;

afterAll(async () => {
  await pool.end();
});

const record = (unit: string, extra: Record<string, unknown> = {}) =>
  createVisit(
    db,
    {
      id: nextVisitId(),
      blockId: BLOCK,
      unitNumber: unit,
      interestLevel: "low",
      memberId: ALICE,
      ...extra,
    },
    CLOCK,
    MEMBER,
  );

describe("households accumulate", () => {
  it("creates the household on first contact", async () => {
    const visit = await record("#05-123", { name: "Mr Tan" });
    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.household.unitNumber).toBe("#05-123");
    expect(history.household.name).toBe("Mr Tan");
  });

  it("reuses the household on a later visit, so history builds up", async () => {
    /*
     * The whole point of the app: knocking on #05-123 in August must find the
     * household created in March, not make a second one.
     */
    const first = await record("#05-123");
    const second = await record("#05-123", { memberId: BEN, interestLevel: "high" });

    expect(second.householdId).toBe(first.householdId);
    const history = await getHouseholdHistory(db, first.householdId);
    expect(history.visits).toHaveLength(2);
    expect(history.visits.map((v) => v.interestLevel)).toEqual(["low", "high"]);
  });

  it("treats the same unit number in another block as a different household", async () => {
    const here = await record("#05-123");
    const there = await createVisit(
      db,
      {
        id: nextVisitId(),
        blockId: OTHER_BLOCK,
        unitNumber: "#05-123",
        interestLevel: "low",
        memberId: ALICE,
      },
      CLOCK,
      MEMBER,
    );
    expect(there.householdId).not.toBe(here.householdId);
  });

  it("trims the unit number, so a stray space is not a new household", async () => {
    const first = await record("#05-123");
    const second = await record("  #05-123  ");
    expect(second.householdId).toBe(first.householdId);
  });
});

describe("identity fields are latest-known", () => {
  it("fills in a field a later visit learns", async () => {
    const first = await record("#05-123");
    await record("#05-123", { name: "Mrs Lee", contact: "+65 9000 0000" });

    const history = await getHouseholdHistory(db, first.householdId);
    expect(history.household).toMatchObject({ name: "Mrs Lee", contact: "+65 9000 0000" });
  });

  it("does not erase a known name when a later visit learns nothing", async () => {
    /*
     * The member who got a name in March must not lose it because nobody
     * answered in June. Both omitted and explicit null leave it alone.
     */
    const first = await record("#05-123", { name: "Mr Tan", religion: "buddhist" });
    await record("#05-123", { name: null, contact: null, religion: null });

    const history = await getHouseholdHistory(db, first.householdId);
    expect(history.household).toMatchObject({ name: "Mr Tan", religion: "buddhist" });
  });

  it("leaves identity untouched when the field is simply omitted", async () => {
    const first = await record("#05-123", { name: "Mr Tan" });
    await record("#05-123");
    const history = await getHouseholdHistory(db, first.householdId);
    expect(history.household.name).toBe("Mr Tan");
  });

  it("records a household nobody answered, with nothing known", async () => {
    const visit = await record("#06-201", { interestLevel: "no_response" });
    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.household).toMatchObject({ name: null, contact: null, religion: null });
  });
});

describe("visits are never overwritten", () => {
  it("keeps each visit's interest level, so the trajectory survives", async () => {
    const first = await record("#05-123", { interestLevel: "low" });
    await record("#05-123", { interestLevel: "medium" });
    await record("#05-123", { interestLevel: "high" });

    const history = await getHouseholdHistory(db, first.householdId);
    expect(history.visits.map((v) => v.interestLevel)).toEqual(["low", "medium", "high"]);
  });

  it("orders history oldest first, so it reads left to right", async () => {
    const first = await record("#05-123", { description: "First" });
    await record("#05-123", { description: "Second" });
    const history = await getHouseholdHistory(db, first.householdId);
    expect(history.visits.map((v) => v.description)).toEqual(["First", "Second"]);
  });
});

describe("recording rules", () => {
  it("refuses an unknown block", async () => {
    await expect(
      createVisit(
        db,
        {
          id: nextVisitId(),
          blockId: "cdcdcdcd-0000-4000-8001-00000000ffff",
          unitNumber: "#01-01",
          interestLevel: "low",
          memberId: ALICE,
        },
        CLOCK,
        MEMBER,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses a duplicate visit id rather than creating a second row", async () => {
    const id = nextVisitId();
    const args = {
      id,
      blockId: BLOCK,
      unitNumber: "#05-123",
      interestLevel: "low" as const,
      memberId: ALICE,
    };
    await createVisit(db, args, CLOCK, MEMBER);
    await expect(createVisit(db, args, CLOCK, MEMBER)).rejects.toThrow(ConflictError);

    const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM visits`);
    expect(rows[0]?.count).toBe("1");
  });

  it("refuses when no session is active", async () => {
    await pool.query(`UPDATE outing_sessions SET status = 'ended' WHERE id = $1`, [SESSION]);
    await expect(record("#05-123")).rejects.toThrow(/No session is active/);
  });

  it("refuses a block that is not part of the active session", async () => {
    await pool.query(`DELETE FROM session_blocks WHERE block_id = $1`, [BLOCK]);
    await expect(record("#05-123")).rejects.toThrow(/not part of the active session/);
  });

  it("defaults description to empty, since a silent door has nothing to say", async () => {
    const visit = await record("#06-201", { interestLevel: "no_response" });
    expect(visit.description).toBe("");
  });

  it("records who knocked", async () => {
    expect((await record("#05-123", { memberId: BEN })).memberId).toBe(BEN);
  });
});

describe("amending a visit", () => {
  const asMember = (id: string) => ({ id, role: "member" as const });
  const asAdmin = { id: ADMIN, role: "admin" as const };

  it("lets a member amend their own record", async () => {
    const visit = await record("#05-123");
    const amended = await updateVisit(db, visit.id, { interestLevel: "high" }, asMember(ALICE));
    expect(amended.interestLevel).toBe("high");
  });

  it("refuses a member amending someone else's record", async () => {
    const visit = await record("#05-123", { memberId: BEN });
    await expect(
      updateVisit(db, visit.id, { interestLevel: "high" }, asMember(ALICE)),
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets an admin amend anyone's record", async () => {
    const visit = await record("#05-123", { memberId: BEN });
    const amended = await updateVisit(db, visit.id, { description: "Corrected" }, asAdmin);
    expect(amended.description).toBe("Corrected");
  });

  it("refuses a member once the session has ended", async () => {
    const visit = await record("#05-123");
    await pool.query(`UPDATE outing_sessions SET status = 'ended' WHERE id = $1`, [SESSION]);
    await expect(
      updateVisit(db, visit.id, { interestLevel: "high" }, asMember(ALICE)),
    ).rejects.toThrow(/Ask an admin to reopen it/);
  });

  it("lets a member amend again once an admin reopens the session", async () => {
    // The reason ending is recoverable: work in progress is not lost.
    const visit = await record("#05-123");
    await pool.query(`UPDATE outing_sessions SET status = 'ended' WHERE id = $1`, [SESSION]);
    await pool.query(`UPDATE outing_sessions SET status = 'active' WHERE id = $1`, [SESSION]);
    await expect(
      updateVisit(db, visit.id, { interestLevel: "high" }, asMember(ALICE)),
    ).resolves.toMatchObject({ interestLevel: "high" });
  });

  it("lets an admin amend a historical record after the session ended", async () => {
    const visit = await record("#05-123");
    await pool.query(`UPDATE outing_sessions SET status = 'ended' WHERE id = $1`, [SESSION]);
    await expect(
      updateVisit(db, visit.id, { description: "Tidied up" }, asAdmin),
    ).resolves.toMatchObject({ description: "Tidied up" });
  });

  it("updates household identity through an amendment", async () => {
    const visit = await record("#05-123");
    await updateVisit(db, visit.id, { name: "Learned later" }, asMember(ALICE));
    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.household.name).toBe("Learned later");
  });

  it("still refuses to erase identity through an amendment", async () => {
    const visit = await record("#05-123", { name: "Mr Tan" });
    await updateVisit(db, visit.id, { name: null, description: "x" }, asMember(ALICE));
    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.household.name).toBe("Mr Tan");
  });

  it("changes neither the visit nor the household when the household write fails", async () => {
    const visit = await record("#05-123", { name: "Mr Tan" });
    // Past the contract, the database's enum is what refuses it, at the second write.
    const religion = "Pastafarian" as string as Religion;
    await expect(
      updateVisit(
        db,
        visit.id,
        { interestLevel: "high", name: "Mr Lim", religion },
        asMember(ALICE),
      ),
    ).rejects.toThrow();

    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.household).toMatchObject({ name: "Mr Tan", religion: null });
    expect(history.visits).toMatchObject([{ id: visit.id, interestLevel: "low" }]);
  });

  it("refuses an unknown visit", async () => {
    await expect(
      updateVisit(db, "01960000-0000-7000-8000-0000000000ff", { description: "x" }, asAdmin),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("listing households in a block", () => {
  it("summarises each unit with its latest visit", async () => {
    await record("#05-123", { interestLevel: "low" });
    await record("#05-123", { interestLevel: "high" });
    await record("#06-201");

    const { rows, total } = await listHouseholds(db, { blockId: BLOCK, limit: 50, offset: 0 });
    expect(total).toBe(2);
    const first = rows.find((r) => r.household.unitNumber === "#05-123");
    expect(first?.visitCount).toBe(2);
    expect(first?.latestVisit?.interestLevel).toBe("high");
  });

  it("orders by unit number", async () => {
    await record("#06-201");
    await record("#05-123");
    const { rows } = await listHouseholds(db, { blockId: BLOCK, limit: 50, offset: 0 });
    expect(rows.map((r) => r.household.unitNumber)).toEqual(["#05-123", "#06-201"]);
  });

  it("scopes to one session when asked", async () => {
    await record("#05-123");
    const other = "cdcdcdcd-0000-4000-8002-000000000002";
    await pool.query(
      `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Old','ended',$2)`,
      [other, ADMIN],
    );
    const { rows } = await listHouseholds(db, {
      blockId: BLOCK,
      sessionId: other,
      limit: 50,
      offset: 0,
    });
    expect(rows).toHaveLength(0);
  });

  it("counts outstanding follow-ups per household", async () => {
    const visit = await record("#05-123");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Come back'), ($1,$2,'And again')`,
      [visit.householdId, ALICE],
    );
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note, done_at) VALUES ($1,$2,'Done',now())`,
      [visit.householdId, ALICE],
    );

    const { rows } = await listHouseholds(db, { blockId: BLOCK, limit: 50, offset: 0 });
    expect(rows[0]?.outstandingFollowUps).toBe(2);
  });

  it("paginates", async () => {
    await record("#05-123");
    await record("#06-201");
    const page = await listHouseholds(db, { blockId: BLOCK, limit: 1, offset: 0 });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it("refuses an unknown block", async () => {
    await expect(
      listHouseholds(db, {
        blockId: "cdcdcdcd-0000-4000-8001-00000000ffff",
        limit: 10,
        offset: 0,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("returns an empty page for a block with nothing recorded", async () => {
    const { rows, total } = await listHouseholds(db, {
      blockId: OTHER_BLOCK,
      limit: 10,
      offset: 0,
    });
    expect({ rows, total }).toEqual({ rows: [], total: 0 });
  });
});

describe("upsertHousehold", () => {
  it("can be called without any identity at all", async () => {
    const household = await upsertHousehold(db, { blockId: BLOCK, unitNumber: "#09-99" });
    expect(household.unitNumber).toBe("#09-99");
  });
});

describe("household history", () => {
  it("refuses an unknown household", async () => {
    await expect(getHouseholdHistory(db, "cdcdcdcd-0000-4000-8003-00000000ffff")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("includes the block, so the screen can title itself", async () => {
    const visit = await record("#05-123");
    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.block.name).toBe("123");
  });

  it("includes follow-ups with their author and resolver", async () => {
    const visit = await record("#05-123");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note, done_at, done_by)
       VALUES ($1,$2,'Sent the flyer',now(),$3)`,
      [visit.householdId, ALICE, BEN],
    );
    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.followUps[0]?.authorName).toBe("Alice");
    expect(history.followUps[0]?.doneByName).toBe("Ben");
  });

  it("names the door on each follow-up", async () => {
    const visit = await record("#05-123");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Todo')`,
      [visit.householdId, ALICE],
    );
    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.followUps[0]).toMatchObject({ blockName: "123", unitNumber: "#05-123" });
  });

  it("leaves doneBy null on an outstanding note", async () => {
    const visit = await record("#05-123");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Todo')`,
      [visit.householdId, ALICE],
    );
    const history = await getHouseholdHistory(db, visit.householdId);
    expect(history.followUps[0]?.doneById).toBeNull();
  });
});

describe("coverage of the remaining paths", () => {
  it("honours a client-supplied capture time", async () => {
    // Recorded in a lift with no signal at 10:22, received much later.
    const captured = "2026-03-14T10:22:00.000Z";
    const visit = await record("#05-123", { clientCreatedAt: captured });
    expect(visit.clientCreatedAt.toISOString()).toBe(captured);
  });

  it("defaults the capture time when the client does not supply one", async () => {
    const visit = await record("#05-123");
    expect(visit.clientCreatedAt).toBeInstanceOf(Date);
  });

  it("lists a household that has no visits at all", async () => {
    // Created by an upsert without a visit; the summary must not blow up.
    await upsertHousehold(db, { blockId: BLOCK, unitNumber: "#10-10" });
    const { rows } = await listHouseholds(db, { blockId: BLOCK, limit: 50, offset: 0 });
    expect(rows[0]).toMatchObject({
      visitCount: 0,
      latestVisit: null,
      outstandingFollowUps: 0,
    });
  });

  it("scopes visit counts to the session when one is given", async () => {
    const first = await record("#05-123");
    const older = "cdcdcdcd-0000-4000-8002-000000000003";
    await pool.query(
      `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Older','ended',$2)`,
      [older, ADMIN],
    );
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
       VALUES ('01960000-0000-7000-8000-0000000000e1', $1, $2, $3, 'high')`,
      [first.householdId, older, ALICE],
    );

    const scoped = await listHouseholds(db, {
      blockId: BLOCK,
      sessionId: SESSION,
      limit: 50,
      offset: 0,
    });
    // Two visits exist for the unit; only this session's counts here.
    expect(scoped.rows[0]?.visitCount).toBe(1);

    const all = await listHouseholds(db, { blockId: BLOCK, limit: 50, offset: 0 });
    expect(all.rows[0]?.visitCount).toBe(2);
  });
});

describe("online clientCreatedAt clock rule", () => {
  const offset = (ms: number) => new Date(CLOCK.now.getTime() + ms).toISOString();

  it("accepts exactly at the tolerance ahead", async () => {
    const visit = await record("#05-123", { clientCreatedAt: offset(300_000) });
    expect(visit.id).toBeTruthy();
  });

  it("rejects just beyond it, storing nothing", async () => {
    await expect(record("#05-123", { clientCreatedAt: offset(300_001) })).rejects.toThrow(
      ClockSkewError,
    );
    const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM visits`);
    expect(rows[0]?.count).toBe("0");
  });

  it("accepts a past value", async () => {
    const visit = await record("#05-123", { clientCreatedAt: offset(-86_400_000) });
    expect(visit.id).toBeTruthy();
  });
});
