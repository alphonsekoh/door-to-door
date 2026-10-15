import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisitSyncItem } from "@/generated/types.gen";

const item: VisitSyncItem = {
  id: "0190a000-0000-7000-8000-000000000001",
  blockId: "0190a000-0000-7000-8000-0000000000bb",
  unitNumber: "#05-01",
  interestLevel: "high",
  description: "",
  clientCreatedAt: "2026-10-15T09:00:00.000Z",
  updatedAt: "2026-10-15T09:00:00.000Z",
};

function respond(status: number, body: () => Promise<unknown>) {
  const fetch = vi.fn().mockResolvedValue({ ok: status < 400, status, json: body });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/* Fresh modules each time: the account store keeps the first failure it hears. */
async function load() {
  vi.resetModules();
  const { sendBatch } = await import("@/lib/sync/transport");
  const { accountStore } = await import("@/lib/account-state");
  return { sendBatch, accountStore };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendBatch", () => {
  it("posts the items with the phone's clock reading at the moment of sending", async () => {
    const { sendBatch } = await load();
    const fetch = respond(200, () => Promise.resolve({ results: [] }));
    let clock = new Date("2026-10-15T10:00:00.000Z");

    await sendBatch([item], () => clock);
    clock = new Date("2026-10-15T10:05:00.000Z");
    await sendBatch([item], () => clock);

    const bodies = fetch.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string) as unknown,
    );
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/visits/sync");
    expect(bodies).toEqual([
      { sentAt: "2026-10-15T10:00:00.000Z", items: [item] },
      { sentAt: "2026-10-15T10:05:00.000Z", items: [item] },
    ]);
  });

  it("reads the real clock by default", async () => {
    const { sendBatch } = await load();
    const fetch = respond(200, () => Promise.resolve({ results: [] }));
    await sendBatch([item]);
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as {
      sentAt: string;
    };
    expect(Math.abs(Date.parse(body.sentAt) - Date.now())).toBeLessThan(5_000);
  });

  it("returns the per-item results of a well-formed reply", async () => {
    const { sendBatch } = await load();
    const results = [{ id: item.id, status: "applied", visit: null, error: null }];
    respond(200, () => Promise.resolve({ results }));
    expect(await sendBatch([item])).toEqual({ kind: "ok", results });
  });

  it("calls a reply that breaks the contract invalid", async () => {
    const { sendBatch } = await load();
    respond(200, () => Promise.resolve({ results: [{ id: "x", status: "maybe" }] }));
    expect(await sendBatch([item])).toEqual({ kind: "invalid" });
  });

  it("calls a reply that is not JSON at all invalid", async () => {
    const { sendBatch } = await load();
    respond(200, () => Promise.reject(new SyntaxError("Unexpected token <")));
    expect(await sendBatch([item])).toEqual({ kind: "invalid" });
  });

  it("calls a failed fetch a network problem", async () => {
    const { sendBatch } = await load();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await sendBatch([item])).toEqual({ kind: "network" });
  });

  it("reports an HTTP refusal with its status and code", async () => {
    const { sendBatch } = await load();
    respond(422, () => Promise.resolve({ error: { code: "clock_skew", message: "x" } }));
    expect(await sendBatch([item])).toEqual({ kind: "http", status: 422, code: "clock_skew" });
  });

  it("raises the account message on a 401, and the records stay put", async () => {
    const { sendBatch, accountStore } = await load();
    respond(401, () => Promise.resolve({ error: { code: "unauthenticated", message: "x" } }));
    expect(await sendBatch([item])).toMatchObject({ kind: "http", status: 401 });
    expect(accountStore.getSnapshot().failure).toBe("signed-out");
  });

  it("raises the account message for a deactivated account", async () => {
    const { sendBatch, accountStore } = await load();
    respond(403, () => Promise.resolve({ error: { code: "account_deactivated", message: "x" } }));
    expect(await sendBatch([item])).toMatchObject({ kind: "http", status: 403 });
    expect(accountStore.getSnapshot().failure).toBe("deactivated");
  });
});
