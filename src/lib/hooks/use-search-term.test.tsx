import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { useSearchTerm } from "@/lib/hooks/use-search-term";

/* What Next's router keeps in the history entry, and must find there again
   for Back and Forward to work. */
const NEXT = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "t" } };

/* The address as Next's router last read it; a test says when that moves. */
const { address } = vi.hoisted(() => ({ address: { params: new URLSearchParams() } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => address.params,
}));

function at(query: string) {
  address.params = new URLSearchParams(query);
  window.history.replaceState(
    NEXT,
    "",
    query === "" ? "/admin/history" : `/admin/history?${query}`,
  );
}

function open(query: string, search = "") {
  at(query);
  return renderHook(({ filters }) => useSearchTerm("/admin/history", filters), {
    initialProps: { filters: search },
  });
}

const shown = () => `${window.location.pathname}${window.location.search}`;
let replaceState: MockInstance<History["replaceState"]>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  replaceState = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSearchTerm", () => {
  it("starts empty and leaves an address without a term alone", () => {
    const { result } = open("religion=hindu", "religion=hindu");
    replaceState.mockClear();

    vi.runAllTimers();

    expect(result.current[0]).toBe("");
    expect(replaceState).not.toHaveBeenCalled();
    expect(shown()).toBe("/admin/history?religion=hindu");
  });

  it("takes an old link's term and drops it from the address at once, keeping the filters", () => {
    const { result } = open("q=Tan&religion=hindu", "religion=hindu");

    expect(result.current[0]).toBe("Tan");
    expect(shown()).toBe("/admin/history?religion=hindu");
    // Wiped, Back and Forward onto this entry would do nothing.
    expect(window.history.state).toEqual(NEXT);
  });

  it("hands the address to Next's replaceState only once the router's effects have run", () => {
    open("q=Tan&religion=hindu", "religion=hindu");
    // Before Next installs its own, a call without its state would wipe it.
    expect(replaceState).not.toHaveBeenCalledWith(null, "", expect.anything());

    vi.runAllTimers();

    // Next's replaceState takes a call without its state as one to tell useSearchParams of.
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/admin/history?religion=hindu");
  });

  it("tells Next nothing once the screen is left", () => {
    const { unmount } = open("q=Tan");
    unmount();
    window.history.replaceState(NEXT, "", "/admin/sessions");
    replaceState.mockClear();

    vi.runAllTimers();

    expect(replaceState).not.toHaveBeenCalled();
    expect(shown()).toBe("/admin/sessions");
  });

  it("goes to the bare screen when the term was all the link held", () => {
    open("q=Tan");

    expect(shown()).toBe("/admin/history");
  });

  it("keeps the term once the address has dropped it", () => {
    const { result, rerender } = open("q=Tan");
    vi.runAllTimers();
    replaceState.mockClear();

    address.params = new URLSearchParams();
    rerender({ filters: "" });
    vi.runAllTimers();

    expect(result.current[0]).toBe("Tan");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("holds what is typed, and never writes it to the address", () => {
    const { result } = open("");
    replaceState.mockClear();

    act(() => {
      result.current[1]("124");
    });
    vi.runAllTimers();

    expect(result.current[0]).toBe("124");
    expect(replaceState).not.toHaveBeenCalled();
    expect(shown()).toBe("/admin/history");
  });

  it("takes a term that appears under a mounted screen, as Back onto an old entry does", () => {
    const { result, rerender } = open("");
    act(() => {
      result.current[1]("typed");
    });

    at("q=Lim&sessionId=s1");
    rerender({ filters: "sessionId=s1" });

    expect(result.current[0]).toBe("Lim");
    expect(shown()).toBe("/admin/history?sessionId=s1");
    expect(window.history.state).toEqual(NEXT);
  });
});
