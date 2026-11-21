import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { attachPoolErrorHandler } from "@/db/pool-errors";
import {
  blocks,
  followUps,
  households,
  outingSessions,
  sessionBlocks,
  sessionHouseholds,
  sessionParticipants,
  sessionTeamMembers,
  sessionTeams,
  users,
  visitTeammates,
  visits,
} from "@/db/schema";
import { seedTarget } from "@/db/seed-guard";
import { countStageData, type StageCounts, type StageData } from "@/db/stage-seed-data";

/*
 * Loads the stage stack's year of records (#244). Its logins have a published
 * password, so it must never reach production. Two guards, both before any
 * write: the database must be the stage stack's own by name, and it must hold
 * nothing at all, so even a stage database someone has started using is left
 * alone. The whole load is one transaction: a failure leaves it empty, and the
 * next run is not refused.
 */

export const STAGE_DATABASE = "door_to_door_stage";

export class StageSeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageSeedRefusedError";
  }
}

/* By name: production's database is never called this, and the stage stack's always is. */
export function assertStageDatabase(connectionString: string): void {
  const name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (name !== STAGE_DATABASE) {
    throw new StageSeedRefusedError(
      `Refusing to seed ${seedTarget(connectionString)}: the stage seed loads only a database named ` +
        `${STAGE_DATABASE}, the stage stack's own (npm run stage:seed).`,
    );
  }
}

/* Every table a person's work lands in; any row at all means someone is using it. */
const RECORD_TABLES: readonly (readonly [string, PgTable])[] = [
  ["users", users],
  ["blocks", blocks],
  ["outing_sessions", outingSessions],
  ["households", households],
  ["visits", visits],
  ["follow_ups", followUps],
];

export async function assertEmpty<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  target: string,
): Promise<void> {
  const used: string[] = [];
  for (const [name, table] of RECORD_TABLES) {
    const rows = await db
      .select({ one: sql`1` })
      .from(table)
      .limit(1);
    if (rows.length > 0) used.push(name);
  }
  if (used.length > 0) {
    throw new StageSeedRefusedError(
      `Refusing to seed ${target}: it already holds ${used.join(", ")}. ` +
        "The stage seed loads only an empty database; npm run stage:down removes the stack's.",
    );
  }
}

/* Under Postgres's 65,535 parameters for the widest table, follow_ups' 17 columns. */
const CHUNK = 1000;

async function insertInChunks<T>(
  rows: readonly T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let at = 0; at < rows.length; at += CHUNK) {
    await insert(rows.slice(at, at + CHUNK));
  }
}

export async function seedStageDatabase(
  connectionString: string,
  data: StageData,
  passwordHash: string,
): Promise<StageCounts> {
  const pool = new Pool({ connectionString, max: 1 });
  attachPoolErrorHandler(pool);
  const db = drizzle(pool);
  try {
    await db.transaction(async (tx) => {
      await assertEmpty(tx, seedTarget(connectionString));
      const stamped = data.users.map((user) => ({
        ...user,
        passwordHash,
        updatedAt: user.createdAt,
      }));
      await insertInChunks(stamped, (chunk) => tx.insert(users).values(chunk));
      await insertInChunks(data.blocks, (chunk) => tx.insert(blocks).values(chunk));
      await insertInChunks(data.sessions, (chunk) => tx.insert(outingSessions).values(chunk));
      await insertInChunks(data.sessionBlocks, (chunk) => tx.insert(sessionBlocks).values(chunk));
      await insertInChunks(data.sessionParticipants, (chunk) =>
        tx.insert(sessionParticipants).values(chunk),
      );
      await insertInChunks(data.sessionTeams, (chunk) => tx.insert(sessionTeams).values(chunk));
      await insertInChunks(data.sessionTeamMembers, (chunk) =>
        tx.insert(sessionTeamMembers).values(chunk),
      );
      await insertInChunks(data.households, (chunk) => tx.insert(households).values(chunk));
      await insertInChunks(data.sessionHouseholds, (chunk) =>
        tx.insert(sessionHouseholds).values(chunk),
      );
      await insertInChunks(data.visits, (chunk) => tx.insert(visits).values(chunk));
      await insertInChunks(data.visitTeammates, (chunk) => tx.insert(visitTeammates).values(chunk));
      await insertInChunks(data.followUps, (chunk) => tx.insert(followUps).values(chunk));
    });
    /* As production's would be after a while: planner statistics up to date. */
    await pool.query("ANALYZE");
    return countStageData(data);
  } finally {
    await pool.end();
  }
}

export type StageSeedCli = {
  databaseUrl: string;
  seed: (databaseUrl: string) => Promise<StageCounts>;
  log: (message: string) => void;
};

/* The target first, so even a refusal says which database it was about. */
export async function runStageSeedCli({ databaseUrl, seed, log }: StageSeedCli): Promise<void> {
  log(`Stage seed target: ${seedTarget(databaseUrl)}`);
  assertStageDatabase(databaseUrl);
  const counts = await seed(databaseUrl);
  log(
    `Seeded ${Object.entries(counts)
      .map(([table, count]) => `${String(count)} ${table}`)
      .join(", ")}`,
  );
}
