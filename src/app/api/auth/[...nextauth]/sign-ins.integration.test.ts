import { format } from "node:util";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool, resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";
import { resetDefaultLimiter } from "@/server/auth/credentials";
import { getConfig } from "@/server/config";
import { hashPassword } from "@/server/password";
import { GET, POST } from "./route";

/*
 * Sign-ins through the real Auth.js route (#125): each sign-in its own row,
 * sign-out ending only that one, and the session endpoint naming nobody for
 * a token whose sign-in has ended. That endpoint is what the phone asks to
 * learn who is signed in, sign-out's check among them (D-129-4).
 */

const pool = createTestPool();
// NextRequest names 127.0.0.1 localhost, and Auth.js builds its redirects from that.
const ORIGIN = "http://localhost:3210";
const SESSION_COOKIE = "__Secure-authjs.session-token";
const PASSWORD = "correct-horse-battery";
const ALICE = "5e5e5e5e-0000-4000-8000-000000000001";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

let hash = "";

beforeEach(async () => {
  resetDefaultLimiter();
  await truncateAll(pool);
  hash ||= await hashPassword(PASSWORD);
  await pool.query(
    `INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,'alice@t.local','Alice','member',$2)`,
    [ALICE, hash],
  );
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

type Jar = Map<string, string>;

function keep(jar: Jar, response: Response): void {
  for (const set of response.headers.getSetCookie()) {
    const [pair = ""] = set.split(";");
    const at = pair.indexOf("=");
    const value = pair.slice(at + 1);
    if (value === "") jar.delete(pair.slice(0, at));
    else jar.set(pair.slice(0, at), value);
  }
}

const header = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

async function csrf(jar: Jar): Promise<string> {
  const response = await GET(
    new NextRequest(`${ORIGIN}/api/auth/csrf`, { headers: { cookie: header(jar) } }),
  );
  keep(jar, response);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

/* A phone signing in through the form, as next-auth/react posts it. */
async function signIn(userAgent: string): Promise<Jar> {
  const jar: Jar = new Map();
  const csrfToken = await csrf(jar);
  const response = await POST(
    new NextRequest(`${ORIGIN}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: header(jar),
        "user-agent": userAgent,
      },
      body: new URLSearchParams({ csrfToken, email: "alice@t.local", password: PASSWORD }),
    }),
  );
  keep(jar, response);
  expect(jar.has(SESSION_COOKIE)).toBe(true);
  return jar;
}

/* As next-auth/react's signOut posts it, asking for JSON rather than a redirect. */
async function signOut(jar: Jar): Promise<Response> {
  const csrfToken = await csrf(jar);
  const response = await POST(
    new NextRequest(`${ORIGIN}/api/auth/signout`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-auth-return-redirect": "1",
        cookie: header(jar),
      },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${ORIGIN}/account` }),
    }),
  );
  keep(jar, response);
  return response;
}

async function session(jar: Jar): Promise<{ named: string | null; response: Response }> {
  const response = await GET(
    new NextRequest(`${ORIGIN}/api/auth/session`, { headers: { cookie: header(jar) } }),
  );
  const body = (await response.clone().json()) as { user?: { id?: string } } | null;
  return { named: body?.user?.id ?? null, response };
}

const clears = (response: Response) =>
  response.headers
    .getSetCookie()
    .some((set) => set.startsWith(`${SESSION_COOKIE}=;`) && /Max-Age=0(;|$)/i.test(set));

const signInRows = async () =>
  (
    await pool.query<{ id: string; user_agent: string }>(
      `SELECT id, user_agent FROM sign_ins WHERE user_id = $1`,
      [ALICE],
    )
  ).rows.sort((a, b) => a.user_agent.localeCompare(b.user_agent));

describe("signing in", () => {
  it("records each sign-in with the device it came from", async () => {
    const phone = await signIn(PIXEL);
    await signIn(IPHONE);

    expect((await signInRows()).map((row) => row.user_agent)).toEqual(
      [PIXEL, IPHONE].sort((a, b) => a.localeCompare(b)),
    );
    expect((await session(phone)).named).toBe(ALICE);
  });
});

