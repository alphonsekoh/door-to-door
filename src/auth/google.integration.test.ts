import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ServerConfig from "@/server/config";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";
import { buildAuthConfig } from "@/server/auth/config";
import {
  FAKE_GOOGLE_CLIENT_ID,
  FAKE_GOOGLE_CLIENT_SECRET,
  createFakeGoogle,
  fakeGoogleCode,
  type FakeGoogleAccount,
} from "../../e2e/fake-google";

/*
 * Google sign-in end to end through Auth.js (#14), with Google's servers
 * stood in for by the fake the E2E suite also runs: discovery, the token
 * endpoint and a signed ID token, through the provider's customFetch.
 * Nothing here reaches Google.
 */

const ISSUER = "https://fake-google.test";
const fake = createFakeGoogle(ISSUER);

vi.mock("@/server/config", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerConfig>();
  return {
    ...actual,
    getConfig: () => {
      const config = actual.getConfig();
      return {
        ...config,
        auth: { ...config.auth, google: { clientId: FAKE_GOOGLE_CLIENT_ID, issuer: ISSUER } },
        googleClientSecret: FAKE_GOOGLE_CLIENT_SECRET,
      };
    },
  };
});

const { handlers } = NextAuth((request) =>
  buildAuthConfig(request, { googleFetch: (input, init) => fake.handle(new Request(input, init)) }),
);

const pool = createTestPool();
// NextRequest names 127.0.0.1 localhost, and Auth.js builds its redirects from that.
const ORIGIN = "http://localhost:3210";
const SESSION_COOKIE = "__Secure-authjs.session-token";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

const ALICE = "6006e000-0000-4000-8000-000000000001";
const BEN = "6006e000-0000-4000-8000-000000000002";
const GONE = "6006e000-0000-4000-8000-000000000003";

