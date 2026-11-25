import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { type EnvSource, readSecret, SecretError } from "@/lib/config";
import { UnauthenticatedError } from "@/server/http/errors";

/*
 * Who may start the retention job (#279): the scheduler, by the bearer secret
 * CRON_SECRET (or CRON_SECRET_FILE), as Vercel Cron sends it. Read per
 * request, never at module scope (D-13-4), and never from config.yaml: it is
 * a secret. With none set, or one that cannot be read, nobody is let in, so
 * a deployment that forgot it exposes nothing.
 */
export function checkCronBearer(request: Request, env: EnvSource = process.env): void {
  let secret: string | undefined;
  try {
    secret = readSecret("CRON_SECRET", env, (path) => readFileSync(path, "utf8"));
  } catch (error) {
    if (!(error instanceof SecretError)) throw error;
  }
  const sent = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (secret === undefined || sent === undefined || !sameSecret(sent, secret)) {
    throw new UnauthenticatedError("Not authorised to run the retention job.");
  }
}

/* Constant time, whatever the lengths: both sides are hashed-length by padding to one buffer size. */
function sameSecret(sent: string, secret: string): boolean {
  const a = Buffer.from(sent);
  const b = Buffer.from(secret);
  const size = Math.max(a.length, b.length);
  const left = Buffer.alloc(size);
  const right = Buffer.alloc(size);
  a.copy(left);
  b.copy(right);
  return timingSafeEqual(left, right) && a.length === b.length;
}
