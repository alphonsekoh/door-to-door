import { AuthError, CredentialsSignin, type NextAuthConfig } from "next-auth";
import { createThrottledLog, type ThrottledLog } from "@/server/logging/error-log";

/*
 * The logger Auth.js is given (#128). Its default prints the error's message,
 * the cause's stack and every other cause property, in colour escapes. A forged
 * session cookie gets its own text into a jose message, so one anonymous
 * request could write lines and terminal escapes into the log, and an expired
 * cookie put its decrypted claims there. This writes the AuthError's type and
 * what the wrapped cause is: nothing a request chooses.
 */

export type AuthLogger = Required<
  Pick<NonNullable<NextAuthConfig["logger"]>, "error" | "warn" | "debug">
>;

export type AuthLogThrottles = { error: ThrottledLog; warn: ThrottledLog };

/* As long as the sign-in lines' (D-120-8): both are anyone's to set off. */
export const AUTH_LOG_QUIET_MS = 60_000;

/* A type, code or name: it becomes the throttle key as well as the line. */
const LABEL = /^[\w$-]{1,64}$/;

const isLabel = (value: unknown): value is string => typeof value === "string" && LABEL.test(value);

/*
 * What an error is, once the bundle is minified. Class names are mangled, and
 * differently in the proxy's build and the route's, so one jose error was two
 * lines of nonsense. Auth.js's type and the codes jose and Node give their
 * errors are string literals, which survive; a built-in such as TypeError has
 * only its name, which does too.
 */
function identify(error: Error): string {
  const code: unknown = (error as { code?: unknown }).code;
  const candidates = error instanceof AuthError ? [error.type] : [code, error.name];
  return candidates.find(isLabel) ?? "unknown";
}

/*
 * AuthError keeps the error it wraps as cause.err, beside that error's own
 * cause properties - which is where jose puts an expired token's claims.
 */
function wrappedCause(error: Error): unknown {
  return error instanceof AuthError ? error.cause?.err : error.cause;
}

/*
 * The class checks use this module graph's own Auth.js, so only the throttles
 * are shared between graphs: a logger built in the proxy's would not know the
 * route's CredentialsSignin.
 */
export function createAuthLogger(throttles: AuthLogThrottles): AuthLogger {
  return {
    error(error) {
      // A failed sign-in is the sign-in log's line, with its digest tag (D-120-8).
      if (error instanceof CredentialsSignin) {
        return;
      }
      const cause = wrappedCause(error);
      const line =
        cause instanceof Error
          ? `[auth][error] ${identify(error)} (cause ${identify(cause)})`
          : `[auth][error] ${identify(error)}`;
      throttles.error(line, line);
    },
    warn(code) {
      const line = `[auth][warn] ${isLabel(code) ? code : "unknown"}`;
      throttles.warn(line, line);
    },
    // Debug metadata is request bodies, the password among them, and cookies.
    debug: () => undefined,
  };
}

/*
 * Process-wide, like the database pool (D-87-3). The proxy and the Auth.js
 * route are separate module graphs that both decode the session cookie, so a
 * throttle each would log one forged request twice.
 */
const THROTTLES = Symbol.for("door-to-door.auth-log");
const processWide = globalThis as Record<symbol, AuthLogThrottles | undefined>;

export function authLogger(): AuthLogger {
  const throttles = processWide[THROTTLES] ?? {
    error: createThrottledLog({ quietMs: AUTH_LOG_QUIET_MS }),
    warn: createThrottledLog({
      log: (line) => {
        console.warn(line);
      },
      quietMs: AUTH_LOG_QUIET_MS,
    }),
  };
  processWide[THROTTLES] = throttles;
  return createAuthLogger(throttles);
}

/* Tests start each case with nothing suppressed. */
export function resetAuthLog(): void {
  processWide[THROTTLES] = undefined;
}
