import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/db/client";
import { requireTestDatabaseUrl } from "@/db/test-env";

/*
 * The app's pool with @vercel/functions' attachDatabasePool left real (#250).
 * Vercel's runtime puts each request's context, waitUntil included, behind
 * this symbol, and names itself in VERCEL_URL and VERCEL_REGION.
 */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
const processWide = globalThis as Record<symbol, unknown>;

const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

beforeEach(() => {
  processWide[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };
  // Only the pool's timers: the query itself goes over a real socket.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  waitUntil.mockReset();
  warn.mockClear();
  processWide[REQUEST_CONTEXT] = undefined;
});

afterAll(() => {
  warn.mockRestore();
});

describe("the app's pool on Vercel", () => {
  it("holds the instance until its idle connection has closed, and no longer", async () => {
    vi.stubEnv("VERCEL_URL", "door-to-door.example.vercel.app");
    vi.stubEnv("VERCEL_REGION", "sin1");
    const { pool, db } = createDatabase(requireTestDatabaseUrl());
    try {
      await db.execute(sql`select 1`);

      expect(waitUntil).toHaveBeenCalledOnce();
      let held = true;
      void waitUntil.mock.calls[0]?.[0].then(() => {
        held = false;
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(pool.totalCount).toBe(1);
      expect(held).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      expect(pool.totalCount).toBe(0);
      expect(held).toBe(true);

      await vi.advanceTimersByTimeAsync(100);
      expect(held).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      await pool.end();
    }
  });
});

describe("the app's pool anywhere else", () => {
  it("queries as before and holds nothing open, even inside a request context", async () => {
    vi.stubEnv("VERCEL_URL", undefined);
    vi.stubEnv("VERCEL_REGION", undefined);
    const { pool, db } = createDatabase(requireTestDatabaseUrl());
    try {
      const { rows } = await db.execute<{ ok: number }>(sql`select 1 as ok`);
      expect(rows).toEqual([{ ok: 1 }]);
      await db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
      });

      expect(waitUntil).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      // The idle connection still closes on the pool's own clock.
      expect(pool.totalCount).toBe(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(pool.totalCount).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
