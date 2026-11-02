import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRoutePathname } from "@/lib/hooks/use-route-pathname";

const { usePathname, useSelectedLayoutSegment } = vi.hoisted(() => ({
  usePathname: vi.fn<() => string>(),
  useSelectedLayoutSegment: vi.fn<() => string | null>(),
}));
vi.mock("next/navigation", () => ({ usePathname, useSelectedLayoutSegment }));

beforeEach(() => {
  useSelectedLayoutSegment.mockReturnValue(null);
});

describe("useRoutePathname", () => {
  it("is the address on an ordinary route", () => {
    usePathname.mockReturnValue("/blocks/b1");
    useSelectedLayoutSegment.mockReturnValue("blocks");
    expect(renderHook(() => useRoutePathname()).result.current).toBe("/blocks/b1");
  });

  it("is the address at the root, where no segment is selected", () => {
    usePathname.mockReturnValue("/");
    expect(renderHook(() => useRoutePathname()).result.current).toBe("/");
  });

  it("is /offline when the worker served the offline page at another address", () => {
    usePathname.mockReturnValue("/blocks/b1");
    useSelectedLayoutSegment.mockReturnValue("offline");
    expect(renderHook(() => useRoutePathname()).result.current).toBe("/offline");
  });
});
