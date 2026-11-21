import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { useAddressFilters } from "@/lib/hooks/use-address-filters";

/* What Next's router keeps in the history entry. A call that carries it goes
   straight to the browser and tells useSearchParams nothing (R-141). */
const NEXT = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "t" } };

/* `linked` is the router's copy of the address, which a test moves only where
   the router would. */
function open(linked: string) {
  window.history.replaceState(
    NEXT,
    "",
    linked === "" ? "/admin/history" : `/admin/history?${linked}`,
  );
  return renderHook(({ address }) => useAddressFilters("/admin/history", address), {
    initialProps: { address: linked },
  });
}

const shown = () => `${window.location.pathname}${window.location.search}`;
let replaceState: MockInstance<History["replaceState"]>;

beforeEach(() => {
  replaceState = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAddressFilters", () => {
  it("starts from the address and writes nothing", () => {
    const { result } = open("religion=hindu");
    replaceState.mockClear();

    expect(result.current[0]).toBe("religion=hindu");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("shows a choice at once and holds it while the router still reports the old address", () => {
    const { result, rerender } = open("religion=hindu");

    act(() => {
      result.current[1]("religion=hindu&from=2026-03-01");
    });
    expect(result.current[0]).toBe("religion=hindu&from=2026-03-01");

    rerender({ address: "religion=hindu" });
    expect(result.current[0]).toBe("religion=hindu&from=2026-03-01");
  });

  it("moves the address through Next's replaceState, not the router", () => {
    const { result } = open("");
    replaceState.mockClear();

    act(() => {
      result.current[1]("from=2026-03-01");
    });

    // Without Next's state: its replaceState puts that back, and tells useSearchParams.
    expect(replaceState).toHaveBeenCalledWith(null, "", "/admin/history?from=2026-03-01");
    expect(shown()).toBe("/admin/history?from=2026-03-01");
  });

  it("goes to the bare screen when nothing is chosen", () => {
    const { result } = open("religion=hindu");

    act(() => {
      result.current[1]("");
    });

    expect(result.current[0]).toBe("");
    expect(shown()).toBe("/admin/history");
  });

  it("keeps the choice once the router reports it back", () => {
    const { result, rerender } = open("");
    act(() => {
      result.current[1]("from=2026-03-01");
    });

    rerender({ address: "from=2026-03-01" });

    expect(result.current[0]).toBe("from=2026-03-01");
  });

  it("takes an address that changes under it, as Back or Forward does", () => {
    const { result, rerender } = open("");
    act(() => {
      result.current[1]("from=2026-03-01");
    });
    rerender({ address: "from=2026-03-01" });

    rerender({ address: "religion=buddhist" });

    expect(result.current[0]).toBe("religion=buddhist");
  });
});
