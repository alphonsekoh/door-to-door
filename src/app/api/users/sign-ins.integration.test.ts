import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Google from "@/auth/google";
import { getDatabase, resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, testSignInId, truncateAll } from "@/db/testing";
import { SIGN_IN_FAILED_MESSAGE, authorizeCredentials } from "@/server/auth/credentials";
import { createRateLimiter } from "@/server/auth/rate-limit";

/*
 * An admin's view of where a member is signed in, and ending those sign-ins
 * (#125); adding someone with no password (#14).
 */

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const DOMAINS = ["gmail.com", "tjc.sg", "tjc.org"];
const { googleDomains } = vi.hoisted(() => ({
  googleDomains: vi.fn<() => readonly string[] | null>(),
}));
vi.mock("@/auth/google", async (importOriginal) => ({
  ...(await importOriginal<typeof Google>()),
  googleDomains,
}));

const userRoute = await import("./[id]/route");
const signInsRoute = await import("./[id]/sign-ins/route");
const signInRoute = await import("./[id]/sign-ins/[signInId]/route");
const usersRoute = await import("./route");

const pool = createTestPool();
const ADMIN = "5191d000-0000-4000-8000-000000000001";
const ALICE = "5191d000-0000-4000-8000-000000000002";
const BEN = "5191d000-0000-4000-8000-000000000003";
const NOBODY = "5191d000-0000-4000-8000-0000000000ff";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/* Resolved once, as a real token: a sign-in ended here stays ended. */
const asAdmin = async () =>
  auth.mockResolvedValue(await signedInAs(pool, { id: ADMIN, role: "admin" }));
const asAlice = async () =>
  auth.mockResolvedValue(await signedInAs(pool, { id: ALICE, role: "member" }));

const request = (method: string, path: string, body?: unknown) =>
  new Request(`https://test.local/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
const params = <T extends Record<string, string>>(values: T) => ({
  params: Promise.resolve(values),
});

const getUser = (id: string) => userRoute.GET(request("GET", `/users/${id}`), params({ id }));
const list = (id: string) =>
  signInsRoute.GET(request("GET", `/users/${id}/sign-ins`), params({ id }));
const endAll = (id: string) =>
  signInsRoute.DELETE(request("DELETE", `/users/${id}/sign-ins`), params({ id }));
const endOne = (id: string, signInId: string) =>
  signInRoute.DELETE(
    request("DELETE", `/users/${id}/sign-ins/${signInId}`),
    params({ id, signInId }),
  );

type Listed = {
  data: { id: string; device: string; signedInAt: string; lastUsedAt: string; current: boolean }[];
};

async function seed(userId: string, ago: string, userAgent: string | null): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sign_ins (user_id, user_agent, created_at, last_used_at)
     VALUES ($1, $2, now() - $3::interval, now() - $3::interval) RETURNING id`,
    [userId, userAgent, ago],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no sign-in seeded");
  return id;
}

