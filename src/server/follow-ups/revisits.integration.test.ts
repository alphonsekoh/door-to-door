import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import {
  isNoteOnActiveRevisitList,
  isUnitOnRevisitList,
  type RevisitSession,
} from "@/server/follow-ups/list-rule";
import { listRevisits } from "@/server/follow-ups/revisits";
import { createVisit } from "@/server/visits/service";

/*
 * The follow-up list rule, case by case, and proof that the list a member is
 * shown and the units they may record at are the same set.
 */

const pool = createTestPool();
let queryCount = 0;
const db = drizzle(pool, {
  schema,
  logger: { logQuery: () => void (queryCount += 1) },
}) as unknown as Database;

const ADMIN = "f0f0f0f0-0000-4000-8000-000000000001";
const ALICE = "f0f0f0f0-0000-4000-8000-000000000002";
const BLOCK_A = "f0f0f0f0-0000-4000-8001-000000000001";
const BLOCK_B = "f0f0f0f0-0000-4000-8001-000000000002";
const UNATTACHED = "f0f0f0f0-0000-4000-8001-000000000003";
const PAST = "f0f0f0f0-0000-4000-8002-000000000001";
const FOLLOW_UP = "f0f0f0f0-0000-4000-8002-000000000002";

/* Named for what each household is meant to prove. */
const OWED = "f0f0f0f0-0000-4000-8003-000000000001";
const SUGGESTED = "f0f0f0f0-0000-4000-8003-000000000002";
const REMOVED = "f0f0f0f0-0000-4000-8003-000000000003";
const DONE_BEFORE = "f0f0f0f0-0000-4000-8003-000000000004";
const DONE_TONIGHT = "f0f0f0f0-0000-4000-8003-000000000005";
const OTHER_BLOCK = "f0f0f0f0-0000-4000-8003-000000000006";
const NOT_ATTACHED = "f0f0f0f0-0000-4000-8003-000000000007";

const STARTED = new Date(Date.now() - 60 * 60 * 1000);
const session: RevisitSession = { id: FOLLOW_UP, kind: "follow_up", startedAt: STARTED };

let visitSeq = 0;
const nextVisitId = () =>
  `01960000-0000-7000-8000-${(0xf000 + (visitSeq += 1)).toString(16).padStart(12, "0")}`;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'admin@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member')`,
    [ADMIN, ALICE],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES
      ($1,'123','Test Ave'), ($2,'125','Test Ave'), ($3,'130','Test Ave')`,
    [BLOCK_A, BLOCK_B, UNATTACHED],
  );
  await pool.query(
    `INSERT INTO outing_sessions (id, title, kind, status, started_at, ended_at, created_by) VALUES
      ($1,'March','regular','ended', now() - interval '30 days', now() - interval '29 days', $3),
      ($2,'Follow-up','follow_up','active', $4, null, $3)`,
    [PAST, FOLLOW_UP, ADMIN, STARTED],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2), ($1,$3)`, [
    FOLLOW_UP,
    BLOCK_A,
    BLOCK_B,
  ]);
  await pool.query(
    `INSERT INTO households (id, block_id, unit_number) VALUES
      ($1,$8,'#01-01'), ($2,$8,'#02-02'), ($3,$8,'#03-03'), ($4,$8,'#04-04'),
      ($5,$8,'#05-05'), ($6,$9,'#01-01'), ($7,$10,'#01-01')`,
    [
      OWED,
      SUGGESTED,
      REMOVED,
      DONE_BEFORE,
      DONE_TONIGHT,
      OTHER_BLOCK,
      NOT_ATTACHED,
      BLOCK_A,
      BLOCK_B,
      UNATTACHED,
    ],
  );
  await pool.query(
    `INSERT INTO follow_ups (household_id, author_id, status, note, due_date, done_at, deleted_at, created_at) VALUES
      ($1,$8,'listed','Undated', null, null, null, now() - interval '3 days'),
      ($1,$8,'listed','Due soon', now() + interval '1 day', null, null, now() - interval '2 days'),
      ($1,$8,'listed','Done tonight too', null, now() - interval '10 minutes', null, now() - interval '1 day'),
      ($2,$9,'suggested','Only suggested', null, null, null, now()),
      ($3,$8,'listed','Taken off the list', null, null, now(), now()),
      ($4,$8,'listed','Resolved last week', null, now() - interval '7 days', null, now()),
      ($5,$8,'listed','Resolved tonight', null, now() - interval '5 minutes', null, now()),
      ($6,$8,'listed','Other block', null, null, null, now()),
      ($7,$8,'listed','Not attached', null, null, null, now())`,
    [OWED, SUGGESTED, REMOVED, DONE_BEFORE, DONE_TONIGHT, OTHER_BLOCK, NOT_ATTACHED, ADMIN, ALICE],
  );
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, interest_level, created_at) VALUES
      ($1,$3,$5,$6,'high', now() - interval '30 days'),
      ($2,$3,$7,$6,'medium', now() - interval '20 minutes'),
      ($4,$8,$5,$6,'low', now() - interval '30 days')`,
    [nextVisitId(), nextVisitId(), OWED, nextVisitId(), PAST, ALICE, FOLLOW_UP, OTHER_BLOCK],
  );
  queryCount = 0;
});

