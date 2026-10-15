import { describe, expect, it } from "vitest";
import type { VisitSyncResult } from "@/generated/types.gen";
import { MAX_ATTEMPTS, PROBE_MS, RATE_LIMIT_MS } from "@/lib/sync/backoff";
import {
  type EngineState,
  INITIAL_STATE,
  applyBatchFailure,
  applyResult,
  canRetry,
  clearForRetry,
  failAttempt,
  isBlocked,
  isDue,
  retryRecord,
} from "@/lib/sync/classify";
import type { QueuedVisit } from "@/lib/sync/types";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const half = () => 0.5;

function record(overrides: Partial<QueuedVisit> = {}): QueuedVisit {
  return {
    id: "0190a000-0000-7000-8000-000000000001",
    ownerId: "owner",
    item: {
      id: "0190a000-0000-7000-8000-000000000001",
      blockId: "b",
      unitNumber: "#05-01",
      interestLevel: "high",
      description: "",
      clientCreatedAt: "2026-10-15T09:00:00.000Z",
      updatedAt: "2026-10-15T09:00:00.000Z",
    },
    state: "queued",
    attempts: 0,
    skewCount: 0,
    nextAttemptAt: NOW,
    lastError: null,
    enqueuedAt: NOW,
    syncedAt: null,
    serverVisit: null,
    ...overrides,
  };
}

const rejected = (code: string): VisitSyncResult => ({
  id: record().id,
  status: "rejected",
  visit: null,
  error: { error: { code: code as "conflict", message: "Server words never shown." } },
});

describe("applyResult", () => {
  it.each(["applied", "unchanged", "stale"] as const)("marks %s as sent", (status) => {
    const visit = {
      id: record().id,
      householdId: "0190a000-0000-7000-8000-0000000000aa",
      sessionId: "0190a000-0000-7000-8000-0000000000bb",
      member: { id: "owner", name: "Ann" },
      team: null,
      interestLevel: "high" as const,
      description: "",
      clientCreatedAt: "2026-10-15T09:00:00.000Z",
      createdAt: "2026-10-15T09:00:00.000Z",
      updatedAt: "2026-10-15T09:00:00.000Z",
    };
    const next = applyResult(
      record({ state: "failed", lastError: { code: "internal_error" } }),
      { id: record().id, status, visit },
      NOW,
      half,
    );
    expect(next).toMatchObject({
      state: "synced",
      syncedAt: NOW,
      serverVisit: visit,
      nextAttemptAt: null,
      lastError: null,
    });
  });

  it("keeps a sent record without the server's row when none came back", () => {
    const next = applyResult(record(), { id: record().id, status: "unchanged" }, NOW, half);
    expect(next.state).toBe("synced");
    expect(next.serverVisit).toBeNull();
  });

  it("retries an internal error with backoff and counts it", () => {
    const next = applyResult(record(), rejected("internal_error"), NOW, half);
    expect(next).toMatchObject({
      state: "failed",
      attempts: 1,
      lastError: { code: "internal_error" },
    });
    expect(next.nextAttemptAt).toBe(NOW + 2_500);
  });

  it("stops a record on its eighth internal error, leaving retry to a tap", () => {
    let current = record();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      current = applyResult(current, rejected("internal_error"), NOW, half);
      expect(current.state).toBe("failed");
    }
    current = applyResult(current, rejected("internal_error"), NOW, half);
    expect(current).toMatchObject({ state: "quarantined", attempts: 8, nextAttemptAt: null });
  });

  it("restamps both times on clock skew, without counting an attempt", () => {
    const next = applyResult(record({ attempts: 3 }), rejected("clock_skew"), NOW, half);
    expect(next.item.clientCreatedAt).toBe(new Date(NOW).toISOString());
    expect(next.item.updatedAt).toBe(new Date(NOW).toISOString());
    expect(next).toMatchObject({ state: "queued", attempts: 3, skewCount: 1, nextAttemptAt: NOW });
  });

  it("waits five minutes after the second clock skew", () => {
    const once = applyResult(record(), rejected("clock_skew"), NOW, half);
    const twice = applyResult(once, rejected("clock_skew"), NOW, half);
    expect(twice).toMatchObject({ skewCount: 2, nextAttemptAt: NOW + PROBE_MS, attempts: 0 });
  });

  it("holds a conflict for a tap, never retrying it by itself", () => {
    const next = applyResult(record(), rejected("conflict"), NOW, half);
    expect(next).toMatchObject({
      state: "held",
      nextAttemptAt: null,
      lastError: { code: "conflict" },
    });
  });

  it("holds an ended outing and looks again in five minutes", () => {
    const next = applyResult(record(), rejected("session_not_active"), NOW, half);
    expect(next).toMatchObject({ state: "held", nextAttemptAt: NOW + PROBE_MS });
  });

  it.each(["not_found", "validation_failed"])("holds %s for a tap", (code) => {
    expect(applyResult(record(), rejected(code), NOW, half)).toMatchObject({
      state: "held",
      nextAttemptAt: null,
      lastError: { code },
    });
  });

  it("holds a rejection that names no error", () => {
    const next = applyResult(record(), { id: record().id, status: "rejected" }, NOW, half);
    expect(next).toMatchObject({ state: "held", lastError: { code: "unknown" } });
  });

  it("counts a record the response left out as failed", () => {
    const next = applyResult(record(), undefined, NOW, half);
    expect(next).toMatchObject({
      state: "failed",
      attempts: 1,
      lastError: { code: "missing_result" },
    });
  });
});

