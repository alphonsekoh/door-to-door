import { defineConfig } from "drizzle-kit";
import { ConfigNotFoundError } from "./src/lib/config";
import { loadDatabaseUrl } from "./src/server/config";

/*
 * `generate` needs no database, so a missing config file falls back to a
 * placeholder and lets CI generate with none present. An invalid file still
 * throws: guessing past a typo would point migrate at the wrong place.
 */
function databaseUrl(): string {
  try {
    return loadDatabaseUrl();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      return "postgresql://localhost:5432/placeholder";
    }
    throw error;
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl() },
  strict: true,
  verbose: true,
});
