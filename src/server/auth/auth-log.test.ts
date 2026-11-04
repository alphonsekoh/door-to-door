import { AuthError, CredentialsSignin } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_LOG_QUIET_MS,
  authLogger,
  createAuthLogger,
  resetAuthLog,
} from "@/server/auth/auth-log";
import { createThrottledLog } from "@/server/logging/error-log";

/* Shaped as Auth.js builds them, without reaching into @auth/core. */
class JWTSessionError extends AuthError {
  static type = "JWTSessionError";
}
class MissingCSRF extends AuthError {
  static type = "MissingCSRF";
}

/*
 * As jose's errors arrive in the production bundle: a literal code, and a
 * name copied from a class the minifier renamed.
 */
const joseError = (code: string, message: string) =>
  Object.assign(new Error(message), { name: "nN", code });

const FORGED = '"x\r\n[auth][error] forged line \u001b[31m\u001b]0;owned\u0007"';
const CLAIMS = {
  email: "ana.lim@example.com",
  name: "Ana Lim",
  sub: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  role: "admin",
};

/*
 * The cause Auth.js builds when it wraps an error: the error as cause.err,
 * beside that error's own cause properties.
 */
function wrapping(err: Error, extra: Record<string, unknown> = {}) {
  return new JWTSessionError("", { cause: { err, ...extra } });
}

const forgedCookie = () =>
  wrapping(
    joseError("ERR_JOSE_NOT_SUPPORTED", `Extension Header Parameter ${FORGED} is not recognized`),
  );

const expiredCookie = () =>
  wrapping(joseError("ERR_JWT_EXPIRED", '"exp" claim timestamp check failed'), {
    claim: "exp",
    reason: "check_failed",
    payload: CLAIMS,
  });

