import { describe, expect, it, vi } from "vitest";
import {
  assertStageDatabase,
  runStageSeedCli,
  STAGE_DATABASE,
  StageSeedRefusedError,
} from "@/db/stage-seed";
import { countStageData, generateStageData } from "@/db/stage-seed-data";

const STAGE_URL = `postgresql://stage:stage@db:5432/${STAGE_DATABASE}`;
const PRODUCTION_URL = "postgresql://owner:secret@ep-example.ap-southeast-1.aws.neon.tech/neondb";

describe("assertStageDatabase", () => {
  it("lets the stage stack's own database through", () => {
    expect(() => {
      assertStageDatabase(STAGE_URL);
    }).not.toThrow();
  });

  it.each([
    PRODUCTION_URL,
    "postgresql://postgres:postgres@localhost:5432/door_to_door",
    "postgresql://postgres:postgres@localhost:5433/door_to_door_stage_copy",
    "postgresql://postgres:postgres@localhost:5433/",
  ])("refuses %s, naming where without the credentials", (url) => {
    expect(() => {
      assertStageDatabase(url);
    }).toThrow(StageSeedRefusedError);
    expect(() => {
      assertStageDatabase(url);
    }).toThrow(
      /^Refusing to seed [^:@]+:\d+\/\S*: the stage seed loads only a database named door_to_door_stage/,
    );
  });

  it("reads the name as the server will, percent-encoding and all", () => {
    expect(() => {
      assertStageDatabase("postgresql://db:5432/door%5Fto%5Fdoor%5Fstage");
    }).not.toThrow();
  });
});

describe("runStageSeedCli", () => {
  it("names the target, seeds it and reports what it loaded", async () => {
    const log = vi.fn<(message: string) => void>();
    const counts = countStageData(
      generateStageData({
        now: new Date("2026-11-21T08:00:00Z"),
        scale: {
          blocks: 1,
          unitsPerBlock: { min: 2, max: 2 },
          admins: 1,
          members: 1,
          deactivatedMembers: 0,
          endedSessions: 1,
          blocksPerSession: 1,
          followUpSessions: 0,
          coverage: 1,
        },
      }),
    );
    const seed = vi.fn((_url: string) => Promise.resolve(counts));

    await runStageSeedCli({ databaseUrl: STAGE_URL, seed, log });

    expect(seed).toHaveBeenCalledWith(STAGE_URL);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      `Stage seed target: db:5432/${STAGE_DATABASE}`,
      `Seeded ${String(counts.users)} users, ${String(counts.blocks)} blocks, ${String(counts.sessions)} sessions, ` +
        `${String(counts.sessionBlocks)} sessionBlocks, ${String(counts.sessionParticipants)} sessionParticipants, ` +
        `${String(counts.sessionTeams)} sessionTeams, ${String(counts.sessionTeamMembers)} sessionTeamMembers, ` +
        `${String(counts.households)} households, ${String(counts.sessionHouseholds)} sessionHouseholds, ` +
        `${String(counts.visits)} visits, ${String(counts.visitTeammates)} visitTeammates, ` +
        `${String(counts.followUps)} followUps`,
    ]);
  });

  it("refuses another database before seeding anything, having said which it was", async () => {
    const log = vi.fn<(message: string) => void>();
    const seed = vi.fn();

    await expect(runStageSeedCli({ databaseUrl: PRODUCTION_URL, seed, log })).rejects.toThrow(
      StageSeedRefusedError,
    );
    expect(seed).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "Stage seed target: ep-example.ap-southeast-1.aws.neon.tech:5432/neondb",
    );
  });
});
