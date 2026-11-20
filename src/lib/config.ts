import { parseDocument } from "yaml";
import { z } from "zod";

/*
 * Application settings, read from a YAML file at runtime and never bundled.
 *
 * Secrets are deliberately NOT part of the file. It is meant to be readable,
 * diffable and committed to a deploy repository; credentials arrive through
 * environment variables (each with a _FILE variant for Docker and Kubernetes
 * secrets), and this module refuses a file that tries to carry one.
 *
 * Every message here names a file and a key, never a value: the file is where
 * a mistake is most likely to be a pasted secret.
 */

export const CONFIG_HINT =
  "Copy config.example.yaml to config.yaml, or set CONFIG_PATH (or CONFIG_YAML to the settings themselves).";

const DEFAULT_SIGN_IN_ATTEMPTS = 10;
const DEFAULT_SIGN_IN_ATTEMPTS_PER_CLIENT = 30;
const DEFAULT_SIGN_IN_WINDOW_SECONDS = 300;
const DEFAULT_CLOCK_SKEW_SECONDS = 300;

const positiveInteger = z.number().int().positive();

const ALLOWED_QUERY_PARAMETERS: ReadonlySet<string> = new Set(["sslmode", "application_name"]);

const databaseUrl = z.string().superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "must be a valid URL" });
    return;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    ctx.addIssue({ code: "custom", message: "must start with postgresql://" });
    return;
  }
  /*
   * A query-string user/password would both put a secret in the file and, in
   * pg-connection-string, override the injected credentials. Allow-listed
   * rather than deny-listed: the next secret-bearing parameter (sslkey,
   * sslpassword, options...) is then refused by default.
   */
  for (const key of new Set(url.searchParams.keys())) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `query parameter "${key}" is not allowed; only ${[...ALLOWED_QUERY_PARAMETERS].join(", ")} may be set here`,
      });
    }
  }
  if (url.username !== "" || url.password !== "") {
    ctx.addIssue({
      code: "custom",
      message:
        "must not contain a username or password; supply DATABASE_USER and DATABASE_PASSWORD " +
        "(or their _FILE variants) through the environment",
    });
  }
});

const httpUrl = z.string().refine(
  (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  },
  { message: "must be an http or https URL" },
);

/* Lower-case labels of letters, digits and inner hyphens, at least two of them. */
const DOMAIN_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const domainName = z.string().regex(DOMAIN_NAME, {
  message: "must be a lower-case domain name, such as gmail.com, with no @",
});

/*
 * Strict throughout: a typo'd key silently falling back to its default is how
 * a rate limit ends up not being the one the operator thought they set.
 */
