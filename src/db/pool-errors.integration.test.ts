import type { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/db/client";
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
  it("never raises an uncaught exception and recovers on the next query", async () => {
    await Promise.all(Array.from({ length: 5 }, () => appPool.query("SELECT 1")));
    // Idle clients die; pg reports it on the pool.
    const idle = await Promise.all(Array.from({ length: 3 }, () => appPool.connect()));
    for (const c of idle) await c.query(`SET application_name = 'pool-errors-idle'`);
    for (const c of idle) c.release();
    await controller.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'pool-errors-idle'`,
    );
    await settle();

    const result = await appPool.query("SELECT 1 AS ok");
    expect(result.rows).toEqual([{ ok: 1 }]);
    expect(uncaught).toEqual([]);
    expect(logged).toHaveBeenCalled();
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
