import type { NextAuthConfig } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { buildAuthConfig } from "@/server/auth/config";
import type * as SignIns from "@/server/auth/sign-ins";

/*
 * The callbacks are thin wrappers over the pure functions in callbacks.ts and
 * the sign-in records in sign-ins.ts, but they are the wiring Auth.js
 * actually calls - a mistake here would mean a role never reaching the
 * session, or a sign-in never checked, with every other test still green.
 */

const BASE = {
  databaseUrl: "postgresql://postgres:postgres@localhost:5432/nowhere",
  authSecret: "a-secret-that-is-long-enough-for-tests",
  auth: { trustHost: false, secureCookies: false },
  rateLimit: {
    signInAttempts: 10,
    signInAttemptsPerClient: 30,
    signInWindowSeconds: 300,
    trustedProxyHops: 0,
  },
  googleClientSecret: undefined,
};

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig }));

const { startSignIn, checkSignIn, endSignIn } = vi.hoisted(() => ({
  startSignIn: vi.fn(),
  checkSignIn: vi.fn(),
  endSignIn: vi.fn(),
}));
vi.mock("@/server/auth/sign-ins", async (importOriginal) => ({
  ...(await importOriginal<typeof SignIns>()),
  startSignIn,
  checkSignIn,
  endSignIn,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getConfig.mockReturnValue(BASE);
});

afterEach(async () => {
  await resetDatabase();
});

const config = () => buildAuthConfig();
const ids = (built: NextAuthConfig) =>
  built.providers.map((provider) => (typeof provider === "function" ? "" : provider.id));

const USER = "11111111-0000-4000-8000-000000000001";
const SIGN_IN = "22222222-0000-4000-8000-000000000002";
const PIXEL = "Mozilla/5.0 (Linux; Android 11; Pixel 5) Chrome/120.0 Mobile Safari/537.36";

/* Auth.js types the sign-in and pass-through calls as one union that does not
   model the runtime shapes separately. */
async function jwt(built: NextAuthConfig, params: Record<string, unknown>) {
  const callback = built.callbacks?.jwt;
  if (callback === undefined) throw new Error("the config has no jwt callback");
  return callback(params as never);
}

describe("session strategy", () => {
  it("uses JWTs, forced by the Credentials provider in #15", () => {
    expect(config().session?.strategy).toBe("jwt");
  });

  it("expires sessions after 30 days", () => {
    expect(config().session?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it("routes sign-in and errors to our own page", () => {
    expect(config().pages?.signIn).toBe("/sign-in");
    expect(config().pages?.error).toBe("/sign-in");
  });
});

describe("providers", () => {
  it("offers email and password alone while Google is not set up", () => {
    expect(ids(config())).toEqual(["credentials"]);
  });

  it("adds Google once config.yaml sets it up (#14)", () => {
    getConfig.mockReturnValue({
      ...BASE,
      auth: {
        ...BASE.auth,
        google: { clientId: "id.apps.googleusercontent.com", domains: ["gmail.com"] },
      },
      googleClientSecret: "secret",
    });
    expect(ids(config())).toEqual(["credentials", "google"]);
  });

  it("refuses a Google client id with no secret rather than send Google a blank one", () => {
    getConfig.mockReturnValue({
      ...BASE,
      auth: {
        ...BASE.auth,
        google: { clientId: "id.apps.googleusercontent.com", domains: ["gmail.com"] },
      },
    });
    expect(config).toThrow("AUTH_GOOGLE_SECRET");
  });
});

describe("settings from config", () => {
  it("signs with the configured secret", () => {
    expect(config().secret).toBe("a-secret-that-is-long-enough-for-tests");
  });

  it("honours auth.trustHost rather than always trusting the host header", () => {
    expect(config().trustHost).toBe(false);
  });

  it("takes the cookie flags from auth.secureCookies, not the request's scheme", () => {
    // The proxy builds from the same base, so both name the cookies alike.
    expect(config().useSecureCookies).toBe(false);
  });
});

describe("signIn callback", () => {
  it("lets credentials through: authorize has judged them already", async () => {
    const signIn = config().callbacks?.signIn;
    expect(
      await signIn?.({ user: { id: USER }, account: { provider: "credentials" } } as never),
    ).toBe(true);
  });
});

describe("jwt callback at sign-in (#125)", () => {
  const request = new Request("https://test.local/api/auth/callback/credentials", {
    headers: { "user-agent": PIXEL },
  });

  it("starts a sign-in record and names it on the token, with the user's role", async () => {
    startSignIn.mockResolvedValue(SIGN_IN);
    const token = await jwt(buildAuthConfig(request), {
      token: {},
      user: { id: USER, email: "a@b.c", role: "admin", deactivatedAt: null },
      account: null,
      trigger: "signIn",
    });
    expect(token).toMatchObject({
      sub: USER,
      role: "admin",
      deactivated: false,
      signInId: SIGN_IN,
    });
    expect(startSignIn).toHaveBeenCalledWith(expect.anything(), USER, PIXEL);
  });

  it("does the same for an account Auth.js calls new, and without a user agent", async () => {
    startSignIn.mockResolvedValue(SIGN_IN);
    const token = await jwt(config(), {
      token: {},
      user: { id: USER },
      account: null,
      trigger: "signUp",
    });
    expect(token).toMatchObject({ signInId: SIGN_IN });
    expect(startSignIn).toHaveBeenCalledWith(expect.anything(), USER, null);
  });

  it("refuses, as AccessDenied, an account deactivated since it was judged", async () => {
    startSignIn.mockResolvedValue(null);
    await expect(
      jwt(config(), { token: {}, user: { id: USER }, account: null, trigger: "signIn" }),
    ).rejects.toMatchObject({ type: "AccessDenied" });
  });

  it("refuses a user with no id of ours, writing nothing", async () => {
    await expect(
      jwt(config(), { token: {}, user: { email: "a@b.c" }, account: null, trigger: "signIn" }),
    ).rejects.toMatchObject({ type: "AccessDenied" });
    expect(startSignIn).not.toHaveBeenCalled();
  });
});

describe("jwt callback afterwards", () => {
  const existing = { sub: USER, role: "member" as const, deactivated: false, signInId: SIGN_IN };
  const onAuthRoute = () => buildAuthConfig(new Request("https://test.local/api/auth/session"));

  it("passes the token through for the app's own auth(), with no lookup: resolveSession checks", async () => {
    expect(await jwt(config(), { token: existing })).toMatchObject(existing);
    expect(checkSignIn).not.toHaveBeenCalled();
  });

  it.each(["live", "deactivated"])(
    "keeps the token of a %s sign-in on Auth.js's routes",
    async (status) => {
      checkSignIn.mockResolvedValue({ status });
      expect(await jwt(onAuthRoute(), { token: existing })).toMatchObject(existing);
      expect(checkSignIn).toHaveBeenCalledWith(expect.anything(), USER, SIGN_IN);
    },
  );

  it.each(["ended", "no-user"])("names nobody for a sign-in that is %s", async (status) => {
    checkSignIn.mockResolvedValue({ status });
    expect(await jwt(onAuthRoute(), { token: existing })).toBeNull();
  });

  it("names nobody for a token naming no account, without a lookup", async () => {
    expect(await jwt(onAuthRoute(), { token: { role: "member" } })).toBeNull();
    expect(checkSignIn).not.toHaveBeenCalled();
  });

  it("keeps the token when the lookup fails, and says so in the log", async () => {
    checkSignIn.mockRejectedValue(new Error("connection lost"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await jwt(onAuthRoute(), { token: existing })).toMatchObject(existing);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("logs a lookup failure that is not an Error too", async () => {
    checkSignIn.mockRejectedValue("connection lost");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await jwt(onAuthRoute(), { token: existing })).toMatchObject(existing);
    } finally {
      errors.mockRestore();
    }
  });

  it("checks the sign-in before a rename is applied, and renames only the name", async () => {
    checkSignIn.mockResolvedValue({ status: "live" });
    const token = await jwt(onAuthRoute(), {
      token: existing,
      trigger: "update",
      session: { name: "New Name", role: "admin" },
    });
    expect(token).toMatchObject({ name: "New Name", role: "member", signInId: SIGN_IN });
  });
});

describe("signing out", () => {
  const signOut = (message: unknown) => config().events?.signOut?.(message as never);

  it("ends the token's own sign-in, and no other", async () => {
    await signOut({ token: { sub: USER, signInId: SIGN_IN } });
    expect(endSignIn).toHaveBeenCalledWith(expect.anything(), USER, SIGN_IN);
  });

  it.each([
    ["no token", { token: null }],
    ["a token naming nobody", { token: { signInId: SIGN_IN } }],
    ["a database session, which this app never has", { session: null }],
  ])("ends nothing for %s", async (_name, message) => {
    await signOut(message);
    expect(endSignIn).not.toHaveBeenCalled();
  });
});

describe("session callback", () => {
  it("surfaces the token's role and sign-in on the session the app reads", async () => {
    const sessionCallback = config().callbacks?.session;
    const result = await sessionCallback?.({
      session: {
        user: { id: "", email: "a@b.c", emailVerified: null },
        expires: "2026-12-01T00:00:00Z",
        via: "",
      } as never,
      token: { sub: USER, role: "admin", deactivated: false, signInId: SIGN_IN },
    } as never);
    expect(result).toMatchObject({
      signInId: SIGN_IN,
      user: { id: USER, role: "admin", deactivated: false },
    });
  });
});