afterAll(async () => {
  await pool.end();
});

const unitsOf = async (on: RevisitSession = session) =>
  (await listRevisits(db, on)).map((entry) => `${entry.block.name} ${entry.household.unitNumber}`);

describe("the follow-up list", () => {
  it("holds listed notes still owed or resolved tonight, in the session's blocks", async () => {
    expect(await unitsOf()).toEqual(["123 #01-01", "123 #05-05", "125 #01-01"]);
  });

  it("orders a household's notes outstanding first, by due day, undated last", async () => {
    const [owed] = await listRevisits(db, session);
    expect(owed?.notes.map((note) => note.note)).toEqual([
      "Due soon",
      "Undated",
      "Done tonight too",
    ]);
  });

  it("carries the latest visit anywhere and whether it was visited tonight", async () => {
    const entries = await listRevisits(db, session);
    const byUnit = new Map(entries.map((e) => [`${e.block.name} ${e.household.unitNumber}`, e]));
    expect(byUnit.get("123 #01-01")).toMatchObject({
      visitedInSession: true,
      latestVisit: { interestLevel: "medium", sessionId: FOLLOW_UP },
    });
    expect(byUnit.get("125 #01-01")).toMatchObject({
      visitedInSession: false,
      latestVisit: { interestLevel: "low", sessionId: PAST },
    });
    expect(byUnit.get("123 #05-05")).toMatchObject({ visitedInSession: false, latestVisit: null });
  });

  it("counts only what is still owed for a draft, which has not started", async () => {
    expect(await unitsOf({ ...session, startedAt: null })).toEqual(["123 #01-01", "125 #01-01"]);
  });

  it("is empty when nothing is listed in the session's blocks", async () => {
    await pool.query(`DELETE FROM session_blocks WHERE session_id = $1`, [FOLLOW_UP]);
    expect(await listRevisits(db, session)).toEqual([]);
  });

  it("costs a fixed number of queries however many households it holds", async () => {
    const count = async () => {
      queryCount = 0;
      await listRevisits(db, session);
      return queryCount;
    };
    const few = await count();
    for (let i = 10; i < 30; i += 1) {
      await pool.query(
        `WITH h AS (INSERT INTO households (block_id, unit_number) VALUES ($1, $2) RETURNING id)
         INSERT INTO follow_ups (household_id, author_id, note) SELECT id, $3, 'More' FROM h`,
        [BLOCK_A, `#${String(i)}-01`, ADMIN],
      );
    }
    expect(await count()).toBe(few);
  });
});

describe("the list and the recording check agree", () => {
  const cases: [string, string, string, boolean][] = [
    ["a listed note still owed", BLOCK_A, "#01-01", true],
    ["a note resolved tonight", BLOCK_A, "#05-05", true],
    ["another attached block", BLOCK_B, "#01-01", true],
    ["only a suggestion", BLOCK_A, "#02-02", false],
    ["a removed note", BLOCK_A, "#03-03", false],
    ["a note resolved before the session started", BLOCK_A, "#04-04", false],
    ["a block not attached", UNATTACHED, "#01-01", false],
    ["a unit nobody has visited", BLOCK_A, "#09-09", false],
  ];

  it.each(cases)("%s", async (_case, blockId, unit, onList) => {
    const listed = (await listRevisits(db, session)).some(
      (entry) => entry.block.id === blockId && entry.household.unitNumber === unit,
    );
    expect(listed).toBe(onList);
    expect(await isUnitOnRevisitList(db, session, blockId, unit)).toBe(onList);

    const recorded = createVisit(
      db,
      { id: nextVisitId(), blockId, unitNumber: unit, interestLevel: "low", memberId: ALICE },
      { now: new Date(), toleranceMs: 300_000 },
      { role: "member" },
    );
    if (onList) {
      await expect(recorded).resolves.toMatchObject({ memberId: ALICE });
    } else {
      // An unattached block is refused for that first, before the list.
      await expect(recorded).rejects.toMatchObject({
        code: blockId === UNATTACHED ? "conflict" : "not_on_follow_up_list",
      });
    }
  });

  it("matches the unit number as recording stores it, trimmed", async () => {
    expect(await isUnitOnRevisitList(db, session, BLOCK_A, "  #01-01 ")).toBe(true);
  });
});

describe("whether a note is on the running session's list", () => {
  const noteOf = async (note: string) =>
    (await pool.query<{ id: string }>(`SELECT id FROM follow_ups WHERE note = $1`, [note])).rows[0]
      ?.id ?? "";

  it("is true for a note on the follow-up session's list", async () => {
    expect(await isNoteOnActiveRevisitList(db, await noteOf("Due soon"))).toBe(true);
  });

  it("is false for a note off the list", async () => {
    expect(await isNoteOnActiveRevisitList(db, await noteOf("Resolved last week"))).toBe(false);
  });

  it("is false when the running session is a regular one", async () => {
    await pool.query(`UPDATE outing_sessions SET kind = 'regular' WHERE id = $1`, [FOLLOW_UP]);
    expect(await isNoteOnActiveRevisitList(db, await noteOf("Due soon"))).toBe(false);
  });
});