describe("signing out", () => {
  it("ends this sign-in only: the member's other phone stays signed in", async () => {
    const phone = await signIn(PIXEL);
    const other = await signIn(IPHONE);
    const copied = new Map(phone);

    await signOut(phone);

    expect((await signInRows()).map((row) => row.user_agent)).toEqual([IPHONE]);
    expect((await session(other)).named).toBe(ALICE);
    // The cookie as it was before signing out, copied off the phone.
    const old = await session(copied);
    expect(old.named).toBeNull();
    expect(clears(old.response)).toBe(true);
  });
});

/*
 * #162 in the failure mode of R-155: Auth.js clears the cookie whatever its
 * signOut event does, and a sign-in left live is brought back by a late
 * answer setting the old cookie again.
 */
describe("signing out when the sign-in cannot be ended", () => {
  it("answers as Auth.js always has once it is ended: the cookie cleared, back to where it was", async () => {
    const phone = await signIn(PIXEL);
    const response = await signOut(phone);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: `${ORIGIN}/account` });
    expect(clears(response)).toBe(true);
    expect(await signInRows()).toEqual([]);
  });

  it("fails, keeping the cookie and the sign-in, so the member can try again", async () => {
    const phone = await signIn(PIXEL);
    const before = new Map(phone);
    const broken = vi.spyOn(getPool(), "query").mockRejectedValue(new Error("connection lost"));
    const logged: string[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(format(...args));
    });
    let response: Response;
    try {
      response = await signOut(phone);
    } finally {
      broken.mockRestore();
      errors.mockRestore();
    }

    expect(response.status).toBe(500);
    // What the client's sign-out reads as refused (src/lib/session/sign-out.ts).
    expect(await response.json()).toEqual({ url: "/sign-in?error=SignOutError" });
    expect(response.headers.getSetCookie().filter((set) => set.startsWith(SESSION_COOKIE))).toEqual(
      [],
    );
    expect(phone).toEqual(before);
    expect((await signInRows()).map((row) => row.user_agent)).toEqual([PIXEL]);
    expect((await session(phone)).named).toBe(ALICE);
    // Auth.js's own line for an event that threw, and only that.
    expect(logged).toEqual([expect.stringMatching(/^\[auth\]\[error\] EventError/)]);

    // Once the database is back, signing out again works.
    expect(clears(await signOut(phone))).toBe(true);
    expect(await signInRows()).toEqual([]);
  });

  it("ends nothing for a sign-out Auth.js refuses, a forged one with no CSRF token", async () => {
    const phone = await signIn(PIXEL);
    const response = await POST(
      new NextRequest(`${ORIGIN}/api/auth/signout`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: header(phone) },
        body: new URLSearchParams({}),
      }),
    );

    expect(clears(response)).toBe(false);
    expect(await signInRows()).toHaveLength(1);
  });
});

describe("the session endpoint", () => {
  it("names nobody for a sign-in an admin ended, and clears its cookie", async () => {
    const phone = await signIn(PIXEL);
    await pool.query(`DELETE FROM sign_ins`);

    const { named, response } = await session(phone);
    expect(named).toBeNull();
    expect(clears(response)).toBe(true);
  });

  it("still names a deactivated member, whom the app then tells so (D-85-2)", async () => {
    const phone = await signIn(PIXEL);
    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]);
    expect((await session(phone)).named).toBe(ALICE);
  });

  it("names nobody once the account is gone", async () => {
    const phone = await signIn(PIXEL);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ALICE]);
    expect((await session(phone)).named).toBeNull();
  });

  it("names nobody for a token from before sign-ins were recorded, or one naming no account", async () => {
    const issued = async (token: Record<string, unknown>) =>
      new Map([
        [
          SESSION_COOKIE,
          await encode({ token, secret: getConfig().authSecret, salt: SESSION_COOKIE }),
        ],
      ]);
    expect((await session(await issued({ sub: ALICE, role: "member" }))).named).toBeNull();
    expect((await session(await issued({ role: "member" }))).named).toBeNull();
  });

  it("keeps the cookie through a database outage: it authorizes nothing, and the API answers 500", async () => {
    const phone = await signIn(PIXEL);
    const broken = vi.spyOn(getPool(), "query").mockRejectedValue(new Error("connection lost"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { named, response } = await session(phone);
      expect(named).toBe(ALICE);
      expect(clears(response)).toBe(false);
    } finally {
      broken.mockRestore();
      quiet.mockRestore();
    }
  });
});