beforeEach(async () => {
  await truncateAll(pool);
  // Alice is Google-only; Ben also has a password; Gone is deactivated.
  await pool.query(
    `INSERT INTO users (id, email, name, role, password_hash, deactivated_at) VALUES
      ($1,'alice@t.local','Alice','member',NULL,NULL),
      ($2,'ben@t.local','Ben','member','not-a-real-hash',NULL),
      ($3,'gone@t.local','Gone','member',NULL,now())`,
    [ALICE, BEN, GONE],
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
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (value === "" || /expires=Thu, 01 Jan 1970/i.test(set)) jar.delete(name);
    else jar.set(name, value);
  }
}

const header = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/* The phone's whole trip: the button, Google's page (answered as `account`), the way back. */
async function signInWithGoogle(account: FakeGoogleAccount, jar: Jar = new Map()) {
  const csrf = await handlers.GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
  keep(jar, csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };

  const start = await handlers.POST(
    new NextRequest(`${ORIGIN}/api/auth/signin/google`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: header(jar) },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${ORIGIN}/` }),
    }),
  );
  keep(jar, start);
  const authorize = new URL(start.headers.get("location") ?? "");

  const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
  back.searchParams.set("code", fakeGoogleCode(account));
  const state = authorize.searchParams.get("state");
  if (state !== null) back.searchParams.set("state", state);
  const callback = await handlers.GET(
    new NextRequest(back, { headers: { cookie: header(jar), "user-agent": PIXEL } }),
  );
  keep(jar, callback);
  return { authorize, callback, jar };
}

async function signedInAs(jar: Jar): Promise<string | null> {
  const response = await handlers.GET(
    new NextRequest(`${ORIGIN}/api/auth/session`, { headers: { cookie: header(jar) } }),
  );
  const body = (await response.json()) as { user?: { id?: string } } | null;
  return body?.user?.id ?? null;
}

const counts = async () =>
  (
    await pool.query<{ users: number; accounts: number; sign_ins: number }>(
      `SELECT (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM accounts) AS accounts,
              (SELECT count(*)::int FROM sign_ins) AS sign_ins`,
    )
  ).rows[0];

const REFUSED = `${ORIGIN}/sign-in?error=AccessDenied`;

describe("leaving for Google", () => {
  it("asks Google for its account chooser every time, at the configured issuer", async () => {
    const { authorize } = await signInWithGoogle({ email: "alice@t.local", verified: true });
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(authorize.searchParams.get("prompt")).toBe("select_account");
    expect(authorize.searchParams.get("client_id")).toBe(FAKE_GOOGLE_CLIENT_ID);
  });
});

describe("an address an admin added, verified by Google", () => {
  it("links to that account and signs in, keeping no Google token and changing nothing on it", async () => {
    const { callback, jar } = await signInWithGoogle({ email: "alice@t.local", verified: true });

    expect(callback.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(await signedInAs(jar)).toBe(ALICE);

    const { rows: linked } = await pool.query(
      `SELECT user_id, provider, access_token, refresh_token, id_token, expires_at, scope
       FROM accounts`,
    );
    expect(linked).toEqual([
      {
        user_id: ALICE,
        provider: "google",
        access_token: null,
        refresh_token: null,
        id_token: null,
        expires_at: null,
        scope: null,
      },
    ]);
    const { rows: users } = await pool.query(`SELECT name, email, image FROM users WHERE id = $1`, [
      ALICE,
    ]);
    expect(users).toEqual([{ name: "Alice", email: "alice@t.local", image: null }]);
    const { rows: signIns } = await pool.query(`SELECT user_id, user_agent FROM sign_ins`);
    expect(signIns).toEqual([{ user_id: ALICE, user_agent: PIXEL }]);
  });

  it("uses the same link the next time, with a sign-in of its own", async () => {
    await signInWithGoogle({ email: "alice@t.local", verified: true });
    const second = await signInWithGoogle({ email: "Alice@T.local", verified: true });

    expect(await signedInAs(second.jar)).toBe(ALICE);
    expect(await counts()).toEqual({ users: 3, accounts: 1, sign_ins: 2 });
  });

  it("links to the address's own account, never to the one whose cookie is on the phone", async () => {
    // Alice is signed in on a shared phone; Ben picks it up and signs in with Google.
    const alice = await signInWithGoogle({ email: "alice@t.local", verified: true });
    const ben = await signInWithGoogle({ email: "ben@t.local", verified: true }, alice.jar);

    expect(await signedInAs(ben.jar)).toBe(BEN);
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM accounts ORDER BY user_id`,
    );
    expect(rows.map((row) => row.user_id)).toEqual([ALICE, BEN]);
  });
});

describe("refused, with one message for every reason (D-15-1), and nothing created", () => {
  it.each<[string, FakeGoogleAccount]>([
    ["an address nobody added", { email: "stranger@t.local", verified: true }],
    ["an address Google has not verified", { email: "alice@t.local", verified: false }],
    ["a deactivated account", { email: "gone@t.local", verified: true }],
  ])("%s", async (_name, account) => {
    const before = await counts();
    const { callback, jar } = await signInWithGoogle(account);

    expect(callback.headers.get("location")).toBe(REFUSED);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it("a Google account linked to someone whose address it no longer carries", async () => {
    const sub = "google-account-of-alice";
    await signInWithGoogle({ email: "alice@t.local", verified: true, sub });
    // The same Google account, now carrying Ben's address.
    const { callback, jar } = await signInWithGoogle({ email: "ben@t.local", verified: true, sub });

    expect(callback.headers.get("location")).toBe(REFUSED);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("a linked account deactivated since", async () => {
    await signInWithGoogle({ email: "alice@t.local", verified: true });
    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]);
    const { callback } = await signInWithGoogle({ email: "alice@t.local", verified: true });
    expect(callback.headers.get("location")).toBe(REFUSED);
  });
});

describe("a callback that goes wrong", () => {
  it("comes back to sign-in with Auth.js's error type, never a stack trace", async () => {
    // The member pressed Cancel on Google's page.
    const response = await handlers.GET(
      new NextRequest(`${ORIGIN}/api/auth/callback/google?error=access_denied`),
    );
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect([...location.searchParams.keys()]).toEqual(["error"]);
    expect(await response.text()).not.toMatch(/at .*\.js/);
  });
});
