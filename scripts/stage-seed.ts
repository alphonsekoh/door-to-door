import { generateStageData, STAGE_PASSWORD } from "../src/db/stage-seed-data";
import { runStageSeedCli, seedStageDatabase } from "../src/db/stage-seed";
import { loadDatabaseUrl } from "../src/server/config";
import { hashPassword } from "../src/server/password";

/*
 * Loads the stage stack's year of records (#244); run it as
 * `npm run stage:seed`, which runs this in the stack's own container against
 * its own database. The logic and its guards are in src/db/stage-seed.ts.
 */
Promise.resolve()
  .then(() =>
    runStageSeedCli({
      databaseUrl: loadDatabaseUrl(),
      seed: async (url) =>
        seedStageDatabase(
          url,
          generateStageData({ now: new Date() }),
          await hashPassword(STAGE_PASSWORD),
        ),
      log: console.log,
    }),
  )
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
