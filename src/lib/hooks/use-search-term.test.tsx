import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchTerm } from "@/lib/hooks/use-search-term";

/* One router for every render, as Next gives; the address only changes when
   a test says it has. */
const { router, address } = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  address: { params: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => address.params,
}));

function open(query: string, search = "") {
  address.params = new URLSearchParams(query);
  return renderHook(({ filters }) => useSearchTerm("/admin/history", filters), {
    initialProps: { filters: search },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  address.params = new URLSearchParams();
});

describe("useSearchTerm", () => {
  it("starts empty and leaves an address without a term alone", () => {
    const { result } = open("religion=hindu", "religion=hindu");

    expect(result.current[0]).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("takes an old link's term and drops it from the address, keeping the filters", () => {
    const { result } = open("q=Tan&religion=hindu", "religion=hindu");

    expect(result.current[0]).toBe("Tan");
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/admin/history?religion=hindu", {
      scroll: false,
    });
  });

  it("goes to the bare screen when the term was all the link held", () => {
    open("q=Tan");

    expect(router.replace).toHaveBeenCalledWith("/admin/history", { scroll: false });
  });

  it("keeps the term once the address has dropped it", () => {
    const { result, rerender } = open("q=Tan");

    address.params = new URLSearchParams();
    rerender({ filters: "" });

    expect(result.current[0]).toBe("Tan");
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it("holds what is typed, and never writes it to the address", () => {
    const { result } = open("");

    act(() => {
      result.current[1]("124");
    });

    expect(result.current[0]).toBe("124");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("takes a term that appears under a mounted screen, as Back onto an old entry does", () => {
    const { result, rerender } = open("");
    act(() => {
      result.current[1]("typed");
    });

    address.params = new URLSearchParams("q=Lim&sessionId=s1");
    rerender({ filters: "sessionId=s1" });

    expect(result.current[0]).toBe("Lim");
    expect(router.replace).toHaveBeenCalledWith("/admin/history?sessionId=s1", {
      scroll: false,
    });
  });
});
