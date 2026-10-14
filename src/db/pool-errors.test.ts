import { EventEmitter } from "node:events";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { attachPoolErrorHandler } from "@/db/pool-errors";

const URL = "postgresql://app:hunter2@db.internal:5432/prod";

/* Stands in for a pooled client: all the handler uses is its identity and `on`. */
const fakeClient = () => new EventEmitter() as unknown as PoolClient;

function setup(now = () => 0) {
  const pool = new Pool({ connectionString: URL });
  const log = vi.fn();
  attachPoolErrorHandler(pool, log, now);
  return { pool, log };
}

describe("attachPoolErrorHandler", () => {
  it("attaches one error listener per pool", () => {
    const { pool } = setup();
    expect(pool.listenerCount("error")).toBe(1);
  });

  it("does not throw on a pool error, and logs it", () => {
    const { pool, log } = setup();
    expect(() =>
      pool.emit("error", new Error("Connection terminated unexpectedly"), fakeClient()),
    ).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("Connection terminated unexpectedly");
  });

  it("keeps credentials, connection strings and host:port out of the log", () => {
    const { pool, log } = setup();
    const error = Object.assign(new Error(`failed for ${URL} via db.internal:5432`), {
      code: "ECONNREFUSED",
    });
    pool.emit("error", error, fakeClient());
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain("ECONNREFUSED");
    expect(line).not.toMatch(/hunter2|postgresql:\/\/|db\.internal|5432/);
  });

  it("logs a burst of dead clients once, then reports how many were suppressed", () => {
    let t = 0;
    const { pool, log } = setup(() => t);
    for (let i = 0; i < 39; i += 1) pool.emit("error", new Error("gone"), fakeClient());
    expect(log).toHaveBeenCalledTimes(1);

    t = 10_000;
    pool.emit("error", new Error("gone"), fakeClient());
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).toContain("38 similar suppressed since");
  });

  it("counts one dead backend once, however many times pg reports it", () => {
    let t = 0;
    const { pool, log } = setup(() => t);
    const client = fakeClient();
    pool.emit("connect", client);
    const killed = new Error("terminating connection due to administrator command");
    client.emit("error", killed);
    pool.emit("error", killed, client);
    client.emit("error", new Error("Connection terminated unexpectedly"));

    t = 10_000;
    pool.emit("error", new Error("next outage"), fakeClient());
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).not.toContain("suppressed");
  });

  it("covers a checked-out client too, so its error is not uncaught", () => {
    const { pool, log } = setup();
    const client = fakeClient();
    pool.emit("connect", client);
    expect(() => client.emit("error", new Error("client died"))).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("defaults to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pool = new Pool({ connectionString: URL });
    attachPoolErrorHandler(pool);
    pool.emit("error", new Error("x"), fakeClient());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