export const appConfigSchema = z.strictObject({
  database: z.strictObject({ url: databaseUrl }),
  auth: z
    .strictObject({
      trustHost: z.boolean().default(true),
      /*
       * Otherwise Auth.js takes the cookie flags from the scheme it sees, and
       * behind a TLS proxy that sends no X-Forwarded-Proto that is http.
       */
      secureCookies: z.boolean().default(true),
      google: z
        .strictObject({
          clientId: z.string().min(1),
          /*
           * Google's own unless set. Only for a stand-in OpenID provider, as
           * the end-to-end tests run (#14): production never sets it.
           */
          issuer: httpUrl.optional(),
          /*
           * Where Google may sign anyone in; why, in googleVouchesFor
           * (src/auth/google.ts). Required, so leaving it out cannot mean
           * "anywhere".
           */
          domains: z
            .array(domainName, {
              error: (issue) =>
                issue.input === undefined
                  ? "is required once auth.google is set: list the domains Google sign-in is for"
                  : "must be a list of domain names",
            })
            .min(1, { message: "must list at least one domain" }),
        })
        .optional(),
    })
    .prefault({}),
  rateLimit: z
    .strictObject({
      signInAttempts: positiveInteger.default(DEFAULT_SIGN_IN_ATTEMPTS),
      signInAttemptsPerClient: positiveInteger.default(DEFAULT_SIGN_IN_ATTEMPTS_PER_CLIENT),
      /* Unset means no app-wide budget: it is an incident switch, not a standing limit. */
      signInAttemptsGlobal: positiveInteger.optional(),
      signInWindowSeconds: positiveInteger.default(DEFAULT_SIGN_IN_WINDOW_SECONDS),
      /* 0, the default, means no proxy vouches for X-Forwarded-For, so there is no per-client budget. */
      trustedProxyHops: z.number().int().nonnegative().default(0),
    })
    .prefault({}),
  sync: z
    .strictObject({
      clockSkewToleranceSeconds: positiveInteger.default(DEFAULT_CLOCK_SKEW_SECONDS),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export class ConfigNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`Configuration file not found at ${path}. ${CONFIG_HINT}`);
    this.name = "ConfigNotFoundError";
  }
}

export class ConfigUnreadableError extends Error {
  constructor(
    readonly path: string,
    code: string,
  ) {
    super(`Configuration file ${path} could not be read (${code}). Check its permissions.`);
    this.name = "ConfigUnreadableError";
  }
}

export class ConfigSourceError extends Error {
  constructor() {
    super("Set either CONFIG_YAML or CONFIG_PATH, not both.");
    this.name = "ConfigSourceError";
  }
}

export class ConfigInvalidError extends Error {
  constructor(
    readonly path: string,
    readonly problems: readonly string[],
  ) {
    super(
      `Invalid configuration in ${path}:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "ConfigInvalidError";
  }
}

function keyPath(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

function describeIssue(issue: z.core.$ZodIssue): string[] {
  const where = keyPath(issue.path);
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => `${where === "" ? key : `${where}.${key}`}: unknown key`);
  }
  return [`${where === "" ? "(top level)" : where}: ${issue.message}`];
}

/*
 * The yaml library's own messages quote the offending source line, which for
 * this file could be a secret, so only the error code and a position computed
 * here are kept.
 */
function describeYamlError(text: string, error: { code: string; pos: [number, number] }): string {
  const before = text.slice(0, error.pos[0]);
  const line = before.split("\n").length;
  const column = error.pos[0] - before.lastIndexOf("\n");
  return `invalid YAML at line ${String(line)}, column ${String(column)} (${error.code})`;
}

export function parseConfig(text: string, source: string): AppConfig {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    throw new ConfigInvalidError(
      source,
      document.errors.map((error) => describeYamlError(text, error)),
    );
  }

  const result = appConfigSchema.safeParse(document.toJS());
  if (!result.success) {
    throw new ConfigInvalidError(source, result.error.issues.flatMap(describeIssue));
  }
  return result.data;
}

/* ------------------------------------------------------------- secrets */

export type EnvSource = Record<string, string | undefined>;
export type ReadTextFile = (path: string) => string;

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretError";
  }
}

const MIN_AUTH_SECRET_LENGTH = 32;

/* Words that mean "this was copied from documentation, not generated". */
const PLACEHOLDER_PATTERN = /change.?me|replace.?me|placeholder|your.?secret|example|todo|xxxx/i;

/*
 * A value published for local development, as docker-compose.yml's is. Anyone
 * can sign a session with it, so only next dev may use it (#124).
 */
const DEVELOPMENT_ONLY_PATTERN = /not.?for.?production/i;

/*
 * NAME, or NAME_FILE naming a file to read it from. Both set is an error
 * rather than a precedence rule: which one wins is exactly the question an
 * operator should not have to remember when a login stops working.
 */
export function readSecret(
  name: string,
  env: EnvSource,
  readFile: ReadTextFile,
): string | undefined {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  const hasDirect = direct !== undefined && direct !== "";
  const hasFile = file !== undefined && file !== "";

  if (hasDirect && hasFile) {
    throw new SecretError(`Set either ${name} or ${name}_FILE, not both.`);
  }
  if (hasFile) {
    let content: string;
    try {
      content = readFile(file);
    } catch {
      throw new SecretError(`${name}_FILE points at ${file}, which could not be read.`);
    }
    /* Secret files conventionally end in a newline that is not part of the value. */
    const trimmed = content.replace(/(\r?\n)+$/, "");
    return trimmed === "" ? undefined : trimmed;
  }
  return hasDirect ? direct : undefined;
}

function requireSecret(name: string, env: EnvSource, readFile: ReadTextFile): string {
  const value = readSecret(name, env, readFile);
  if (value === undefined) {
    throw new SecretError(
      `${name} is not set. Provide it as an environment variable, or set ${name}_FILE to a file containing it.`,
    );
  }
  return value;
}

export type DatabaseCredentials = { user: string; password: string };

export function resolveDatabaseCredentials(
  env: EnvSource,
  readFile: ReadTextFile,
): DatabaseCredentials {
  return {
    user: requireSecret("DATABASE_USER", env, readFile),
    password: requireSecret("DATABASE_PASSWORD", env, readFile),
  };
}

export type AuthSecrets = { authSecret: string; googleClientSecret: string | undefined };

export function resolveAuthSecrets(
  config: AppConfig,
  env: EnvSource,
  readFile: ReadTextFile,
): AuthSecrets {
  const authSecret = requireSecret("AUTH_SECRET", env, readFile);
  if (authSecret.length < MIN_AUTH_SECRET_LENGTH || PLACEHOLDER_PATTERN.test(authSecret)) {
    throw new SecretError(
      `AUTH_SECRET must be a random value of at least ${String(MIN_AUTH_SECRET_LENGTH)} characters, ` +
        "not a placeholder. Generate one with: openssl rand -base64 32",
    );
  }
  /* Fails closed: an unset NODE_ENV is not development. */
  if (DEVELOPMENT_ONLY_PATTERN.test(authSecret) && env["NODE_ENV"] !== "development") {
    throw new SecretError(
      "AUTH_SECRET is a public development value, accepted only by next dev. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  return {
    authSecret,
    googleClientSecret:
      config.auth.google === undefined
        ? undefined
        : requireSecret("AUTH_GOOGLE_SECRET", env, readFile),
  };
}

/*
 * Credentials go through encodeURIComponent before the URL setter: the setter
 * leaves "%" alone, so a password containing "%41" would otherwise be decoded
 * to "A" by the driver.
 */
export function composeDatabaseUrl(base: string, { user, password }: DatabaseCredentials): string {
  const url = new URL(base);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  return url.toString();
}

export type RuntimeConfig = AppConfig & AuthSecrets & { databaseUrl: string };
