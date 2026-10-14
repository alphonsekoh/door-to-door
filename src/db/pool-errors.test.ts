import { EventEmitter } from "node:events";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { attachPoolErrorHandler } from "@/db/pool-errors";

const URL = "postgresql://app:hunter2@db.internal:5432/prod";

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
    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("Connection terminated unexpectedly");
  });

  it("keeps credentials and connection strings out of the log", () => {
    const { pool, log } = setup();
    const error = Object.assign(new Error(`failed for ${URL} today`), { code: "ECONNREFUSED" });
    pool.emit("error", error);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain("ECONNREFUSED");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("postgresql://");
  });

  it("describes a non-Error value without throwing", () => {
    const { pool, log } = setup();
    pool.emit("error", "boom");
    expect(log.mock.calls[0]?.[0]).toContain("unknown error");
  });

  it("logs a burst once, then reports how many were suppressed", () => {
    let t = 0;
    const { pool, log } = setup(() => t);
    for (let i = 0; i < 39; i += 1) pool.emit("error", new Error("gone"));
    expect(log).toHaveBeenCalledTimes(1);

    t = 10_000;
    pool.emit("error", new Error("gone"));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).toContain("38 similar suppressed");
  });

  it("covers a checked-out client too, so its error is not uncaught", () => {
    const { pool, log } = setup();
    const client = new EventEmitter();
    pool.emit("connect", client);
    expect(() => client.emit("error", new Error("client died"))).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("defaults to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pool = new Pool({ connectionString: URL });
    attachPoolErrorHandler(pool);
    pool.emit("error", new Error("x"));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