const left = async (userId: string) =>
  (
    await pool.query<{ id: string }>(`SELECT id FROM sign_ins WHERE user_id = $1`, [userId])
  ).rows.map((row) => row.id);

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string } }).error;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role, deactivated_at) VALUES
      ($1,'admin@t.local','Admin','admin',NULL),
      ($2,'alice@t.local','Alice','member',NULL),
      ($3,'ben@t.local','Ben','member',now())`,
    [ADMIN, ALICE, BEN],
  );
  auth.mockReset();
  googleDomains.mockReturnValue(DOMAINS);
  await asAdmin();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("GET /users/{id}", () => {
  it("gives an admin one member, a deactivated one included", async () => {
    const response = await getUser(BEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: BEN, email: "ben@t.local" });
  });

  it("is 404 for nobody, 403 for a member and 400 for a bad id", async () => {
    expect((await getUser(NOBODY)).status).toBe(404);
    expect((await userRoute.GET(request("GET", "/users/x"), params({ id: "x" }))).status).toBe(400);
    await asAlice();
    expect((await getUser(ALICE)).status).toBe(403);
  });
});

describe("GET /users/{id}/sign-ins", () => {
  it("lists a member's live sign-ins, most recently used first, as devices", async () => {
    const phone = await seed(ALICE, "1 minute", PIXEL);
    const older = await seed(ALICE, "3 days", IPHONE);
    await seed(ALICE, "31 days", PIXEL);

    const response = await list(ALICE);
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as Listed;
    expect(data.map(({ id, device, current }) => ({ id, device, current }))).toEqual([
      { id: phone, device: "Chrome on Android", current: false },
      { id: older, device: "Safari on iPhone", current: false },
    ]);
    expect(new Date(data[1]?.signedInAt ?? "").getTime()).toBeLessThan(Date.now() - 86_400_000);
  });

  it("names the admin's own sign-in as current on their own page", async () => {
    const other = await seed(ADMIN, "1 hour", PIXEL);
    const { data } = (await (await list(ADMIN)).json()) as Listed;
    expect(data.map(({ id, current }) => ({ id, current }))).toEqual([
      { id: testSignInId(ADMIN), current: true },
      { id: other, current: false },
    ]);
  });

  it("is 404 for nobody and 403 for a member, their own list included", async () => {
    expect((await list(NOBODY)).status).toBe(404);
    await asAlice();
    expect((await list(ALICE)).status).toBe(403);
  });
});

describe("DELETE /users/{id}/sign-ins/{signInId}", () => {
  it("ends that one; the member's others carry on", async () => {
    const phone = await seed(ALICE, "1 minute", PIXEL);
    const laptop = await seed(ALICE, "1 minute", IPHONE);
    expect((await endOne(ALICE, phone)).status).toBe(204);
    expect(await left(ALICE)).toEqual([laptop]);
  });

  it("is 404 for one already ended, and for another member's", async () => {
    const phone = await seed(ALICE, "1 minute", PIXEL);
    await endOne(ALICE, phone);
    const again = await endOne(ALICE, phone);
    expect(again.status).toBe(404);
    expect((await errorOf(again)).message).toBe("That sign-in has already ended.");

    const admins = await seed(ADMIN, "1 minute", PIXEL);
    expect((await endOne(ALICE, admins)).status).toBe(404);
    expect(await left(ADMIN)).toContain(admins);
  });

  it("is 409 for the admin's own current sign-in, but ends their others", async () => {
    const response = await endOne(ADMIN, testSignInId(ADMIN));
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({
      code: "conflict",
      message: "To sign out of this phone, use Sign out on Account.",
    });
    expect(await left(ADMIN)).toEqual([testSignInId(ADMIN)]);

    const other = await seed(ADMIN, "1 minute", IPHONE);
    expect((await endOne(ADMIN, other)).status).toBe(204);
  });

  it("is 404 for nobody and 403 for a member, before anything is ended", async () => {
    const phone = await seed(ALICE, "1 minute", PIXEL);
    expect((await endOne(NOBODY, phone)).status).toBe(404);
    await asAlice();
    expect((await endOne(ALICE, phone)).status).toBe(403);
    expect(await left(ALICE)).toContain(phone);
  });
});

describe("DELETE /users/{id}/sign-ins", () => {
  it("signs a member out everywhere", async () => {
    await seed(ALICE, "1 minute", PIXEL);
    await seed(ALICE, "1 day", IPHONE);
    const admins = await seed(ADMIN, "1 minute", PIXEL);

    expect((await endAll(ALICE)).status).toBe(204);
    expect(await left(ALICE)).toEqual([]);
    expect(await left(ADMIN)).toContain(admins);
  });

  it("keeps the admin's own current sign-in on their own account", async () => {
    await seed(ADMIN, "1 minute", PIXEL);
    expect((await endAll(ADMIN)).status).toBe(204);
    expect(await left(ADMIN)).toEqual([testSignInId(ADMIN)]);
  });

  it("is 404 for nobody and 403 for a member, before anything is ended", async () => {
    const phone = await seed(ALICE, "1 minute", PIXEL);
    expect((await endAll(NOBODY)).status).toBe(404);
    await asAlice();
    expect((await endAll(ALICE)).status).toBe(403);
    expect(await left(ALICE)).toContain(phone);
  });
});

describe("an ended sign-in asking", () => {
  it("is 401 on every one of these, and a deactivated admin 403", async () => {
    await pool.query(`DELETE FROM sign_ins WHERE user_id = $1`, [ADMIN]);
    for (const call of [
      () => getUser(ALICE),
      () => list(ALICE),
      () => endAll(ALICE),
      () => endOne(ALICE, NOBODY),
    ]) {
      expect((await call()).status).toBe(401);
    }

    await pool.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [ADMIN]);
    expect((await errorOf(await list(ALICE))).code).toBe("account_deactivated");
    expect((await errorOf(await endOne(ALICE, NOBODY))).code).toBe("account_deactivated");
  });
});

describe("POST /users with no password (#14)", () => {
  const post = (body: unknown) => usersRoute.POST(request("POST", "/users", body));

  it("adds someone who signs in with Google only", async () => {
    const response = await post({ email: "New@TJC.sg", name: "New" });
    expect(response.status).toBe(201);
    const { rows } = await pool.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE email = 'new@tjc.sg'`,
    );
    expect(rows).toEqual([{ password_hash: null }]);
  });

  it("is 409 for an address outside the domains Google signs in for, naming them, and adds nobody", async () => {
    // Google would refuse every sign-in to it (owner, 2026-11-12).
    const response = await post({ email: "new@t.local" });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({
      code: "conflict",
      message:
        "Google sign-in works only for addresses at gmail.com, tjc.sg or tjc.org, so they need a password.",
    });
    expect((await pool.query(`SELECT 1 FROM users WHERE email = 'new@t.local'`)).rows).toEqual([]);
  });

  it("takes such an address with a password", async () => {
    expect((await post({ email: "new@t.local", password: "correct-horse-1" })).status).toBe(201);
  });

  it("is 409 while Google sign-in is not set up here, and adds nobody", async () => {
    googleDomains.mockReturnValue(null);
    const response = await post({ email: "new@gmail.com" });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).message).toBe(
      "Google sign-in isn't set up here, so they need a password.",
    );
    expect((await pool.query(`SELECT 1 FROM users WHERE email = 'new@gmail.com'`)).rows).toEqual(
      [],
    );
  });

  it("still takes a password, while Google is not set up too", async () => {
    googleDomains.mockReturnValue(null);
    expect((await post({ email: "new@t.local", password: "correct-horse-1" })).status).toBe(201);
  });

  it("leaves a Google-only account refused by the password form with the message any failure gets", async () => {
    await post({ email: "new@gmail.com" });
    const limiter = () => createRateLimiter({ limit: 100, windowMs: 60_000 });
    await expect(
      authorizeCredentials(
        { email: "new@gmail.com", password: "anything-at-all" },
        { db: getDatabase(), limiter: limiter(), clientLimiter: limiter() },
      ),
    ).rejects.toThrow(SIGN_IN_FAILED_MESSAGE);
  });
});
