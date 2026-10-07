import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  ConfigNotFoundError,
  ConfigUnreadableError,
  composeDatabaseUrl,
  parseConfig,
  resolveAuthSecrets,
  resolveDatabaseCredentials,
  type AppConfig,
  type EnvSource,
  type ReadTextFile,
  type RuntimeConfig,
} from "@/lib/config";

/*
 * Reads config.yaml at runtime. Nothing here may run at module scope: `next
 * build` needs neither the file nor a database (D-13-4), so every caller
 * reaches for the config inside a function.
 *
 * The turbopackIgnore comments stop the bundler tracing a dynamic path and
 * pulling the whole project - config.yaml included - into the standalone
 * output, where it would be frozen at build time.
 */

export const DEFAULT_CONFIG_FILE = "config.yaml";

export type LoadOptions = {
  env?: EnvSource;
  cwd?: string;
  readFile?: ReadTextFile;
};

const readUtf8: ReadTextFile = (path) => readFileSync(/* turbopackIgnore: true */ path, "utf8");

export function resolveConfigPath(env: EnvSource, cwd: string): string {
  const configured = env["CONFIG_PATH"];
  if (configured === undefined || configured === "") {
    return join(cwd, DEFAULT_CONFIG_FILE);
  }
  /* Not path.resolve(): the bundler reads it as "anything under the working
     directory" and traces the whole tree into the standalone output. */
  return isAbsolute(configured) ? configured : join(cwd, configured);
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "unknown error";
}

export function loadAppConfig({
  env = process.env,
  cwd = process.cwd(),
  readFile = readUtf8,
}: LoadOptions = {}): AppConfig {
  const path = resolveConfigPath(env, cwd);
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    const code = errorCode(error);
    throw code === "ENOENT" ? new ConfigNotFoundError(path) : new ConfigUnreadableError(path, code);
  }
  return parseConfig(text, path);
}

/* What migrate, seed and drizzle-kit need: no auth secret required. */
export function loadDatabaseUrl(options: LoadOptions = {}): string {
  const { env = process.env, readFile = readUtf8 } = options;
  const config = loadAppConfig(options);
  return composeDatabaseUrl(config.database.url, resolveDatabaseCredentials(env, readFile));
}

export function loadConfig(options: LoadOptions = {}): RuntimeConfig {
  const { env = process.env, readFile = readUtf8 } = options;
  const config = loadAppConfig(options);
  return {
    ...config,
    ...resolveAuthSecrets(config, env, readFile),
    databaseUrl: composeDatabaseUrl(config.database.url, resolveDatabaseCredentials(env, readFile)),
  };
}

export type DotEnvCheck = {
  cwd?: string;
  exists?: (path: string) => boolean;
  warn?: (message: string) => void;
};

/*
 * Next still loads .env into process.env on its own, so a stale one can look
 * as though it works. Settings come from the config file; saying so out loud
 * is kinder than a silent change of behaviour for anyone upgrading.
 */
export function warnIfDotEnv({
  cwd = process.cwd(),
  exists = (path) => existsSync(/* turbopackIgnore: true */ path),
  warn = (message) => {
    console.warn(message);
  },
}: DotEnvCheck = {}): boolean {
  const found = exists(join(cwd, ".env"));
  if (found) {
    warn(
      `Found a .env file in ${cwd}. It is not used for app settings: move them to ` +
        `${DEFAULT_CONFIG_FILE} (see config.example.yaml); secrets stay in the environment.`,
    );
  }
  return found;
}

/*
 * Next bundles instrumentation, the proxy and route handlers as separate
 * module graphs, each with its own copy of this file, so a module-level flag
 * would warn once per graph. The process-wide symbol warns once.
 */
const WARNED = Symbol.for("door-to-door.dotenv-warned");
const processWide = globalThis as Record<symbol, unknown>;

let cached: RuntimeConfig | undefined;

export function getConfig(): RuntimeConfig {
  if (cached === undefined) {
    if (processWide[WARNED] !== true) {
      processWide[WARNED] = true;
      warnIfDotEnv();
    }
    cached = loadConfig();
  }
  return cached;
}

/*
 * Next logs a failing instrumentation hook and carries on serving, so the
 * process is ended here: a misconfigured server answering every request with
 * a 500 is worse than one that refuses to start.
 */
export function verifyConfigOrExit(
  exit: (code: number) => never = (code) => process.exit(code),
  report: (message: string) => void = (message) => {
    console.error(message);
  },
  load: () => unknown = getConfig,
): void {
  try {
    load();
  } catch (error) {
    report(`Cannot start: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  }
}

/* Tests reset the cache so each can supply its own file. */
export function resetConfig(): void {
  cached = undefined;
  processWide[WARNED] = undefined;
}
