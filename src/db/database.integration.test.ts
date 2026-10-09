import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { interestLevelEnum, religionEnum, roleEnum, sessionStatusEnum } from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";

/*
 * Exercises the constraints the application relies on but cannot enforce
 * itself. These were verified by hand while building #7 to #9; running them
 * here means a schema change that breaks one fails the build instead.
 */

const pool: Pool = createTestPool();

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const BLOCK_A = "bbbbbbbb-0000-4000-8000-000000000001";
const BLOCK_B = "bbbbbbbb-0000-4000-8000-000000000002";

async function insertFixtures(): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1, 'admin@test.local', 'Admin', 'admin')`,
    [ADMIN],
  );
  await pool.query(
    `INSERT INTO blocks (id, name, street) VALUES ($1, '123', 'Test Ave'), ($2, '456', 'Other Ave')`,
    [BLOCK_A, BLOCK_B],
  );
}

const insertSession = (title: string, status: string) =>
  pool.query<{ id: string }>(
    `INSERT INTO outing_sessions (title, status, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [title, status, ADMIN],
  );

beforeEach(async () => {
  await truncateAll(pool);
  await insertFixtures();
});

afterAll(async () => {
  await pool.end();
});

describe("migrations", () => {
  it("creates every table the application needs", async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "accounts",
      "auth_sessions",
      "blocks",
      "follow_ups",
      "households",
      "outing_sessions",
      "session_blocks",
      "session_participants",
      "session_team_members",
      "session_teams",
      "users",
      "verification_tokens",
      "visit_teammates",
      "visits",
    ]);
  });
});

describe("enums in the database match the schema", () => {
  /*
   * The migration drift check compares schema.ts to the drizzle snapshot, so
   * it cannot see a hand-edit to an already-committed .sql file. This does:
   * it reads what the migration actually created and compares it to what the
   * application believes exists.
   */
  it.each([
    ["role", roleEnum],
    ["religion", religionEnum],
    ["interest_level", interestLevelEnum],
    ["session_status", sessionStatusEnum],
  ])("%s has exactly the values the schema declares", async (typeName, pgEnum) => {
    const { rows } = await pool.query<{ label: string }>(
      `SELECT e.enumlabel AS label
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = $1
       ORDER BY e.enumsortorder`,
      [typeName],
    );
    expect(rows.map((r) => r.label)).toEqual([...pgEnum.enumValues]);
  });
});

describe("one active session app-wide", () => {
  it("accepts the first active session", async () => {
    await expect(insertSession("First", "active")).resolves.toBeDefined();
  });

  it("rejects a second active session", async () => {
    // The race two concurrent start requests would otherwise win together.
    await insertSession("First", "active");
    await expect(insertSession("Second", "active")).rejects.toThrow(/one_active_session_idx/);
  });

  it("allows any number of drafts alongside an active session", async () => {
    await insertSession("Active", "active");
    await expect(insertSession("Draft A", "draft")).resolves.toBeDefined();
    await expect(insertSession("Draft B", "draft")).resolves.toBeDefined();
  });

  it("allows any number of ended sessions", async () => {
    await insertSession("Ended A", "ended");
    await insertSession("Ended B", "ended");
    await expect(insertSession("Ended C", "ended")).resolves.toBeDefined();
  });

  it("allows starting a new session once the current one ends", async () => {
    const { rows } = await insertSession("First", "active");
    await pool.query(`UPDATE outing_sessions SET status = 'ended' WHERE id = $1`, [rows[0]?.id]);
    await expect(insertSession("Second", "active")).resolves.toBeDefined();
  });

  it("refuses to reopen an ended session while another is active", async () => {
    /*
     * Matters for the reopen endpoint (#17): it has to surface this as a 409
     * rather than let the constraint error escape, because reopen is the
     * recovery path for an accidentally ended session.
     */
    const ended = await insertSession("Ended", "ended");
    await insertSession("Active", "active");
    await expect(
      pool.query(`UPDATE outing_sessions SET status = 'active' WHERE id = $1`, [ended.rows[0]?.id]),
    ).rejects.toThrow(/one_active_session_idx/);
  });
});

describe("household identity", () => {
  const insertHousehold = (blockId: string, unit: string) =>
    pool.query(`INSERT INTO households (block_id, unit_number) VALUES ($1, $2)`, [blockId, unit]);

  it("accepts the same unit number in different blocks", async () => {
    await insertHousehold(BLOCK_A, "#05-123");
    await expect(insertHousehold(BLOCK_B, "#05-123")).resolves.toBeDefined();
  });

  it("rejects the same unit number twice in one block", async () => {
    // This is what makes a unit the same household across sessions.
    await insertHousehold(BLOCK_A, "#05-123");
    await expect(insertHousehold(BLOCK_A, "#05-123")).rejects.toThrow(
      /households_block_unit_unique/,
    );
  });

  it("refuses to delete a block that still has households", async () => {
    await insertHousehold(BLOCK_A, "#05-123");
    await expect(pool.query(`DELETE FROM blocks WHERE id = $1`, [BLOCK_A])).rejects.toThrow(
      /foreign key/i,
    );
  });
});

describe("visit identity", () => {
  const VISIT = "01960000-0000-7000-8000-0000000000ff";

  async function setupVisitContext(): Promise<{ household: string; session: string }> {
    const session = await insertSession("Active", "active");
    const household = await pool.query<{ id: string }>(
      `INSERT INTO households (block_id, unit_number) VALUES ($1, '#05-123') RETURNING id`,
      [BLOCK_A],
    );
    return { household: household.rows[0]?.id ?? "", session: session.rows[0]?.id ?? "" };
  }

  const insertVisit = (ctx: { household: string; session: string }, id: string | null) =>
    id === null
      ? pool.query(
          `INSERT INTO visits (household_id, session_id, member_id, interest_level)
           VALUES ($1, $2, $3, 'low')`,
          [ctx.household, ctx.session, ADMIN],
        )
      : pool.query(
          `INSERT INTO visits (id, household_id, session_id, member_id, interest_level)
           VALUES ($1, $2, $3, $4, 'low')`,
          [id, ctx.household, ctx.session, ADMIN],
        );

  it("requires the client to supply the id", async () => {
    // No database default, so an offline replay cannot create a second row.
    const ctx = await setupVisitContext();
    await expect(insertVisit(ctx, null)).rejects.toThrow(/null value in column "id"/);
  });

  it("accepts a client-generated id", async () => {
    const ctx = await setupVisitContext();
    await expect(insertVisit(ctx, VISIT)).resolves.toBeDefined();
  });

  it("rejects a replayed id, leaving exactly one row", async () => {
    const ctx = await setupVisitContext();
    await insertVisit(ctx, VISIT);
    await expect(insertVisit(ctx, VISIT)).rejects.toThrow(/visits_pkey/);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM visits WHERE household_id = $1`,
      [ctx.household],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("refuses to delete a session that has visits", async () => {
    const ctx = await setupVisitContext();
    await insertVisit(ctx, VISIT);
    await expect(
      pool.query(`DELETE FROM outing_sessions WHERE id = $1`, [ctx.session]),
    ).rejects.toThrow(/foreign key/i);
  });
});
