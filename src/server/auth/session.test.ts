import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { getDatabase } = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock("@/db/client", () => ({ getDatabase }));

const { currentSession, currentUser, resolveSession } = await import("@/server/auth/session");

type Row = {
  email: string;
  name: string | null;
  role: "admin" | "member";
  deactivatedAt: Date | null;
};

function dbReturning(rows: Row[]) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const db = { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) };
  return { db: db as unknown as Database, limit };
}

const row: Row = { email: "a@t.local", name: "A", role: "member", deactivatedAt: null };

describe("resolveSession", () => {
  it("builds the session from the row, ignoring the token's role", async () => {
    const { db } = dbReturning([{ ...row, role: "member" }]);
    const session = await resolveSession(db, {
      user: { id: "u1", role: "admin", deactivated: false },
    });
    expect(session).toEqual({
      user: { id: "u1", email: "a@t.local", name: "A", role: "member", deactivated: false },
    });
  });

  it("marks a deactivated row deactivated even if the token says otherwise", async () => {
    const { db } = dbReturning([{ ...row, deactivatedAt: new Date() }]);
    const session = await resolveSession(db, {
      user: { id: "u1", role: "member", deactivated: false },
    });
    expect(session?.user?.deactivated).toBe(true);
  });

  it("treats a missing row as signed out", async () => {
    const { db } = dbReturning([]);
    expect(await resolveSession(db, { user: { id: "u1", role: "admin" } })).toBeNull();
  });

  it.each([null, {}, { user: {} }, { user: { id: "" } }])(
    "passes %j through without a lookup",
    async (session) => {
      const { db, limit } = dbReturning([row]);
      expect(await resolveSession(db, session)).toEqual(session);
      expect(limit).not.toHaveBeenCalled();
    },
  );

  it("does not fail open when the lookup throws", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.reject(new Error("connection refused")),
          }),
        }),
      }),
    } as unknown as Database;
    await expect(resolveSession(db, { user: { id: "u1", role: "admin" } })).rejects.toThrow(
      "connection refused",
    );
  });

  it("makes one lookup per resolution", async () => {
    const { db, limit } = dbReturning([row]);
    await resolveSession(db, { user: { id: "u1" } });
    expect(limit).toHaveBeenCalledTimes(1);
  });
});

describe("currentSession and currentUser", () => {
  it("resolve the token against the database", async () => {
    getDatabase.mockReturnValue(dbReturning([{ ...row, role: "admin" }]).db);
    auth.mockResolvedValue({ user: { id: "u1", role: "member" } });
    expect((await currentSession())?.user?.role).toBe("admin");
    expect(await currentUser("admin")).toMatchObject({ id: "u1", role: "admin" });
    expect(await currentUser()).toMatchObject({ id: "u1" });
  });

  it("refuses admin to a member and a deactivated account", async () => {
    getDatabase.mockReturnValue(dbReturning([row]).db);
    auth.mockResolvedValue({ user: { id: "u1", role: "admin" } });
    await expect(currentUser("admin")).rejects.toMatchObject({ status: 403 });

    getDatabase.mockReturnValue(dbReturning([{ ...row, deactivatedAt: new Date() }]).db);
    await expect(currentUser()).rejects.toMatchObject({ code: "account_deactivated" });
  });
});