describe("failAttempt", () => {
  it("uses the jittered backoff for the attempt it has reached", () => {
    expect(failAttempt(record({ attempts: 2 }), "x", NOW, () => 1).nextAttemptAt).toBe(
      NOW + 20_000,
    );
  });
});

describe("applyBatchFailure", () => {
  const batch = [record(), record({ id: "second" })];

  it("waits out a lost connection without touching any record", () => {
    const result = applyBatchFailure(INITIAL_STATE, { kind: "network" }, batch, NOW, half);
    expect(result.records).toEqual([]);
    expect(result.state).toMatchObject({
      streak: 1,
      block: { reason: "offline", until: NOW + 2_500 },
    });
  });

  it("never charges a lost connection to a record, even one at a time", () => {
    const isolated = { ...INITIAL_STATE, isolation: true };
    const result = applyBatchFailure(isolated, { kind: "network" }, [record()], NOW, half);
    expect(result.records).toEqual([]);
  });

  it("waits a minute after being rate limited", () => {
    const result = applyBatchFailure(
      INITIAL_STATE,
      { kind: "http", status: 429, code: "rate_limited" },
      batch,
      NOW,
      half,
    );
    expect(result.state.block).toEqual({ reason: "rate_limited", until: NOW + RATE_LIMIT_MS });
  });

  it("stops for good on a 401 until the page loads again", () => {
    const result = applyBatchFailure(
      INITIAL_STATE,
      { kind: "http", status: 401, code: "unauthenticated" },
      batch,
      NOW,
      half,
    );
    expect(result.state.block).toEqual({ reason: "signed_out", until: null });
    expect(result.records).toEqual([]);
  });

  it("holds everything for a deactivated account and looks again in five minutes", () => {
    const result = applyBatchFailure(
      INITIAL_STATE,
      { kind: "http", status: 403, code: "account_deactivated" },
      batch,
      NOW,
      half,
    );
    expect(result.state.block).toEqual({ reason: "deactivated", until: NOW + PROBE_MS });
    expect(result.records).toEqual([]);
  });

  it("holds everything for a wrong phone clock and looks again in five minutes", () => {
    const result = applyBatchFailure(
      INITIAL_STATE,
      { kind: "http", status: 422, code: "clock_skew" },
      batch,
      NOW,
      half,
    );
    expect(result.state.block).toEqual({ reason: "clock", until: NOW + PROBE_MS });
  });

  it("goes one at a time after a refused batch", () => {
    const result = applyBatchFailure(
      INITIAL_STATE,
      { kind: "http", status: 400, code: "validation_failed" },
      batch,
      NOW,
      half,
    );
    expect(result.state).toMatchObject({ isolation: true, block: null });
    expect(result.records).toEqual([]);
  });

  it("stops a record the contract refuses on its own", () => {
    const result = applyBatchFailure(
      { ...INITIAL_STATE, isolation: true },
      { kind: "http", status: 400, code: "validation_failed" },
      [record()],
      NOW,
      half,
    );
    expect(result.records).toEqual([
      expect.objectContaining({
        state: "quarantined",
        lastError: { code: "invalid" },
        nextAttemptAt: null,
      }),
    ]);
  });

  it.each([
    ["a 500", { kind: "http", status: 500, code: "internal_error" }],
    ["a 403 that is not about the account", { kind: "http", status: 403, code: "forbidden" }],
    ["a 422 that is not about the clock", { kind: "http", status: 422, code: "validation_failed" }],
    ["an unreadable 200", { kind: "invalid" }],
  ] as const)("backs off after %s without charging records in a batch", (_, outcome) => {
    const result = applyBatchFailure(INITIAL_STATE, outcome, batch, NOW, half);
    expect(result.records).toEqual([]);
    expect(result.state).toMatchObject({
      streak: 1,
      serverStreak: 1,
      isolation: false,
      block: { reason: "server", until: NOW + 2_500 },
    });
  });

  it("goes one at a time after three server failures in a row", () => {
    let state: EngineState = INITIAL_STATE;
    for (let i = 0; i < 3; i += 1) {
      state = applyBatchFailure(state, { kind: "invalid" }, batch, NOW, half).state;
    }
    expect(state.isolation).toBe(true);
  });

  it("charges a server failure to the one record sent alone", () => {
    const result = applyBatchFailure(
      { ...INITIAL_STATE, isolation: true },
      { kind: "http", status: 502, code: "internal_error" },
      [record()],
      NOW,
      half,
    );
    expect(result.records).toEqual([
      expect.objectContaining({
        state: "failed",
        attempts: 1,
        lastError: { code: "server_error" },
      }),
    ]);
  });
});

