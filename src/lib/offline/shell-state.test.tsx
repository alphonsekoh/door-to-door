import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shellState, useShellState } from "@/lib/offline/shell-state";

afterEach(() => {
  shellState.leave();
});

describe("shellState", () => {
  it("is off until the shell is shown", () => {
    expect(shellState.getSnapshot()).toEqual({ active: false, ownerId: null });
  });

  it("holds nobody when entered, the member once they continue, nothing once left", () => {
    shellState.enter();
    expect(shellState.getSnapshot()).toEqual({ active: true, ownerId: null });
    shellState.continueAs("alice");
    expect(shellState.getSnapshot()).toEqual({ active: true, ownerId: "alice" });
    shellState.leave();
    expect(shellState.getSnapshot()).toEqual({ active: false, ownerId: null });
  });

  it("tells subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const stop = shellState.subscribe(listener);
    shellState.enter();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    shellState.leave();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("useShellState", () => {
  it("re-renders with each change", () => {
    const { result } = renderHook(() => useShellState());
    expect(result.current.active).toBe(false);
    act(() => {
      shellState.continueAs("alice");
    });
    expect(result.current).toEqual({ active: true, ownerId: "alice" });
  });

  it("is off in a server render, whatever this module holds", () => {
    shellState.continueAs("alice");
    function Show() {
      const { active } = useShellState();
      return <p>{active ? "shell" : "off"}</p>;
    }
    expect(renderToString(<Show />)).toContain("off");
  });
});
