import { defineConfig } from "drizzle-kit";
import { loadEnvFile } from "./src/db/env";

loadEnvFile();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Only read for migrate/push/studio; generate works offline.
    url: process.env["DATABASE_URL"] ?? "postgresql://localhost:5432/placeholder",
  },
  strict: true,
  verbose: true,
});
