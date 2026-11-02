import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestPool, truncateAll } from "@/db/testing";
import { firstOrThrow } from "@/server/db-utils";
import {
  CLEAN_MESSAGE,
  findBlankText,
  formatBlankReport,
  runBlankTextCheck,
} from "@/server/integrity/blank-text";

const pool = createTestPool();
const db = drizzle(pool, { schema }) as unknown as Database;

const NOT_BLANK = [
  ["households", "households_unit_number_not_blank"],
  ["follow_ups", "follow_ups_note_not_blank"],
  ["blocks", "blocks_name_not_blank"],
  ["blocks", "blocks_street_not_blank"],
] as const;

/* The migration exactly as it ships, so the test proves what an operator runs. */
const MIGRATION = readFileSync(join(process.cwd(), "drizzle/0005_not_blank_text.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement !== "");

const ALICE = "b1a4c4ec-0000-4000-8000-000000000001";
const ADMIN = "b1a4c4ec-0000-4000-8000-000000000002";
const GOOD_BLOCK = "b1a4c4ec-0000-4000-8001-000000000001";
const SPACED_BLOCK = "b1a4c4ec-0000-4000-8001-000000000002";
const NAMELESS = "b1a4c4ec-0000-4000-8001-000000000003";
const STREETLESS = "b1a4c4ec-0000-4000-8001-000000000004";
const SESSION = "b1a4c4ec-0000-4000-8002-000000000001";
const GOOD_UNIT = "b1a4c4ec-0000-4000-8003-000000000001";
const EMPTY_UNIT = "b1a4c4ec-0000-4000-8003-000000000002";
const SPACE_UNIT = "b1a4c4ec-0000-4000-8003-000000000003";
const SPACED_UNIT = "b1a4c4ec-0000-4000-8003-000000000004";
const EMPTY_NOTE = "b1a4c4ec-0000-4000-8004-000000000001";
const REMOVED_NOTE = "b1a4c4ec-0000-4000-8004-000000000002";
const GOOD_NOTE = "b1a4c4ec-0000-4000-8004-000000000003";
const FIRST_KNOCK = "01960000-0000-7000-8000-00000000c4e1";
const LATER_KNOCK = "01960000-0000-7000-8000-00000000c4e2";
const GOOD_KNOCK = "01960000-0000-7000-8000-00000000c4e3";

const MARCH = new Date("2026-03-14T10:00:00.000Z");
const APRIL = new Date("2026-04-02T09:30:00.000Z");

/* Thrown to roll the whole test back once it has looked. */
class RolledBack extends Error {}

/* Runs `look` in a transaction that is always rolled back; its failures still fail the test. */
async function rolledBack(look: (tx: Database) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await look(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

/*
 * What a deployed database from before #119 may hold. The constraints are
 * dropped inside the test's own transaction, which is rolled back, so no
 * other test ever sees them gone (integration files run one at a time).
 */
async function seedBlankRows(tx: Database): Promise<void> {
  for (const [table, constraint] of NOT_BLANK) {
    await tx.execute(sql.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`));
  }
  await tx.execute(sql`
    INSERT INTO users (id, email, name, role) VALUES
      (${ALICE}, 'alice@t.local', 'Alice', 'member'), (${ADMIN}, 'admin@t.local', 'Admin', 'admin')`);
  await tx.execute(sql`
    INSERT INTO blocks (id, name, street) VALUES
      (${GOOD_BLOCK}, '123', 'Test Ave'), (${SPACED_BLOCK}, ' A ', 'Other Ave'),
      (${NAMELESS}, '', 'Nameless Rd'), (${STREETLESS}, '456', '   ')`);
  await tx.execute(sql`
    INSERT INTO outing_sessions (id, title, status, started_at, created_by)
    VALUES (${SESSION}, 'March', 'ended', ${MARCH}, ${ADMIN})`);
  await tx.execute(sql`
    INSERT INTO households (id, block_id, unit_number) VALUES
      (${GOOD_UNIT}, ${GOOD_BLOCK}, 'A'), (${EMPTY_UNIT}, ${GOOD_BLOCK}, ''),
      (${SPACE_UNIT}, ${SPACED_BLOCK}, '   '), (${SPACED_UNIT}, ${SPACED_BLOCK}, ' A ')`);
  await tx.execute(sql`
    INSERT INTO visits (id, household_id, session_id, member_id, interest_level, client_created_at)
    VALUES
      (${LATER_KNOCK}, ${EMPTY_UNIT}, ${SESSION}, ${ADMIN}, 'low', ${APRIL}),
      (${FIRST_KNOCK}, ${EMPTY_UNIT}, ${SESSION}, ${ALICE}, 'high', ${MARCH}),
      (${GOOD_KNOCK}, ${GOOD_UNIT}, ${SESSION}, ${ALICE}, 'medium', ${MARCH})`);
  await tx.execute(sql`
    INSERT INTO follow_ups (id, household_id, author_id, note, status, deleted_at, deleted_by)
    VALUES
      (${EMPTY_NOTE}, ${GOOD_UNIT}, ${ALICE}, '', 'listed', null, null),
      (${REMOVED_NOTE}, ${EMPTY_UNIT}, ${ADMIN}, '  ', 'suggested', ${APRIL}, ${ADMIN}),
      (${GOOD_NOTE}, ${SPACED_UNIT}, ${ALICE}, ' A ', 'listed', null, null)`);
}

/* Every row of every table the check reads, to show it changed none. */
async function everything(tx: Database): Promise<string> {
  const tables = ["users", "blocks", "outing_sessions", "households", "visits", "follow_ups"];
  const rows: unknown[] = [];
  for (const table of tables) {
    rows.push((await tx.execute(sql.raw(`SELECT * FROM ${table} ORDER BY id`))).rows);
  }
  return JSON.stringify(rows);
}

/*
 * Each statement of the shipped migration, in a savepoint of its own so one
 * failing does not hide the next: the SQLSTATE each failed with, or "ok".
 */
async function migrate(tx: Database): Promise<string[]> {
  const outcomes: string[] = [];
  for (const statement of MIGRATION) {
    try {
      await tx.transaction((savepoint) => savepoint.execute(sql.raw(statement)));
      outcomes.push("ok");
    } catch (error) {
      outcomes.push(String((error as { cause?: { code?: string } }).cause?.code));
    }
  }
  return outcomes;
}

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("findBlankText on a database from before the constraints", () => {
  it("lists exactly the blank rows, with what it takes to find each", async () => {
    await rolledBack(async (tx) => {
      await seedBlankRows(tx);
      const before = await everything(tx);
      // Every row was created in this transaction, so at its start; read
      // through a timestamp column's mapping, as the rows' own times are.
      const { now } = firstOrThrow(
        await tx
          .select({ now: sql`now()`.mapWith(schema.households.createdAt) })
          .from(schema.users)
          .limit(1),
        "the transaction's start",
      );

      expect(await findBlankText(tx)).toEqual({
        households: [
          {
            id: EMPTY_UNIT,
            blockId: GOOD_BLOCK,
            blockName: "123",
            street: "Test Ave",
            unitNumber: "",
            createdAt: now,
            visitCount: 2,
            // The earliest knock at the door, not the first row stored.
            firstVisit: { id: FIRST_KNOCK, memberEmail: "alice@t.local", at: MARCH },
          },
          {
            id: SPACE_UNIT,
            blockId: SPACED_BLOCK,
            blockName: " A ",
            street: "Other Ave",
            unitNumber: "   ",
            createdAt: now,
            visitCount: 0,
            firstVisit: null,
          },
        ],
        followUps: [
          {
            id: EMPTY_NOTE,
            householdId: GOOD_UNIT,
            blockName: "123",
            street: "Test Ave",
            unitNumber: "A",
            note: "",
            status: "listed",
            authorEmail: "alice@t.local",
            createdAt: now,
            removed: false,
          },
          {
            id: REMOVED_NOTE,
            householdId: EMPTY_UNIT,
            blockName: "123",
            street: "Test Ave",
            unitNumber: "",
            note: "  ",
            status: "suggested",
            authorEmail: "admin@t.local",
            createdAt: now,
            removed: true,
          },
        ],
        blocks: [
          { id: NAMELESS, name: "", street: "Nameless Rd", createdAt: now },
          { id: STREETLESS, name: "456", street: "   ", createdAt: now },
        ],
      });

      // Nested, so its transaction is a savepoint inside this one.
      const report = await runBlankTextCheck(tx);
      expect(report.exitCode).toBe(1);
      const printed = report.lines.join("\n");
      for (const id of [EMPTY_UNIT, SPACE_UNIT, EMPTY_NOTE, REMOVED_NOTE, NAMELESS, STREETLESS]) {
        expect(printed).toContain(id);
      }
      // Each row printed leads with its own id; none of the good ones does.
      for (const id of [GOOD_UNIT, SPACED_UNIT, GOOD_NOTE, GOOD_BLOCK, SPACED_BLOCK]) {
        expect(report.lines.filter((line) => line.split(":")[0]?.endsWith(id))).toEqual([]);
      }
      expect(await everything(tx)).toBe(before);
    });
  });

  it("agrees with the migration: it fails on what is listed, and applies once that is gone", async () => {
    await rolledBack(async (tx) => {
      await seedBlankRows(tx);

      // Every constraint, not just the first, is refused by a row listed.
      expect(await migrate(tx)).toEqual(["23514", "23514", "23514", "23514"]);

      // Whatever an operator decides to do with them; here, removed.
      const found = await findBlankText(tx);
      const ids = (rows: { id: string }[]) =>
        sql.join(
          rows.map((row) => sql`${row.id}::uuid`),
          sql`, `,
        );
      await tx.execute(sql`DELETE FROM follow_ups WHERE id IN (${ids(found.followUps)})`);
      await tx.execute(sql`DELETE FROM households WHERE id IN (${ids(found.households)})`);
      await tx.execute(sql`DELETE FROM blocks WHERE id IN (${ids(found.blocks)})`);

      expect(await migrate(tx)).toEqual(["ok", "ok", "ok", "ok"]);
      expect(formatBlankReport(await findBlankText(tx))).toEqual({
        lines: [CLEAN_MESSAGE],
        exitCode: 0,
      });
      // The rows that only look blank are still there, untouched.
      const kept = await tx.execute<{ unit_number: string }>(
        sql`SELECT unit_number FROM households ORDER BY unit_number`,
      );
      expect(kept.rows.map((row) => row.unit_number)).toEqual([" A ", "A"]);
    });

    // Rolled back with everything else: the constraints are all still there.
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname LIKE '%_not_blank' ORDER BY conname`,
    );
    expect(rows.map((row) => row.conname)).toEqual(
      NOT_BLANK.map(([, constraint]) => constraint).sort(),
    );
  });
});

describe("runBlankTextCheck", () => {
  it("passes a migrated database, and only ever reads, inside a read-only transaction", async () => {
    await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1, '123', 'Test Ave')`, [
      GOOD_BLOCK,
    ]);
    await pool.query(`INSERT INTO households (block_id, unit_number) VALUES ($1, '#05-123')`, [
      GOOD_BLOCK,
    ]);
    const sent: string[] = [];
    const watched = drizzle(pool, {
      schema,
      logger: {
        logQuery: (query) => {
          sent.push(query.trim().toLowerCase());
        },
      },
    }) as unknown as Database;

    expect(await runBlankTextCheck(watched)).toEqual({ lines: [CLEAN_MESSAGE], exitCode: 0 });
    expect(sent[0]).toBe("begin read only");
    expect(sent.at(-1)).toBe("commit");
    expect(sent.slice(1, -1).every((query) => query.startsWith("select"))).toBe(true);
  });
});
