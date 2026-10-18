import { parseArgs } from "node:util";
import type { Database } from "@/db/client";
import { readSecret, type EnvSource, type ReadTextFile } from "@/lib/config";
import {
  ADMIN_EXISTS_MESSAGE,
  CreateAdminError,
  adminExists,
  checkAdminEmail,
  checkAdminName,
  checkAdminPassword,
  createFirstAdmin,
  type CreatedAdmin,
} from "@/server/users/first-admin";

/*
 * The body of `npm run create-admin`, kept out of scripts/ so it is tested.
 *
 * The password is never a flag: arguments end up in shell history and in
 * `ps` output for anyone on the host. It comes from ADMIN_PASSWORD (or
 * ADMIN_PASSWORD_FILE) or, on a terminal, from a prompt that does not echo.
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

async function readPassword(io: CreateAdminIo): Promise<string> {
  const fromEnv = readSecret("ADMIN_PASSWORD", io.env, io.readFile);
  if (fromEnv !== undefined) {
    checkAdminPassword(fromEnv);
    return fromEnv;
  }
  if (io.prompt === undefined) {
    throw new CreateAdminError(`No password given: ${PASSWORD_SOURCES}.`);
  }
  /* Checked before the confirmation, so a short one is caught on the first try. */
  const password = await io.prompt("Password: ");
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
  const password = await readPassword(io);
  return createFirstAdmin(db, { ...args, password });
}
