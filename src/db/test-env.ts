export class MissingTestDatabaseUrlError extends Error {
  constructor() {
    super(
      "TEST_DATABASE_URL is not set. The test harness needs a full connection URL, e.g. " +
        "postgresql://postgres:postgres@localhost:5433/door_to_door_test (see `docker compose up -d db-test`).",
    );
    this.name = "MissingTestDatabaseUrlError";
  }
}

/*
 * The one place a full URL, credentials included, is allowed: it belongs to
 * the throwaway test database and never reaches the app, which reads
 * config.yaml and the credential environment variables instead.
 */
export function requireTestDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env["TEST_DATABASE_URL"]?.trim();
  if (!url) {
    throw new MissingTestDatabaseUrlError();
  }
  return url;
}
