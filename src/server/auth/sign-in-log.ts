import { createHmac, randomBytes } from "node:crypto";
import { createThrottledLog, summarizeError } from "@/server/logging/error-log";

/*
 * Limiter keys and log tags for sign-in (#120).
 *
 * Keyed HMAC rather than a plain hash: an email is guessable, so its SHA-256
 * is as good as the email to anyone holding a log. The key is random per
 * process, as the limiter already is (D-15-3), so there is no secret to
 * manage, and a fixed-size digest keeps every limiter key the same size.
 */
let digestSecret: Buffer | undefined;

export type DigestKind = "account" | "client";

export function digestKey(kind: DigestKind, value: string): string {
  digestSecret ??= randomBytes(32);
  return createHmac("sha256", digestSecret).update(`${kind}:${value}`).digest("hex");
}

export type SignInBudget = "global" | "client" | "account";

export type SignInLog = {
  failed: (tag: string) => void;
  oversized: () => void;
  limited: (budget: SignInBudget, tag?: string) => void;
  unattributed: () => void;
  unexpected: (error: unknown) => void;
};

export type SignInLogOptions = {
  log?: (line: string) => void;
  now?: () => number;
  quietMs?: number;
};

const TAG_LENGTH = 12;

/*
 * Every throttle key is a constant. A key built from the request would let a
 * caller choose its own line, and bring back the unbounded Map this replaces.
 */
export function createSignInLog({
  log = (line) => {
    console.warn(line);
  },
  now = () => Date.now(),
  quietMs = 60_000,
}: SignInLogOptions = {}): SignInLog {
  const report = createThrottledLog({ log, now, quietMs });
  const short = (tag: string) => tag.slice(0, TAG_LENGTH);

  return {
    failed: (tag) => {
      report("sign-in:failed", `Sign-in failed: wrong email or password (account ${short(tag)})`);
    },
    oversized: () => {
      report(
        "sign-in:oversized",
        "Sign-in refused: an email or password longer than any account can have",
      );
    },
    limited: (budget, tag) => {
      const who = tag === undefined ? "" : ` (${budget} ${short(tag)})`;
      report("sign-in:limited", `Sign-in refused: the ${budget} attempt budget is spent${who}`);
    },
    unattributed: () => {
      report(
        "sign-in:unattributed",
        "Sign-in from no usable X-Forwarded-For entry: counted in the shared unattributed " +
          "budget. Check rateLimit.trustedProxyHops against the proxies in front of the app.",
      );
    },
    /*
     * Not a refusal: the check itself failed, the database most likely. Auth.js
     * reports it as one more CredentialsSignin, which its logger leaves to
     * these lines (#128).
     */
    unexpected: (error) => {
      report("sign-in:unexpected", `Sign-in could not be checked: ${summarizeError(error)}`);
    },
  };
}
