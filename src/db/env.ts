/*
 * Loads .env when present. Node's built-in loader avoids a dotenv dependency;
 * it throws if the file is absent, which is normal in Docker and CI where the
 * environment is supplied directly.
 */
export function loadEnvFile(path = ".env"): boolean {
  try {
    process.loadEnvFile(path);
    return true;
  } catch {
    return false;
  }
}

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super("DATABASE_URL is not set. Copy .env.example to .env, or supply it in the environment.");
    this.name = "MissingDatabaseUrlError";
  }
}

/* Deliberately narrower than NodeJS.ProcessEnv: this reads one variable, and
 * depending on the framework-augmented type makes it awkward to call in tests. */
export type EnvSource = Record<string, string | undefined>;

export function requireDatabaseUrl(env: EnvSource = process.env): string {
  const url = env["DATABASE_URL"]?.trim();
  if (!url) {
    throw new MissingDatabaseUrlError();
  }
  return url;
}
