import { afterEach, describe, expect, it, vi } from "vitest";
import { readRevisits } from "@/lib/offline/read-revisits";

const OUTING = "0190a000-0000-7000-8000-0000000000cc";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function respond(status: number, json: () => Promise<unknown>) {
  const fetch = vi.fn().mockResolvedValue({ ok: status < 400, status, json });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("readRevisits", () => {
  it("asks the server afresh for the outing's list", async () => {
    const fetch = respond(200, () => Promise.resolve({ data: [] }));
    expect(await readRevisits(OUTING)).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      `/api/sessions/${OUTING}/revisits`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it.each([
    ["a refusal, such as nobody signed in", 401, { error: { code: "unauthorized" } }],
    ["a server failure", 500, { data: [] }],
    ["an answer that is not the list", 200, { data: [{ household: null }] }],
  ])("is null for %s", async (_, status, body) => {
    respond(status, () => Promise.resolve(body));
    expect(await readRevisits(OUTING)).toBeNull();
  });

  it("is null with no signal, or when the read stalls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await readRevisits(OUTING)).toBeNull();

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
    const read = readRevisits(OUTING, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await read).toBeNull();
  });
});
