import { EventEmitter } from "node:events";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/db/client";
import { attachPoolErrorHandler } from "@/db/pool-errors";
import { createTestPool } from "@/db/testing";
import { requireTestDatabaseUrl } from "@/db/test-env";
import { withContract } from "@/server/http/contract";
import { z } from "zod";

const controller = createTestPool();
const { pool: appPool } = createDatabase(requireTestDatabaseUrl());

const uncaught: unknown[] = [];
const record = (error: unknown) => uncaught.push(error);
const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

beforeEach(() => {
  uncaught.length = 0;
  process.on("uncaughtException", record);
  process.on("unhandledRejection", record);
  logged.mockClear();
});

afterEach(() => {
  process.off("uncaughtException", record);
  process.off("unhandledRejection", record);
});

afterAll(async () => {
  logged.mockRestore();
  await appPool.end();
  await controller.end();
});

async function killBackendsOf(target: Pool): Promise<void> {
  const name = `pool-errors-${String(Date.now())}`;
  const client = await target.connect();
  await client.query(`SET application_name = '${name}'`);
  client.release();
  await controller.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1`,
    [name],
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

describe("a database that drops connections", () => {
  it("never raises an uncaught exception, counts each dead backend once, and recovers", async () => {
    let t = 0;
    const log = vi.fn();
    const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 3 });
    attachPoolErrorHandler(pool, log, () => t);
    try {
      const idle = await Promise.all(Array.from({ length: 3 }, () => pool.connect()));
      for (const c of idle) await c.query(`SET application_name = 'pool-errors-idle'`);
      for (const c of idle) c.release();
      await controller.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'pool-errors-idle'`,
      );
      await settle();

      expect(log).toHaveBeenCalledTimes(1);
      const result = await pool.query("SELECT 1 AS ok");
      expect(result.rows).toEqual([{ ok: 1 }]);
      expect(uncaught).toEqual([]);

      // The next line carries the burst's count: three backends, not every echo of them.
      t = 60_000;
      pool.emit("error", new Error("probe"), new EventEmitter());
      expect(log).toHaveBeenLastCalledWith(expect.stringContaining("(2 similar suppressed since"));
    } finally {
      await pool.end();
    }
  });

  it("surfaces a dead checked-out connection as a 500, not a crash", async () => {
    const route = withContract(
      { operationId: "dead", responses: { 200: z.object({ ok: z.boolean() }) } },
      async () => {
        const client = await appPool.connect();
        try {
          await client.query(`SET application_name = 'pool-errors-active'`);
          await controller.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'pool-errors-active'`,
          );
          await settle();
          await client.query("SELECT 1");
          return { status: 200, body: { ok: true } };
        } finally {
          client.release(true);
        }
      },
    );

    const response = await route(new Request("http://localhost/dead"));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "internal_error" } });
    expect(uncaught).toEqual([]);

    const next = await appPool.query("SELECT 1 AS ok");
    expect(next.rows).toEqual([{ ok: 1 }]);
  });

  it("survives a terminate loop", async () => {
    for (let i = 0; i < 5; i += 1) {
      await killBackendsOf(appPool).catch(() => undefined);
      await appPool.query("SELECT 1").catch(() => undefined);
    }
    await settle();
    const ok = await appPool.query("SELECT 1 AS ok");
    expect(ok.rows).toEqual([{ ok: 1 }]);
    expect(uncaught).toEqual([]);
  });
});
