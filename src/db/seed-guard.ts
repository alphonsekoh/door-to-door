import { notInArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users } from "@/db/schema";
import { seedUsers } from "@/db/seed-data";

/*
 * Keeps the demo seed off a real database (#124). The seed writes logins with
 * a published password at fixed ids, so it asks for the flag on every run,
 * and refuses any database that already has people of its own in it.
 */

export const SEED_USAGE = "Usage: npm run db:seed -- --demo";

export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefusedError";
  }
}

/* host:port/database, so an operator sees where it goes; never the credentials. */
export function seedTarget(connectionString: string): string {
  const url = new URL(connectionString);
  const port = url.port === "" ? "5432" : url.port;
  return `${url.hostname}:${port}/${decodeURIComponent(url.pathname.slice(1))}`;
}

/*
 * Exactly one argument, so a typo never seeds by falling through: on a new
 * production database with no users yet, this flag is the only guard.
 */
export function requireDemoFlag(argv: readonly string[]): void {
  if (argv.length !== 1 || argv[0] !== "--demo") {
    throw new SeedRefusedError(
      "Refusing to seed without --demo. The seed adds demo logins whose password is public, " +
        `so it is for a development database only.\n${SEED_USAGE}`,
    );
  }
}

/* The seed's own users are fine: re-running the seed is meant to change nothing. */
export async function assertOnlySeedUsers<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  target: string,
): Promise<void> {
  const others = await db
    .select({ id: users.id })
    .from(users)
    .where(
      notInArray(
        users.id,
        seedUsers.map((user) => user.id),
      ),
    )
    .limit(1);
  if (others.length > 0) {
    throw new SeedRefusedError(
      `Refusing to seed ${target}: it has users that are not demo users, so it is not a demo database.`,
    );
  }
}

export type SeedCli = {
  argv: readonly string[];
  databaseUrl: string;
  seed: (databaseUrl: string) => Promise<void>;
  log: (message: string) => void;
};

/* The target first, so even a refusal says which database it was about. */
export async function runSeedCli({ argv, databaseUrl, seed, log }: SeedCli): Promise<void> {
  log(`Seeding demo data into ${seedTarget(databaseUrl)}`);
  requireDemoFlag(argv);
  await seed(databaseUrl);
}
