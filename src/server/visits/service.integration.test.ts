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
const FIRST_PAGE = { limit: 100, offset: 0 };

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
    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
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
    const history = await getHouseholdHistory(db, first.householdId, FIRST_PAGE);
    expect(history.visits).toHaveLength(2);
    expect(history.visits.map((v) => v.interestLevel)).toEqual(["high", "low"]);
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

    const history = await getHouseholdHistory(db, first.householdId, FIRST_PAGE);
    expect(history.household).toMatchObject({ name: "Mrs Lee", contact: "+65 9000 0000" });
  });

  it("does not erase a known name when a later visit learns nothing", async () => {
    /*
     * The member who got a name in March must not lose it because nobody
     * answered in June. Both omitted and explicit null leave it alone.
     */
    const first = await record("#05-123", { name: "Mr Tan", religion: "buddhist" });
    await record("#05-123", { name: null, contact: null, religion: null });

    const history = await getHouseholdHistory(db, first.householdId, FIRST_PAGE);
    expect(history.household).toMatchObject({ name: "Mr Tan", religion: "buddhist" });
  });

  it("leaves identity untouched when the field is simply omitted", async () => {
    const first = await record("#05-123", { name: "Mr Tan" });
    await record("#05-123");
    const history = await getHouseholdHistory(db, first.householdId, FIRST_PAGE);
    expect(history.household.name).toBe("Mr Tan");
  });

  it("records a household nobody answered, with nothing known", async () => {
    const visit = await record("#06-201", { interestLevel: "no_response" });
    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
    expect(history.household).toMatchObject({ name: null, contact: null, religion: null });
  });
});

describe("visits are never overwritten", () => {
  it("keeps each visit's interest level, so the trajectory survives", async () => {
    const first = await record("#05-123", { interestLevel: "low" });
    await record("#05-123", { interestLevel: "medium" });
    await record("#05-123", { interestLevel: "high" });

    const history = await getHouseholdHistory(db, first.householdId, FIRST_PAGE);
    expect(history.visits.map((v) => v.interestLevel)).toEqual(["high", "medium", "low"]);
  });

  it("orders history newest first, so the first page is the latest knocks (#160)", async () => {
    const first = await record("#05-123", { description: "First" });
    await record("#05-123", { description: "Second" });
    const history = await getHouseholdHistory(db, first.householdId, FIRST_PAGE);
    expect(history.visits.map((v) => v.description)).toEqual(["Second", "First"]);
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
    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
    expect(history.household.name).toBe("Learned later");
  });

  it("still refuses to erase identity through an amendment", async () => {
    const visit = await record("#05-123", { name: "Mr Tan" });
    await updateVisit(db, visit.id, { name: null, description: "x" }, asMember(ALICE));
    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
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

    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
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
    await expect(
      getHouseholdHistory(db, "cdcdcdcd-0000-4000-8003-00000000ffff", FIRST_PAGE),
    ).rejects.toThrow(NotFoundError);
  });

  it("includes the block, so the screen can title itself", async () => {
    const visit = await record("#05-123");
    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
    expect(history.block.name).toBe("123");
  });

  it("includes follow-ups with their author and resolver", async () => {
    const visit = await record("#05-123");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note, done_at, done_by)
       VALUES ($1,$2,'Sent the flyer',now(),$3)`,
      [visit.householdId, ALICE, BEN],
    );
    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
    expect(history.followUps[0]?.authorName).toBe("Alice");
    expect(history.followUps[0]?.doneByName).toBe("Ben");
  });

  it("names the door on each follow-up", async () => {
    const visit = await record("#05-123");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Todo')`,
      [visit.householdId, ALICE],
    );
    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
    expect(history.followUps[0]).toMatchObject({ blockName: "123", unitNumber: "#05-123" });
  });

  it("leaves doneBy null on an outstanding note", async () => {
    const visit = await record("#05-123");
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Todo')`,
      [visit.householdId, ALICE],
    );
    const history = await getHouseholdHistory(db, visit.householdId, FIRST_PAGE);
    expect(history.followUps[0]?.doneById).toBeNull();
  });
});

