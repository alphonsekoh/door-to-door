import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RestoreGuard } from "@/components/shell/restore-guard";

const reload = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  reload.mockClear();
  document.documentElement.style.removeProperty("visibility");
});

function show(persisted: boolean): void {
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
}

describe("RestoreGuard", () => {
  it("loads a page restored from the back/forward cache again, hidden meanwhile", () => {
    vi.stubGlobal("location", { reload });
    render(<RestoreGuard />);

    show(true);

    expect(reload).toHaveBeenCalledOnce();
    expect(document.documentElement.style.visibility).toBe("hidden");
  });

  it("leaves an ordinary load alone", () => {
    vi.stubGlobal("location", { reload });
    render(<RestoreGuard />);

    show(false);

    expect(reload).not.toHaveBeenCalled();
    expect(document.documentElement.style.visibility).toBe("");
  });

  it("stops listening when it goes", () => {
    vi.stubGlobal("location", { reload });
    const { unmount } = render(<RestoreGuard />);
    unmount();

    show(true);

    expect(reload).not.toHaveBeenCalled();
  });
});
