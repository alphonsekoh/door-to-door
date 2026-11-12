import {
  CHECKSUM_FILE,
  recordMigrationChecksums,
} from "../src/server/integrity/migration-checksums";

/* Runs after every `npm run db:generate` (the `postdb:generate` script). */
for (const name of recordMigrationChecksums("drizzle")) {
  console.log(`Recorded ${name} in drizzle/${CHECKSUM_FILE}.`);
}
