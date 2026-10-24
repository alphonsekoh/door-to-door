import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { knownSessionKind, useKnownSessionKind } from "@/lib/session/known-kind";

afterEach(() => {
  knownSessionKind.forget();
});

describe("knownSessionKind", () => {
  it("knows nothing on a fresh page, then what it was last told", () => {
    expect(knownSessionKind.getSnapshot()).toBeUndefined();
    knownSessionKind.note("follow_up");
    expect(knownSessionKind.getSnapshot()).toBe("follow_up");
    knownSessionKind.note(null);
    expect(knownSessionKind.getSnapshot()).toBeNull();
  });

  it("tells subscribers of a change only, until they unsubscribe", () => {
    const listener = vi.fn();
    const stop = knownSessionKind.subscribe(listener);
    knownSessionKind.note("regular");
    knownSessionKind.note("regular");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    knownSessionKind.note("follow_up");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("useKnownSessionKind", () => {
  it("re-renders with each change", () => {
    const { result } = renderHook(() => useKnownSessionKind());
    expect(result.current).toBeUndefined();
    act(() => {
      knownSessionKind.note("follow_up");
    });
    expect(result.current).toBe("follow_up");
  });

  it("is unknown in a server render, whatever this module holds", () => {
    knownSessionKind.note("follow_up");
    function Show() {
      return <p>{useKnownSessionKind() ?? "unknown"}</p>;
    }
    expect(renderToString(<Show />)).toContain("unknown");
  });
});
