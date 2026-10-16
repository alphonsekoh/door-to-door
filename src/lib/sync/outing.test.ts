import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OUTING_ASK_TIMEOUT_MS, askOutingWithin } from "@/lib/sync/outing";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("askOutingWithin", () => {
  it("gives the outing when the answer comes in time", async () => {
    await expect(askOutingWithin(() => Promise.resolve("s1"))).resolves.toBe("s1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives no outing when the server says none is running", async () => {
    await expect(askOutingWithin(() => Promise.resolve(null))).resolves.toBeNull();
  });

  it("gives up on a request that stalls rather than fails", async () => {
    const answer = askOutingWithin(() => new Promise<string | null>(() => undefined));
    let settled = false;
    void answer.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(OUTING_ASK_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(answer).resolves.toBeNull();
  });
});
