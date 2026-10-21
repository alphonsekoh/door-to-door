import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whenIdle } from "@/lib/when-idle";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("whenIdle", () => {
  it("waits for the browser to be idle, giving up waiting after two seconds", () => {
    const requestIdleCallback = vi.fn(() => 7);
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const task = vi.fn();

    const cancel = whenIdle(task);
    expect(requestIdleCallback).toHaveBeenCalledWith(task, { timeout: 2000 });
    vi.runAllTimers();
    expect(task).not.toHaveBeenCalled();

    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("runs a moment later where there is no idle callback, as in Safari", () => {
    expect("requestIdleCallback" in globalThis).toBe(false);
    const task = vi.fn();
    whenIdle(task);
    vi.advanceTimersByTime(199);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
  });

  it("can be called off before it runs", () => {
    const task = vi.fn();
    const cancel = whenIdle(task);
    cancel();
    vi.runAllTimers();
    expect(task).not.toHaveBeenCalled();
  });
});