function harness() {
  let t = Date.parse("2026-11-03T10:00:00.000Z");
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = () => t;
  const logger = createAuthLogger({
    error: createThrottledLog({ log: (line) => errors.push(line), now, quietMs: 60_000 }),
    warn: createThrottledLog({ log: (line) => warnings.push(line), now, quietMs: 60_000 }),
  });
  return {
    logger,
    errors,
    warnings,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("an Auth.js error", () => {
  it("is written as its type and the wrapped cause's code, never the minified name", () => {
    const { logger, errors } = harness();
    logger.error(forgedCookie());
    expect(errors).toEqual(["[auth][error] JWTSessionError (cause ERR_JOSE_NOT_SUPPORTED)"]);
  });

  it("never carries the cause's message, so a cookie cannot write its own line", () => {
    const { logger, errors } = harness();
    logger.error(forgedCookie());
    const written = errors.join("");
    for (const forged of ["\r", "\n", "\u001b", "\u0007", "forged line", "owned", "Read more"]) {
      expect(written).not.toContain(forged);
    }
  });

  it("never carries the cause's properties, where jose puts an expired token's claims", () => {
    const { logger, errors } = harness();
    logger.error(expiredCookie());
    expect(errors).toEqual(["[auth][error] JWTSessionError (cause ERR_JWT_EXPIRED)"]);
    for (const claim of Object.values(CLAIMS)) {
      expect(errors.join("")).not.toContain(claim);
    }
  });

  it("is its type alone when it wraps nothing", () => {
    const { logger, errors } = harness();
    logger.error(new MissingCSRF("CSRF token was missing from request"));
    expect(errors).toEqual(["[auth][error] MissingCSRF"]);
  });

  it("is left to the sign-in log when it is a failed sign-in, so a failure is one line", () => {
    const { logger, errors } = harness();
    logger.error(new CredentialsSignin());
    expect(errors).toEqual([]);
  });
});

describe("an error that is not Auth.js's", () => {
  it("is written as its code, or a built-in's name, and its cause's", () => {
    const { logger, errors } = harness();
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    logger.error(new TypeError("fetch failed", { cause: refused }));
    logger.error(new RangeError("bad", { cause: new SyntaxError("socket 10.0.0.1") }));
    expect(errors).toEqual([
      "[auth][error] TypeError (cause ECONNREFUSED)",
      "[auth][error] RangeError (cause SyntaxError)",
    ]);
  });

  it("gains nothing from a cause that is not an Error", () => {
    const { logger, errors } = harness();
    logger.error(new TypeError("bad", { cause: "a line\r\nof its own" }));
    expect(errors).toEqual(["[auth][error] TypeError"]);
  });

  it("falls back from a code that is no identifier to the name, then to 'unknown'", () => {
    const { logger, errors } = harness();
    const forgedName = "Odd\r\n[auth][error] forged";
    logger.error(Object.assign(new Error("bad"), { code: "a\r\nb", name: "SyntaxError" }));
    logger.error(new TypeError("bad", { cause: Object.assign(new Error(), { name: forgedName }) }));
    logger.error(Object.assign(new Error("bad"), { code: 42, name: forgedName }));
    expect(errors).toEqual([
      "[auth][error] SyntaxError",
      "[auth][error] TypeError (cause unknown)",
      "[auth][error] unknown",
    ]);
  });
});

describe("throttling", () => {
  it("writes ten identical errors as one line, then says how many it held back", () => {
    const { logger, errors, advance } = harness();
    for (let i = 0; i < 10; i += 1) {
      logger.error(forgedCookie());
    }
    expect(errors).toHaveLength(1);

    advance(AUTH_LOG_QUIET_MS);
    logger.error(forgedCookie());
    expect(errors.at(-1)).toBe(
      "[auth][error] JWTSessionError (cause ERR_JOSE_NOT_SUPPORTED) (9 similar suppressed since 10:00:00Z)",
    );
  });

  it("gives a different cause a line of its own", () => {
    const { logger, errors } = harness();
    logger.error(forgedCookie());
    logger.error(expiredCookie());
    logger.error(forgedCookie());
    expect(errors).toEqual([
      "[auth][error] JWTSessionError (cause ERR_JOSE_NOT_SUPPORTED)",
      "[auth][error] JWTSessionError (cause ERR_JWT_EXPIRED)",
    ]);
  });
});

describe("warnings and debug", () => {
  it("writes a warning's code once per burst", () => {
    const { logger, warnings } = harness();
    logger.warn("debug-enabled");
    logger.warn("debug-enabled");
    logger.warn("csrf-disabled");
    expect(warnings).toEqual(["[auth][warn] debug-enabled", "[auth][warn] csrf-disabled"]);
  });

  it("writes 'unknown' for a code that is no identifier", () => {
    const { logger, warnings } = harness();
    logger.warn("bad\ncode" as Parameters<typeof logger.warn>[0]);
    expect(warnings).toEqual(["[auth][warn] unknown"]);
  });

  it("writes nothing for debug, whose metadata holds request bodies", () => {
    const writes = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { logger, errors, warnings } = harness();
    logger.debug("callback route error details", { body: { password: "hunter2" } });
    expect([...errors, ...warnings]).toEqual([]);
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
});

describe("the process-wide logger", () => {
  beforeEach(() => {
    resetAuthLog();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetAuthLog();
  });

  it("writes errors to console.error and warnings to console.warn", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    authLogger().error(new MissingCSRF());
    authLogger().warn("csrf-disabled");
    expect(error.mock.calls).toEqual([["[auth][error] MissingCSRF"]]);
    expect(warn.mock.calls).toEqual([["[auth][warn] csrf-disabled"]]);
  });

  it("throttles across another module graph's copy, which still knows its own Auth.js", async () => {
    // Next bundles the proxy and the route separately; each has its own copy of both.
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.resetModules();
    const other = {
      log: await import("@/server/auth/auth-log"),
      nextAuth: await import("next-auth"),
    };
    expect(other.nextAuth.CredentialsSignin).not.toBe(CredentialsSignin);

    authLogger().error(new TypeError("first"));
    other.log.authLogger().error(new TypeError("second"));
    expect(error).toHaveBeenCalledTimes(1);

    other.log.authLogger().error(new other.nextAuth.CredentialsSignin());
    expect(error).toHaveBeenCalledTimes(1);
  });
});
