import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReloadWhenOnline } from "@/components/reload-when-online";

const replace = vi.fn();
const reload = vi.fn();

function at(pathname: string) {
  vi.stubGlobal("location", { pathname, replace, reload });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ReloadWhenOnline", () => {
  it("reloads the page the member was after when signal returns", () => {
    at("/blocks/b1");
    render(<ReloadWhenOnline />);
    expect(reload).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("online"));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("goes to the home screen when the offline page is itself the address", () => {
    at("/offline");
    render(<ReloadWhenOnline />);
    window.dispatchEvent(new Event("online"));
    expect(replace).toHaveBeenCalledWith("/");
    expect(reload).not.toHaveBeenCalled();
  });

  it("stops listening once gone", () => {
    at("/blocks/b1");
    const { unmount } = render(<ReloadWhenOnline />);
    unmount();
    window.dispatchEvent(new Event("online"));
    expect(reload).not.toHaveBeenCalled();
  });
});
