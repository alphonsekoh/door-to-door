import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedStageDatabase, StageSeedRefusedError } from "@/db/stage-seed";
import {
  countStageData,
  generateStageData,
  type StageData,
  type StageScale,
} from "@/db/stage-seed-data";
import { requireTestDatabaseUrl } from "@/db/test-env";
import { createTestPool, truncateAll } from "@/db/testing";

/*
 * The stage seed against the real schema (#244): the whole year loads with
 * every key, check and foreign key held, and a database with anything in it
 * is refused untouched.
 */

const pool: Pool = createTestPool();
const url = requireTestDatabaseUrl();
const NOW = new Date("2026-11-21T08:00:00Z");
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$stage$not-a-real-hash";
/* For the refusals: the whole year takes seconds to load, and they load none of it. */
const FEW: StageScale = {
  blocks: 4,
  unitsPerBlock: { min: 30, max: 30 },
  admins: 1,
  members: 8,
  deactivatedMembers: 1,
  endedSessions: 6,
  blocksPerSession: 2,
  followUpSessions: 1,
  coverage: 0.75,
};

const TABLES = {
  users: "users",
  blocks: "blocks",
  sessions: "outing_sessions",
  sessionBlocks: "session_blocks",
  sessionParticipants: "session_participants",
  sessionTeams: "session_teams",
  sessionTeamMembers: "session_team_members",
  households: "households",
  sessionHouseholds: "session_households",
  visits: "visits",
  visitTeammates: "visit_teammates",
  followUps: "follow_ups",
} as const satisfies Record<keyof StageData, string>;

async function countRows(): Promise<Record<keyof StageData, number>> {
  const entries = await Promise.all(
    Object.entries(TABLES).map(async ([key, table]) => {
      const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
      return [key, Number(rows[0]?.n)] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<keyof StageData, number>;
}

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe("seedStageDatabase", () => {
  it("loads the stack's whole year into an empty database", async () => {
    const data = generateStageData({ now: NOW });

    const counts = await seedStageDatabase(url, data, HASH);

    expect(counts).toEqual(countStageData(data));
    expect(await countRows()).toEqual(counts);
    const { rows } = await pool.query<{ status: string; password_hash: string }>(
      "SELECT DISTINCT o.status, u.password_hash FROM outing_sessions o JOIN users u ON u.id = o.created_by WHERE o.status = 'active'",
    );
    expect(rows).toEqual([{ status: "active", password_hash: HASH }]);
  }, 60_000);

  it("refuses a database that holds anything, and writes nothing", async () => {
    await pool.query(`INSERT INTO blocks (name, street) VALUES ('1', 'Somewhere Road')`);
    const data = generateStageData({ now: NOW, scale: FEW });

    const seeding = seedStageDatabase(url, data, HASH);

    await expect(seeding).rejects.toThrow(StageSeedRefusedError);
    await expect(seeding).rejects.toThrow(
      /: it already holds blocks\. The stage seed loads only an empty database/,
    );
    expect(await countRows()).toMatchObject({ users: 0, blocks: 1, visits: 0 });
  });

  it("names every kind of record it found", async () => {
    await pool.query(
      `INSERT INTO users (id, email, role) VALUES ('cccccccc-0000-4000-8000-000000000001', 'lead@example.org', 'admin')`,
    );
    await pool.query(`INSERT INTO blocks (name, street) VALUES ('1', 'Somewhere Road')`);

    await expect(
      seedStageDatabase(url, generateStageData({ now: NOW, scale: FEW }), HASH),
    ).rejects.toThrow("it already holds users, blocks.");
  });

  it("leaves the database empty when a row is refused part-way, so the next run is not", async () => {
    const data = generateStageData({ now: NOW, scale: FEW });
    expect(data.followUps.length).toBeGreaterThan(0);
    const broken: StageData = {
      ...data,
      followUps: data.followUps.map((note, at) => (at === 0 ? { ...note, note: "   " } : note)),
    };

    await expect(seedStageDatabase(url, broken, HASH)).rejects.toThrow();

    expect(Object.values(await countRows()).every((count) => count === 0)).toBe(true);
  });
});
