import { afterEach, describe, expect, it, vi } from "vitest";
import { readThread } from "@/lib/offline/read-thread";
import { history, householdId } from "../../../test/thread-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function respond(status: number, json: () => Promise<unknown>) {
  const fetch = vi.fn().mockResolvedValue({ ok: status < 400, status, json });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("readThread", () => {
  it("asks the server afresh for the unit's newest page", async () => {
    const fetch = respond(200, () => Promise.resolve(history(1)));
    expect(await readThread(householdId("1"))).toEqual(history(1));
    expect(fetch).toHaveBeenCalledWith(
      `/api/households/${householdId("1")}?limit=20&offset=0`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it.each([
    ["a refusal, such as nobody signed in", 401, { error: { code: "unauthorized" } }],
    ["a server failure", 500, history(1)],
    ["an answer that is not a history", 200, { household: null }],
  ])("is null for %s", async (_, status, body) => {
    respond(status, () => Promise.resolve(body));
    expect(await readThread(householdId("1"))).toBeNull();
  });

  it("is null with no signal, or when the read stalls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await readThread(householdId("1"))).toBeNull();

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
    const read = readThread(householdId("1"), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await read).toBeNull();
  });
});
