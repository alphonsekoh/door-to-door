import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET } = await import("./route");

const pool = createTestPool();
const USER_ID = "cccccccc-0000-4000-8000-000000000001";

const request = () => new Request("https://test.local/api/users/me");

const signedInAs = (overrides: Record<string, unknown> = {}) => {
  auth.mockResolvedValue({
    user: { id: USER_ID, role: "member", deactivated: false, ...overrides },
  });
};

async function seedUser(role: "admin" | "member" = "member"): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, name, role, password_hash)
     VALUES ($1, 'me@test.local', 'Me', $2, 'argon2-hash-that-must-never-be-returned')`,
    [USER_ID, role],
  );
}

beforeEach(async () => {
  await truncateAll(pool);
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("GET /api/users/me", () => {
  it("returns the signed-in user", async () => {
    await seedUser("admin");
    signedInAs({ role: "admin" });

    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { email: string; role: string };
    expect(body).toMatchObject({ email: "me@test.local", role: "admin" });
  });

  it("never returns the password hash", async () => {
    // withContract strips undocumented fields, but the handler must not
    // select it in the first place.
    await seedUser();
    signedInAs();

    const response = await GET(request());
    expect(await response.text()).not.toMatch(/argon2|password/i);
  });

  it("returns 401 when there is no session", async () => {
    auth.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });

  it("returns 403 for an account deactivated after sign-in", async () => {
    /*
     * The JWT is still valid, so only a per-request check catches this. It is
     * the case #10's contract added after the spec review.
     */
    await seedUser();
    await pool.query("update users set deactivated_at = now() where id = $1", [USER_ID]);
    signedInAs();

    const response = await GET(request());
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("account_deactivated");
  });

  it("returns 401 when the token names a user that no longer exists", async () => {
    signedInAs();
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("serialises timestamps as ISO strings, as the contract requires", async () => {
    await seedUser();
    signedInAs();

    const body = (await (await GET(request())).json()) as {
      createdAt: string;
      deactivatedAt: string | null;
    };
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.deactivatedAt).toBeNull();
  });
});
