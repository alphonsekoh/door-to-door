import { afterEach, describe, expect, it, vi } from "vitest";
import type { VisitSyncItem } from "@/generated/types.gen";
import { fetchSignedIn, sendAs } from "@/lib/sync/signed-in";
import type { SendOutcome } from "@/lib/sync/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(status: number, json: () => Promise<unknown>) {
  const fetch = vi.fn().mockResolvedValue({ ok: status < 400, status, json });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("fetchSignedIn", () => {
  it("asks Auth.js afresh, never from a cache", async () => {
    const fetch = respond(200, () => Promise.resolve({ user: { id: "ann" } }));
    expect(await fetchSignedIn()).toEqual({ kind: "member", id: "ann" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it.each([
    ["nobody signed in", null],
    ["a session with no user", {}],
    ["a user with no id", { user: {} }],
    ["a user that is not an object", { user: "ann" }],
    ["an empty id", { user: { id: "" } }],
  ])("reads %s as nobody", async (_, body) => {
    respond(200, () => Promise.resolve(body));
    expect(await fetchSignedIn()).toEqual({ kind: "member", id: null });
  });

  it("does not know when the server fails", async () => {
    respond(500, () => Promise.resolve({ user: { id: "ann" } }));
    expect(await fetchSignedIn()).toEqual({ kind: "unknown" });
  });

  it("does not know when the answer is not JSON", async () => {
    respond(200, () => Promise.reject(new SyntaxError("Unexpected token")));
    expect(await fetchSignedIn()).toEqual({ kind: "unknown" });
  });

  it("does not know when there is no signal, or the check stalls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await fetchSignedIn()).toEqual({ kind: "unknown" });

    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("timed out", "TimeoutError"));
            });
          }),
      ),
    );
    const answer = fetchSignedIn(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await answer).toEqual({ kind: "unknown" });
    vi.useRealTimers();
  });
});

describe("sendAs", () => {
  const items = [{ id: "v1" }] as VisitSyncItem[];
  const ok: SendOutcome = { kind: "ok", results: [] };

  it("sends while the owner is the one signed in", async () => {
    const send = vi.fn().mockResolvedValue(ok);
    const other = vi.fn();
    const guarded = sendAs(
      "ann",
      send,
      () => Promise.resolve({ kind: "member", id: "ann" }),
      other,
    );
    expect(await guarded(items)).toBe(ok);
    expect(send).toHaveBeenCalledWith(items);
    expect(other).not.toHaveBeenCalled();
  });

  it.each([
    ["someone else", "ben"],
    ["nobody", null],
  ])("sends nothing once %s is signed in, and lets go of the owner", async (_, id) => {
    const send = vi.fn();
    const other = vi.fn();
    const guarded = sendAs("ann", send, () => Promise.resolve({ kind: "member", id }), other);
    expect(await guarded(items)).toEqual({ kind: "http", status: 401, code: "unauthorized" });
    expect(send).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("waits as if offline when it cannot tell", async () => {
    const send = vi.fn();
    const other = vi.fn();
    const guarded = sendAs("ann", send, () => Promise.resolve({ kind: "unknown" }), other);
    expect(await guarded(items)).toEqual({ kind: "network" });
    expect(send).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });
});
