import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";

/* Set before anything renders: the animation library reads the preference
   once per page and follows its changes from then on. */
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: query === "(prefers-reduced-motion)" || query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }),
});

describe("Sheet with reduced motion", () => {
  it("fades in where it would otherwise slide up", async () => {
    render(
      <Sheet label="Edit" title="Edit" onClose={vi.fn()}>
        <p>Body</p>
      </Sheet>,
    );
    const panel = screen.getByRole("dialog", { name: "Edit" });
    // No travel at all: it starts where it ends, only transparent.
    expect(panel.style.transform).not.toContain("100%");
    expect(panel.style.opacity).toBe("0");
    await waitFor(() => {
      expect(panel.style.opacity).toBe("1");
    });
    // The reduced-motion rule gives everything a 0.01ms transition, which
    // WebKit used to replay the fade with from transparent as it finished.
    expect(panel).toHaveClass("transition-none");
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("transition-none");
  });

  it("still follows a drag, and settles back when let go short", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    const onClose = vi.fn();
    render(
      <Sheet label="Edit" title="Edit" onClose={onClose}>
        <p>Body</p>
      </Sheet>,
    );
    const panel = screen.getByRole("dialog", { name: "Edit" });
    const handle = screen.getByText("Edit", { selector: "p" }).closest(".touch-none");
    if (!(handle instanceof HTMLElement)) throw new Error("no drag handle");

    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 160 });
    await waitFor(() => {
      expect(panel.style.transform).toBe("translateY(50px)");
    });
    // The scrim lightens with it: following a finger is not motion to spare.
    const scrim = screen.getByRole("button", { name: "Close" }).firstElementChild;
    if (!(scrim instanceof HTMLElement)) throw new Error("no scrim");
    expect(Number(scrim.style.opacity)).toBeCloseTo(1 - 50 / 600, 2);
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 160 });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(panel.style.transform).toBe("none");
    });
    expect(Number(scrim.style.opacity)).toBe(1);
  });

  it("cross-fades the scrim with the sheet", async () => {
    render(
      <Sheet label="Edit" title="Edit" onClose={vi.fn()}>
        <p>Body</p>
      </Sheet>,
    );
    const backdrop = screen.getByRole("button", { name: "Close" });
    expect(backdrop.style.opacity).toBe("0");
    await waitFor(() => {
      expect(backdrop.style.opacity).toBe("1");
    });
  });

  it("asks before a pull throws away unsaved work, and is back in place at once", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    const onClose = vi.fn();
    render(
      <Sheet
        label="Edit"
        title="Edit"
        onClose={onClose}
        discard={{ title: "Discard this note?", detail: "What you typed has not been saved." }}
      >
        <p>Body</p>
      </Sheet>,
    );
    const panel = screen.getByRole("dialog", { name: "Edit" });
    const handle = screen.getByText("Edit", { selector: "p" }).closest(".touch-none");
    if (!(handle instanceof HTMLElement)) throw new Error("no drag handle");

    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientY: 500 });
    fireEvent.pointerUp(panel, { pointerId: 1, clientY: 500 });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("alertdialog", { name: "Discard this note?" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(panel.style.transform).toBe("none");
    });
  });
});
