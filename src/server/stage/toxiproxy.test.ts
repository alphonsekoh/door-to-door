import { describe, expect, it, vi } from "vitest";
import { setDatabaseLatency, type FetchLike } from "@/server/stage/toxiproxy";

const API = "http://127.0.0.1:3401";

type Call = { url: string; method: string | undefined; body: unknown };

function fakeToxiproxy(status: (method: string | undefined) => number) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({
      url,
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(new Response(null, { status: status(init?.method) }));
  };
  return { calls, fetchImpl };
}

describe("setDatabaseLatency", () => {
  it("clears its own delay, then adds the round trip half each way", async () => {
    const { calls, fetchImpl } = fakeToxiproxy((method) => (method === "DELETE" ? 404 : 200));

    await setDatabaseLatency(API, 221, fetchImpl);

    expect(calls).toEqual([
      { url: `${API}/proxies/postgres/toxics/stage-latency-up`, method: "DELETE", body: undefined },
      {
        url: `${API}/proxies/postgres/toxics/stage-latency-down`,
        method: "DELETE",
        body: undefined,
      },
      {
        url: `${API}/proxies/postgres/toxics`,
        method: "POST",
        body: {
          name: "stage-latency-up",
          type: "latency",
          stream: "upstream",
          attributes: { latency: 110, jitter: 0 },
        },
      },
      {
        url: `${API}/proxies/postgres/toxics`,
        method: "POST",
        body: {
          name: "stage-latency-down",
          type: "latency",
          stream: "downstream",
          attributes: { latency: 111, jitter: 0 },
        },
      },
    ]);
  });

  it("only clears with 0, so the next run starts from none", async () => {
    const { calls, fetchImpl } = fakeToxiproxy(() => 204);

    await setDatabaseLatency(API, 0, fetchImpl);

    expect(calls.map((call) => call.method)).toEqual(["DELETE", "DELETE"]);
  });

  it("stops when toxiproxy will not clear a delay, adding nothing", async () => {
    const { calls, fetchImpl } = fakeToxiproxy(() => 500);

    await expect(setDatabaseLatency(API, 100, fetchImpl)).rejects.toThrow(
      "toxiproxy refused to remove stage-latency-up: HTTP 500",
    );
    expect(calls).toHaveLength(1);
  });

  it("says which delay toxiproxy refused", async () => {
    const { fetchImpl } = fakeToxiproxy((method) => (method === "POST" ? 409 : 204));

    await expect(setDatabaseLatency(API, 100, fetchImpl)).rejects.toThrow(
      "toxiproxy refused the upstream delay: HTTP 409",
    );
  });

  it("points at the stack when toxiproxy cannot be reached", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new TypeError("fetch failed"));

    await expect(setDatabaseLatency(API, 100, fetchImpl)).rejects.toThrow(
      `Could not reach toxiproxy at ${API}. Is the stage stack up? npm run stage:up`,
    );
  });

  it("uses fetch unless told otherwise", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await setDatabaseLatency(API, 0);

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