describe("a page of the history (#160)", () => {
  const HOUSEHOLD = "cdcdcdcd-0000-4000-8004-000000000001";
  const TEAM = "cdcdcdcd-0000-4000-8005-000000000001";
  const NOON = "2026-03-14T12:00:00.000Z";
  const id = (n: number) => `01960000-0000-7000-8001-${String(n).padStart(12, "0")}`;

  beforeEach(async () => {
    await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#07-07')`, [
      HOUSEHOLD,
      BLOCK,
    ]);
  });

  async function visitAt(
    n: number,
    at: string,
    options: { level?: string; team?: string } = {},
  ): Promise<void> {
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, team_id, interest_level, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id(n), HOUSEHOLD, SESSION, ALICE, options.team ?? null, options.level ?? "low", at],
    );
  }

  const page = (limit: number, offset: number) =>
    getHouseholdHistory(db, HOUSEHOLD, { limit, offset });

  it("answers one bounded page of a unit with thousands of visits, newest first", async () => {
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, created_at)
       SELECT gen_random_uuid(), $1, $2, $3, 'low', $4::timestamptz - make_interval(secs => i)
       FROM generate_series(1, 3000) AS i`,
      [HOUSEHOLD, SESSION, ALICE, NOON],
    );

    const first = await page(100, 0);
    expect(first.visits).toHaveLength(100);
    expect(first.total).toBe(3000);
    expect(first.visits[0]?.createdAt.toISOString()).toBe("2026-03-14T11:59:59.000Z");
    const times = first.visits.map((visit) => visit.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const last = await page(100, 2900);
    expect(last.visits).toHaveLength(100);
    expect(last.visits.at(-1)?.createdAt.toISOString()).toBe("2026-03-14T11:10:00.000Z");
  });

  it("neither repeats nor skips a visit at a page boundary inside a run stored at one instant", async () => {
    // Three runs, each stored at one instant and out of id order, so only the
    // id can order a tie; the newest run has the middle ids.
    const at = (n: number) =>
      n <= 2 ? "2026-03-14T10:00:00.000Z" : n <= 7 ? NOON : "2026-03-14T11:00:00.000Z";
    for (const n of [5, 9, 2, 7, 3, 10, 1, 6, 8, 4]) await visitAt(n, at(n));

    const read: string[] = [];
    for (let offset = 0; offset < 10; offset += 3) {
      read.push(...(await page(3, offset)).visits.map((visit) => visit.id));
    }
    // Pages of three break inside the noon run (5 | 4) and the eleven o'clock one (10 | 9).
    expect(read).toEqual([7, 6, 5, 4, 3, 10, 9, 8, 2, 1].map(id));
    expect(new Set(read).size).toBe(10);
  });

  it("answers no visits past the last, with the unit and its notes as on any page", async () => {
    await visitAt(1, NOON, { level: "medium" });
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note) VALUES ($1,$2,'Come back')`,
      [HOUSEHOLD, ALICE],
    );

    const past = await page(20, 20);
    expect(past.visits).toEqual([]);
    expect(past).toMatchObject({
      total: 1,
      answered: true,
      household: { id: HOUSEHOLD, unitNumber: "#07-07" },
      block: { id: BLOCK, name: "123" },
      followUps: [{ note: "Come back" }],
    });
  });

  it("keeps the same notes on every page", async () => {
    for (const n of [1, 2, 3]) await visitAt(n, `2026-03-1${String(n)}T12:00:00.000Z`);
    // Stored newest first, so only ordering by when each was written lists them oldest first.
    await pool.query(
      `INSERT INTO follow_ups (household_id, author_id, note, done_at, done_by, created_at) VALUES
        ($1,$2,'Come back',null,null,'2026-03-13T13:00:00Z'),
        ($1,$2,'Sent the flyer',now(),$3,'2026-03-11T13:00:00Z')`,
      [HOUSEHOLD, ALICE, BEN],
    );

    const [first, second] = [await page(2, 0), await page(2, 2)];
    expect(first.visits.map((visit) => visit.id)).toEqual([id(3), id(2)]);
    expect(second.visits.map((visit) => visit.id)).toEqual([id(1)]);
    expect(first.followUps.map((note) => note.note)).toEqual(["Sent the flyer", "Come back"]);
    expect(second.followUps).toEqual(first.followUps);
  });

  it("orders notes written at one instant by id, the same on every page (#207)", async () => {
    const note = (n: number) => `cdcdcdcd-0000-4000-8006-${String(n).padStart(12, "0")}`;
    for (const n of [1, 2]) await visitAt(n, `2026-03-1${String(n)}T12:00:00.000Z`);
    // Stored neither in id order nor its reverse: a tie comes back in the
    // order stored, or reversed under another plan (seen after an ANALYZE of
    // follow_ups), so only the id lists them 1, 2, 3.
    await pool.query(
      `INSERT INTO follow_ups (id, household_id, author_id, note, created_at) VALUES
        ($1,$4,$5,'Two',$6), ($2,$4,$5,'Three',$6), ($3,$4,$5,'One',$6)`,
      [note(2), note(3), note(1), HOUSEHOLD, ALICE, NOON],
    );

    const [first, second] = [await page(1, 0), await page(1, 1)];
    expect(first.followUps.map((followUp) => followUp.id)).toEqual([note(1), note(2), note(3)]);
    expect(second.followUps).toEqual(first.followUps);
  });

  it("says nobody has answered a unit with no visits", async () => {
    expect(await page(20, 0)).toMatchObject({ visits: [], total: 0, answered: false });
  });

  it("says nobody has answered when every visit had no response", async () => {
    await visitAt(1, NOON, { level: "no_response" });
    await visitAt(2, "2026-03-15T12:00:00.000Z", { level: "no_response" });
    expect(await page(20, 0)).toMatchObject({ total: 2, answered: false });
  });

  it("says the door answered when only a visit off the page did", async () => {
    await visitAt(1, "2026-03-01T12:00:00.000Z", { level: "high" });
    await visitAt(2, "2026-03-02T12:00:00.000Z", { level: "no_response" });
    await visitAt(3, "2026-03-03T12:00:00.000Z", { level: "no_response" });

    const newest = await page(2, 0);
    expect(newest.visits.map((visit) => visit.interestLevel)).toEqual([
      "no_response",
      "no_response",
    ]);
    expect(newest.answered).toBe(true);
  });

  it("attaches the team of each visit on a later page", async () => {
    await pool.query(
      `INSERT INTO session_teams (id, session_id, name, created_by) VALUES ($1,$2,'Ann & Ben',$3)`,
      [TEAM, SESSION, ADMIN],
    );
    await visitAt(1, "2026-03-01T12:00:00.000Z", { team: TEAM });
    await visitAt(2, "2026-03-02T12:00:00.000Z");
    await pool.query(`INSERT INTO visit_teammates (visit_id, user_id) VALUES ($1,$2)`, [
      id(1),
      BEN,
    ]);

    const older = await page(1, 1);
    expect(older.visits).toMatchObject([
      { id: id(1), team: { id: TEAM, name: "Ann & Ben", members: [{ id: BEN, name: "Ben" }] } },
    ]);
    expect((await page(1, 0)).visits).toMatchObject([{ id: id(2), team: null }]);
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
