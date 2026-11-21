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
 * Nothing here reaches Google. Since #249 a first sign-in asks to join.
 */

const ISSUER = "https://fake-google.test";
const fake = createFakeGoogle(ISSUER);
/* As the owner's config.yaml has it: tjc.sg and tjc.org are on Google Workspace. */
const DOMAINS = ["gmail.com", "tjc.sg", "tjc.org"];

vi.mock("@/server/config", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerConfig>();
  return {
    ...actual,
    getConfig: () => {
      const config = actual.getConfig();
      return {
        ...config,
        auth: {
          ...config.auth,
          google: { clientId: FAKE_GOOGLE_CLIENT_ID, issuer: ISSUER, domains: DOMAINS },
        },
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
const CAROL = "6006e000-0000-4000-8000-000000000004";
const DAVE = "6006e000-0000-4000-8000-000000000005";

/* Ben's Workspace account, as Google sends it. */
const BEN_AT_WORK = { email: "ben@tjc.sg", verified: true, hd: "tjc.sg" };

beforeEach(async () => {
  await truncateAll(pool);
  /*
   * Alice is Google-only, at gmail.com; Ben, at tjc.sg, also has a password;
   * Gone is deactivated. Carol is at tjc.org, a secondary domain of tjc.sg's
   * Workspace. Dave is at a domain not listed, so he has a password.
   */
  await pool.query(
    `INSERT INTO users (id, email, name, role, password_hash, deactivated_at) VALUES
      ($1,'alice@gmail.com','Alice','member',NULL,NULL),
      ($2,'ben@tjc.sg','Ben','member','not-a-real-hash',NULL),
      ($3,'gone@gmail.com','Gone','member',NULL,now()),
      ($4,'carol@tjc.org','Carol','member',NULL,NULL),
      ($5,'dave@example.org','Dave','member','not-a-real-hash',NULL)`,
    [ALICE, BEN, GONE, CAROL, DAVE],
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
/* Auth.js's newUser page, with where the sign-in was going. */
const WAITING = `/waiting?${new URLSearchParams({ callbackUrl: `${ORIGIN}/` }).toString()}`;

const userAt = async (email: string) =>
  (
    await pool.query<{
      id: string;
      name: string | null;
      image: string | null;
      password_hash: string | null;
      role: string;
      approval: string;
    }>(`SELECT id, name, image, password_hash, role, approval FROM users WHERE email = $1`, [email])
  ).rows;

describe("leaving for Google", () => {
  it("asks Google for its account chooser every time, at the configured issuer", async () => {
    const { authorize } = await signInWithGoogle({ email: "alice@gmail.com", verified: true });
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(authorize.searchParams.get("prompt")).toBe("select_account");
    expect(authorize.searchParams.get("client_id")).toBe(FAKE_GOOGLE_CLIENT_ID);
  });
});

describe("an address an admin added, verified by Google", () => {
  it("links to that account and signs in, keeping no Google token and changing nothing on it", async () => {
    const { callback, jar } = await signInWithGoogle({ email: "alice@gmail.com", verified: true });

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
    expect(users).toEqual([{ name: "Alice", email: "alice@gmail.com", image: null }]);
    const { rows: signIns } = await pool.query(`SELECT user_id, user_agent FROM sign_ins`);
    expect(signIns).toEqual([{ user_id: ALICE, user_agent: PIXEL }]);
  });

  it("uses the same link the next time, with a sign-in of its own", async () => {
    await signInWithGoogle({ email: "alice@gmail.com", verified: true });
    const second = await signInWithGoogle({ email: "Alice@Gmail.com", verified: true });

    expect(await signedInAs(second.jar)).toBe(ALICE);
    expect(await counts()).toEqual({ users: 5, accounts: 1, sign_ins: 2 });
  });

  it("links to the address's own account, never to the one whose cookie is on the phone", async () => {
    // Alice is signed in on a shared phone; Ben picks it up and signs in with Google.
    const alice = await signInWithGoogle({ email: "alice@gmail.com", verified: true });
    const ben = await signInWithGoogle(BEN_AT_WORK, alice.jar);

    expect(await signedInAs(ben.jar)).toBe(BEN);
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM accounts ORDER BY user_id`,
    );
    expect(rows.map((row) => row.user_id)).toEqual([ALICE, BEN]);
  });
});

/* #249: anyone Google vouches for may ask to join. */
describe("a first sign-in at an address nobody added", () => {
  it("asks to join: an account waiting for approval, named by Google, signed in and sent to wait", async () => {
    const { callback, jar } = await signInWithGoogle({ email: "Pat@Gmail.com", verified: true });

    expect(callback.headers.get("location")).toBe(WAITING);
    const [pat] = await userAt("pat@gmail.com");
    expect(pat).toMatchObject({
      name: "Name From Google",
      image: null,
      password_hash: null,
      role: "member",
      approval: "pending",
    });
    expect(await signedInAs(jar)).toBe(pat?.id);

    const { rows: linked } = await pool.query(
      `SELECT user_id, provider, access_token, refresh_token, id_token FROM accounts`,
    );
    expect(linked).toEqual([
      {
        user_id: pat?.id,
        provider: "google",
        access_token: null,
        refresh_token: null,
        id_token: null,
      },
    ]);
    const { rows: signIns } = await pool.query(`SELECT user_id, user_agent FROM sign_ins`);
    expect(signIns).toEqual([{ user_id: pat?.id, user_agent: PIXEL }]);
  });

  it("asks once: the next sign-in is the same account, going where it was going", async () => {
    await signInWithGoogle({ email: "pat@gmail.com", verified: true });
    const before = await counts();
    const second = await signInWithGoogle({
      email: "pat@gmail.com",
      verified: true,
      name: "Other",
    });

    expect(second.callback.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(await counts()).toEqual({ ...before, sign_ins: (before?.sign_ins ?? 0) + 1 });
    // No later sign-in renames anyone.
    expect((await userAt("pat@gmail.com"))[0]?.name).toBe("Name From Google");
  });

  it.each<[string, string | null]>([
    ["no name at all", null],
    ["a name that is only spaces", "   "],
    ["a name past 80 characters", "x".repeat(81)],
  ])("names nobody when Google gives %s", async (_case, name) => {
    await signInWithGoogle({ email: "pat@gmail.com", verified: true, name });
    expect((await userAt("pat@gmail.com"))[0]?.name).toBeNull();
  });

  it("at a Workspace domain, as Google vouches for it", async () => {
    const { callback } = await signInWithGoogle({
      email: "newbie@tjc.org",
      verified: true,
      hd: "tjc.sg",
    });
    expect(callback.headers.get("location")).toBe(WAITING);
    expect((await userAt("newbie@tjc.org"))[0]?.approval).toBe("pending");
  });

  it("is asked for the person signing in, never linked to the one whose cookie is on the phone", async () => {
    // Alice is signed in on a shared phone; Pat picks it up and signs in with Google.
    const alice = await signInWithGoogle({ email: "alice@gmail.com", verified: true });
    const pat = await signInWithGoogle({ email: "pat@gmail.com", verified: true }, alice.jar);

    const [created] = await userAt("pat@gmail.com");
    expect(await signedInAs(pat.jar)).toBe(created?.id);
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT a.user_id FROM accounts a JOIN users u ON u.id = a.user_id ORDER BY u.email`,
    );
    expect(rows.map((row) => row.user_id)).toEqual([ALICE, created?.id]);
  });
});

describe("an account nobody has approved, signing in again", () => {
  it.each(["pending", "blocked"])(
    "signs in as %s, to see where it stands, making nothing",
    async (approval) => {
      await signInWithGoogle({ email: "pat@gmail.com", verified: true });
      await pool.query(`UPDATE users SET approval = $1 WHERE email = 'pat@gmail.com'`, [approval]);
      const before = await counts();

      const { callback, jar } = await signInWithGoogle({ email: "pat@gmail.com", verified: true });
      expect(callback.headers.get("location")).toBe(`${ORIGIN}/`);
      expect(await signedInAs(jar)).toBe((await userAt("pat@gmail.com"))[0]?.id);
      expect(await counts()).toMatchObject({ users: before?.users, accounts: before?.accounts });
    },
  );
});

describe("refused, with one message for every reason, and nothing created", () => {
  it.each<[string, FakeGoogleAccount]>([
    ["an address Google has not verified", { email: "alice@gmail.com", verified: false }],
    ["a new address Google has not verified", { email: "pat@gmail.com", verified: false }],
    [
      "a deactivated account, which is never put back in the queue",
      { email: "gone@gmail.com", verified: true },
    ],
    [
      "a consumer Google account on a listed domain, with no account",
      { email: "pat@tjc.sg", verified: true },
    ],
  ])("%s", async (_name, account) => {
    const before = await counts();
    const { callback, jar } = await signInWithGoogle(account);

    expect(callback.headers.get("location")).toBe(REFUSED);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it("a Google account linked to someone whose address it no longer carries", async () => {
    const sub = "google-account-of-alice";
    await signInWithGoogle({ email: "alice@gmail.com", verified: true, sub });
    // The same Google account, now carrying Ben's address.
    const { callback, jar } = await signInWithGoogle({ ...BEN_AT_WORK, sub });

    expect(callback.headers.get("location")).toBe(REFUSED);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("a linked account deactivated since", async () => {
    await signInWithGoogle({ email: "alice@gmail.com", verified: true });
    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ALICE]);
    const { callback } = await signInWithGoogle({ email: "alice@gmail.com", verified: true });
    expect(callback.headers.get("location")).toBe(REFUSED);
  });
});

/* The owner's ruling of 2026-11-12; the why is in googleVouchesFor. */
describe("only where Google vouches for the address", () => {
  it.each<[string, FakeGoogleAccount, string]>([
    ["a gmail.com address, with no hd", { email: "alice@gmail.com", verified: true }, ALICE],
    ["a listed Workspace domain whose hd is its own", BEN_AT_WORK, BEN],
    [
      "a listed domain whose hd is another listed domain, its Workspace's primary",
      { email: "carol@tjc.org", verified: true, hd: "tjc.sg" },
      CAROL,
    ],
  ])("accepts %s", async (_name, account, id) => {
    const { callback, jar } = await signInWithGoogle(account);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(await signedInAs(jar)).toBe(id);
  });

  it.each<[string, FakeGoogleAccount]>([
    [
      "a listed domain with no hd: a consumer Google account made on that address",
      { email: "ben@tjc.sg", verified: true },
    ],
    ["an hd that is not listed", { email: "ben@tjc.sg", verified: true, hd: "elsewhere.example" }],
    [
      "an unlisted domain, even with an hd of its own",
      { email: "dave@example.org", verified: true, hd: "example.org" },
    ],
    ["an hd that is not a string", { email: "ben@tjc.sg", verified: true, hd: ["tjc.sg"] }],
  ])("refuses %s, linking nothing", async (_name, account) => {
    const before = await counts();
    const { callback, jar } = await signInWithGoogle(account);

    expect(callback.headers.get("location")).toBe(REFUSED);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it("refuses a consumer account on a listed domain even once its Workspace account is linked", async () => {
    await signInWithGoogle({ ...BEN_AT_WORK, sub: "ben-at-work" });
    // A different Google account, with no hd, that also claims Ben's address.
    const { callback } = await signInWithGoogle({
      email: "ben@tjc.sg",
      verified: true,
      sub: "ben-consumer",
    });
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
