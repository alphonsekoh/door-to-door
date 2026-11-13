import { describe, expect, it, vi } from "vitest";
import {
  SEED_USAGE,
  SeedRefusedError,
  requireDemoFlag,
  runSeedCli,
  seedTarget,
} from "@/db/seed-guard";

const URL_WITH_CREDENTIALS = "postgresql://app%40corp:s3cr%2Fet@db.internal:6543/door_to_door";

describe("seedTarget", () => {
  it("names the host, port and database, and never the user or password", () => {
    const target = seedTarget(URL_WITH_CREDENTIALS);
    expect(target).toBe("db.internal:6543/door_to_door");
    for (const secret of ["app", "corp", "s3cr", "%40", "%2F"]) {
      expect(target).not.toContain(secret);
    }
  });

  it("fills in Postgres's default port when the URL has none", () => {
    expect(seedTarget("postgresql://postgres:postgres@localhost/door_to_door")).toBe(
      "localhost:5432/door_to_door",
    );
  });

  it("shows a percent-encoded database name as it is named", () => {
    expect(seedTarget("postgresql://localhost:5433/demo%20db")).toBe("localhost:5433/demo db");
  });
});

describe("requireDemoFlag", () => {
  it("passes for exactly --demo", () => {
    expect(() => {
      requireDemoFlag(["--demo"]);
    }).not.toThrow();
  });

  it.each([[[]], [["--demo", "-x"]], [["--dmeo"]], [["-x", "--demo"]], [["--demo=true"]]])(
    "refuses %j with the usage line",
    (argv) => {
      expect(() => {
        requireDemoFlag(argv);
      }).toThrow(SeedRefusedError);
      expect(() => {
        requireDemoFlag(argv);
      }).toThrow(SEED_USAGE);
    },
  );
});

describe("runSeedCli", () => {
  it("prints the target before refusing a run without --demo, and never seeds", async () => {
    const order: string[] = [];
    const log = vi.fn((message: string) => order.push(`log: ${message}`));
    const seed = vi.fn(() => Promise.resolve());

    await expect(
      runSeedCli({ argv: [], databaseUrl: URL_WITH_CREDENTIALS, seed, log }),
    ).rejects.toThrow(SeedRefusedError);

    expect(order).toEqual(["log: Seeding demo data into db.internal:6543/door_to_door"]);
    expect(seed).not.toHaveBeenCalled();
  });

  it("seeds the URL it was given once --demo is there, after printing the target", async () => {
    const order: string[] = [];
    const log = vi.fn((message: string) => order.push(`log: ${message}`));
    const seed = vi.fn((url: string) => {
      order.push(`seed: ${url}`);
      return Promise.resolve();
    });

    await runSeedCli({ argv: ["--demo"], databaseUrl: URL_WITH_CREDENTIALS, seed, log });

    expect(order).toEqual([
      "log: Seeding demo data into db.internal:6543/door_to_door",
      `seed: ${URL_WITH_CREDENTIALS}`,
    ]);
  });

  it("passes the seed's own refusal on", async () => {
    const refused = new SeedRefusedError("Refusing to seed db.internal:6543/door_to_door: ...");
    const seed = vi.fn(() => Promise.reject(refused));

    await expect(
      runSeedCli({ argv: ["--demo"], databaseUrl: URL_WITH_CREDENTIALS, seed, log: vi.fn() }),
    ).rejects.toBe(refused);
  });
});
