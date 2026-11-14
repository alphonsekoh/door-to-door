import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachPoolErrorHandler } from "../src/db/pool-errors";
import {
  blocks,
  followUps,
  households,
  outingSessions,
  sessionBlocks,
  users,
  visits,
} from "../src/db/schema";
import { assertOnlySeedUsers, runSeedCli, seedTarget } from "../src/db/seed-guard";
import { loadDatabaseUrl } from "../src/server/config";
import {
  SEED_PASSWORD,
  seedAdmin,
  seedBlocks,
  seedFollowUps,
  seedHouseholds,
  seedSessions,
  seedUsers,
  seedVisits,
} from "../src/db/seed-data";
import { hashPassword } from "../src/server/password";

/* Fixed so re-running never shifts a timestamp and produces different state. */
const SEEDED_AT = new Date("2026-01-01T00:00:00Z");

/* Refers to the row Postgres was about to insert, for ON CONFLICT DO UPDATE. */
const sqlExcluded = (column: string) => sql.raw(`excluded."${column}"`);

/*
 * Exported so the e2e suite can seed a database it names itself, rather than
 * shelling out and losing the stack trace when something goes wrong.
 *
 * Refuses, writing nothing, a database with users other than the seed's own
 * (#124). Every caller goes through here; e2e passes because it truncates first.
 */
export async function seedDatabase(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  attachPoolErrorHandler(pool);
  const db = drizzle(pool);

  try {
    await assertOnlySeedUsers(db, seedTarget(connectionString));
    const passwordHash = await hashPassword(SEED_PASSWORD);

    await db
      .insert(users)
      .values(
        seedUsers.map((user) => ({
          ...user,
          passwordHash,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        })),
      )
      /*
       * passwordHash is deliberately absent from the update set. argon2 salts
       * every call, so rewriting it would make each run produce different
       * state and break the "re-running changes nothing" guarantee.
       */
      .onConflictDoUpdate({
        target: users.id,
        set: { email: sqlExcluded("email"), name: sqlExcluded("name"), role: sqlExcluded("role") },
      });

    await db
      .insert(blocks)
      .values(seedBlocks.map((block) => ({ ...block, createdAt: SEEDED_AT })))
      .onConflictDoUpdate({
        target: blocks.id,
        set: { name: sqlExcluded("name"), street: sqlExcluded("street") },
      });

    await db
      .insert(outingSessions)
      .values(
        seedSessions.map((session) => ({
          id: session.id,
          title: session.title,
          status: session.status,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          createdBy: seedAdmin.id,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        })),
      )
      .onConflictDoUpdate({
        target: outingSessions.id,
        set: { title: sqlExcluded("title"), status: sqlExcluded("status") },
      });

    await db
      .insert(sessionBlocks)
      .values(
        seedSessions.flatMap((session) =>
          session.blockIds.map((blockId) => ({
            sessionId: session.id,
            blockId,
            addedAt: SEEDED_AT,
          })),
        ),
      )
      .onConflictDoNothing();

    await db
      .insert(households)
      .values(
        seedHouseholds.map((household) => ({
          ...household,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        })),
      )
      .onConflictDoUpdate({
        target: households.id,
        set: {
          name: sqlExcluded("name"),
          contact: sqlExcluded("contact"),
          religion: sqlExcluded("religion"),
        },
      });

    await db
      .insert(visits)
      .values(
        seedVisits.map((visit) => ({
          id: visit.id,
          householdId: visit.householdId,
          sessionId: visit.sessionId,
          memberId: visit.memberId,
          interestLevel: visit.interestLevel,
          description: visit.description,
          clientCreatedAt: visit.recordedAt,
          createdAt: visit.recordedAt,
          updatedAt: visit.recordedAt,
        })),
      )
      .onConflictDoUpdate({
        target: visits.id,
        set: {
          interestLevel: sqlExcluded("interest_level"),
          description: sqlExcluded("description"),
        },
      });

    await db
      .insert(followUps)
      .values(
        seedFollowUps.map((followUp) => ({
          ...followUp,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        })),
      )
      .onConflictDoUpdate({
        target: followUps.id,
        set: { note: sqlExcluded("note"), doneAt: sqlExcluded("done_at") },
      });

    console.log(
      `seeded ${String(seedUsers.length)} users, ${String(seedBlocks.length)} blocks, ` +
        `${String(seedSessions.length)} sessions, ${String(seedHouseholds.length)} households, ` +
        `${String(seedVisits.length)} visits, ${String(seedFollowUps.length)} follow-ups`,
    );
  } finally {
    await pool.end();
  }
}

/* Only when run as a script: importing this module must not touch a database. */
if (process.argv[1]?.endsWith("seed.ts") === true) {
  Promise.resolve()
    .then(() =>
      runSeedCli({
        argv: process.argv.slice(2),
        databaseUrl: loadDatabaseUrl(),
        seed: seedDatabase,
        log: console.log,
      }),
    )
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
