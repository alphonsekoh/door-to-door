import { parseArgs } from "node:util";
import type { Database } from "@/db/client";
import { readSecret, type EnvSource, type ReadTextFile } from "@/lib/config";
import { inGoogleDomains } from "@/lib/session/google-domains";
import {
  ADMIN_EXISTS_MESSAGE,
  CreateAdminError,
  adminExists,
  checkAdminEmail,
  checkAdminName,
  checkAdminPassword,
  checkGoogleOnlyAdmin,
  createFirstAdmin,
  type CreatedAdmin,
} from "@/server/users/first-admin";

/*
 * The body of `npm run create-admin`, kept out of scripts/ so it is tested.
 *
 * The password is never a flag: arguments end up in shell history and in
 * `ps` output for anyone on the host. It comes from ADMIN_PASSWORD (or
 * ADMIN_PASSWORD_FILE) or, on a terminal, from a prompt that does not echo.
 *
 * Left empty at the prompt, it makes an admin who signs in with Google only
 * (#14), once the email has been typed again: a typo there would leave an
 * admin nobody can sign in as, and this works only once. Offered only for an
 * address on one of the domains Google signs in for.
 */

export const USAGE = 'Usage: npm run create-admin -- --email <address> [--name "<name>"]';

export const PASSWORD_SOURCES =
  "set ADMIN_PASSWORD or ADMIN_PASSWORD_FILE, or run this in a terminal to be prompted";

export type CreateAdminIo = {
  argv: readonly string[];
  env: EnvSource;
  readFile: ReadTextFile;
  /* Undefined when there is no terminal to ask on. */
  prompt: ((question: string) => Promise<string>) | undefined;
  /* config.yaml's auth.google.domains, or null when Google sign-in is not set up. */
  googleDomains: readonly string[] | null;
};

type Args = { email: string; name: string | null };

export function parseCreateAdminArgs(argv: readonly string[]): Args {
  if (argv.some((arg) => arg === "--password" || arg.startsWith("--password="))) {
    throw new CreateAdminError(
      `A password is never taken as an argument, where it would be saved in shell history: ${PASSWORD_SOURCES}.`,
    );
  }
  let values: { email?: string | undefined; name?: string | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { email: { type: "string" }, name: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new CreateAdminError(`${(error as Error).message}\n${USAGE}`);
  }
  if (values.email === undefined) {
    throw new CreateAdminError(`The admin's email is required.\n${USAGE}`);
  }
  return {
    email: checkAdminEmail(values.email),
    name: values.name === undefined ? null : checkAdminName(values.name),
  };
}

/* Null for an admin who signs in with Google only. */
async function readPassword(io: CreateAdminIo, email: string): Promise<string | null> {
  const fromEnv = readSecret("ADMIN_PASSWORD", io.env, io.readFile);
  if (fromEnv !== undefined) {
    checkAdminPassword(fromEnv);
    return fromEnv;
  }
  if (io.prompt === undefined) {
    throw new CreateAdminError(`No password given: ${PASSWORD_SOURCES}.`);
  }
  const googleOnly = io.googleDomains !== null && inGoogleDomains(email, io.googleDomains);
  const password = await io.prompt(
    googleOnly ? "Password (leave empty for Google sign-in only): " : "Password: ",
  );
  if (password === "") {
    /* Before the email is asked for again, so a refusal costs one prompt. */
    checkGoogleOnlyAdmin(email, io.googleDomains);
    const again = await io.prompt("Type the email again to confirm: ");
    if (again.trim().toLowerCase() !== email) {
      throw new CreateAdminError("The emails did not match, so nothing was changed.");
    }
    return null;
  }
  /* Checked before the confirmation, so a short one is caught on the first try. */
  checkAdminPassword(password);
  if ((await io.prompt("Confirm password: ")) !== password) {
    throw new CreateAdminError("The passwords did not match, so nothing was changed.");
  }
  return password;
}

export async function runCreateAdmin(db: Database, io: CreateAdminIo): Promise<CreatedAdmin> {
  const args = parseCreateAdminArgs(io.argv);
  /*
   * Refused before asking for a password nobody will use. createFirstAdmin
   * checks again under its lock, which is the check that actually holds.
   */
  if (await adminExists(db)) {
    throw new CreateAdminError(ADMIN_EXISTS_MESSAGE);
  }
  const password = await readPassword(io, args.email);
  return createFirstAdmin(db, { ...args, password }, io.googleDomains);
}

/* What the script says once it is done; it says when a request was taken over (#249). */
export function describeCreated(admin: CreatedAdmin): string {
  const made = admin.fromRequest
    ? `${admin.email} had asked to join with Google, and is now the admin.`
    : `Created admin ${admin.email}.`;
  const way = admin.googleOnly
    ? `Sign in with Google as ${admin.email}.`
    : "Sign in with that email and the password given.";
  return `${made} ${way}`;
}
