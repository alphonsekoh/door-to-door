import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOnline } from "@/lib/use-online";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOnline", () => {
  it("follows the browser going offline and back", () => {
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const { result, unmount } = renderHook(() => useOnline());
    expect(result.current).toBe(true);

    act(() => {
      onLine.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    act(() => {
      onLine.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
    unmount();
  });

  it("stops listening when unmounted", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    renderHook(() => useOnline()).unmount();
    expect(remove).toHaveBeenCalledWith("online", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});

describe("on the server", () => {
  it("assumes online, so a page renders enabled and corrects itself on the client", () => {
    function Probe() {
      return <p>{useOnline() ? "online" : "offline"}</p>;
    }
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    expect(renderToString(<Probe />)).toContain("online");
  });
});