describe("isBlocked and isDue", () => {
  it("is blocked only until the wait ends, or for good with no end", () => {
    expect(isBlocked(INITIAL_STATE, NOW)).toBe(false);
    const until = { ...INITIAL_STATE, block: { reason: "server" as const, until: NOW + 1 } };
    expect(isBlocked(until, NOW)).toBe(true);
    expect(isBlocked(until, NOW + 1)).toBe(false);
    expect(
      isBlocked({ ...INITIAL_STATE, block: { reason: "signed_out", until: null } }, NOW + 1e9),
    ).toBe(true);
  });

  it("is due once its time comes, unless it is sent, stopped or waiting for a tap", () => {
    expect(isDue(record({ nextAttemptAt: NOW }), NOW)).toBe(true);
    expect(isDue(record({ nextAttemptAt: NOW + 1 }), NOW)).toBe(false);
    expect(isDue(record({ state: "failed", nextAttemptAt: NOW }), NOW)).toBe(true);
    expect(isDue(record({ state: "held", nextAttemptAt: NOW }), NOW)).toBe(true);
    expect(isDue(record({ state: "held", nextAttemptAt: null }), NOW)).toBe(false);
    expect(isDue(record({ state: "quarantined", nextAttemptAt: NOW }), NOW)).toBe(false);
    expect(isDue(record({ state: "synced", nextAttemptAt: NOW }), NOW)).toBe(false);
  });
});

describe("retry", () => {
  it("starts a record afresh, due now", () => {
    const stopped = record({
      state: "quarantined",
      attempts: 8,
      skewCount: 3,
      nextAttemptAt: null,
      lastError: { code: "internal_error" },
    });
    expect(retryRecord(stopped, NOW)).toMatchObject({
      state: "queued",
      attempts: 0,
      skewCount: 0,
      nextAttemptAt: NOW,
      lastError: null,
    });
  });

  it("offers retry on anything unsent except a record that could not be read", () => {
    expect(canRetry(record({ state: "held" }))).toBe(true);
    expect(canRetry(record({ state: "quarantined" }))).toBe(true);
    expect(canRetry(record({ state: "synced" }))).toBe(false);
    expect(canRetry(record({ state: "quarantined", lastError: { code: "corrupt" } }))).toBe(false);
  });

  it("ends isolation and the queue's own waits", () => {
    for (const reason of ["offline", "server", "deactivated", "clock"] as const) {
      const state: EngineState = {
        block: { reason, until: NOW + PROBE_MS },
        streak: 4,
        serverStreak: 4,
        isolation: true,
      };
      expect(clearForRetry(state, NOW)).toEqual(INITIAL_STATE);
    }
  });

  it("keeps the server's rate-limit wait while it lasts, and a sign-out for good", () => {
    const limited: EngineState = {
      ...INITIAL_STATE,
      block: { reason: "rate_limited", until: NOW + 10 },
    };
    expect(clearForRetry(limited, NOW).block).toEqual(limited.block);
    expect(clearForRetry(limited, NOW + 10).block).toBeNull();
    const out: EngineState = { ...INITIAL_STATE, block: { reason: "signed_out", until: null } };
    expect(clearForRetry(out, NOW).block).toEqual(out.block);
  });
});
