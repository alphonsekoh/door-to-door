import { hash, verify } from "@node-rs/argon2";

/*
 * argon2id at the OWASP-recommended defaults the library ships with
 * (m=19456, t=2, p=1). Parameters are encoded in the hash string, so raising
 * them later does not invalidate existing hashes.
 */

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

export const MIN_PASSWORD_LENGTH = 8;

/* Matches CreateUserRequest.password.maxLength in the contract. */
export const MAX_PASSWORD_LENGTH = 200;

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  return hash(password);
}

/*
 * Returns false rather than throwing on a malformed stored hash. A corrupt row
 * must read as "wrong password", never as a crash that distinguishes it from a
 * valid account.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (!storedHash) {
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
