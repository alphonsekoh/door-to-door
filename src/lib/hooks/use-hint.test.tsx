import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { useHint } from "@/lib/hooks/use-hint";

function Hint({ id }: { id: string }) {
  const { show, dismiss } = useHint(id);
  return show ? (
    <button type="button" onClick={dismiss}>
      Got it
    </button>
  ) : null;
}

afterEach(() => {
  localStorage.clear();
});

describe("useHint", () => {
  it("draws nothing on the server, so hydration never shows a hint the phone hid", () => {
    expect(renderToString(<Hint id="tour" />)).toBe("");
  });

  it("shows a hint this phone has not dismissed, and hides every copy on dismissal", () => {
    render(
      <>
        <Hint id="tour" />
        <Hint id="tour" />
      </>,
    );
    const buttons = screen.getAllByRole("button", { name: "Got it" });
    expect(buttons).toHaveLength(2);
    act(() => {
      buttons[0]?.click();
    });
    expect(screen.queryByRole("button", { name: "Got it" })).toBeNull();
  });

  it("stays hidden once dismissed", () => {
    localStorage.setItem("d2d:hint:tour", "1");
    render(<Hint id="tour" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("follows a dismissal made in another tab", () => {
    render(<Hint id="tour" />);
    act(() => {
      localStorage.setItem("d2d:hint:tour", "1");
      window.dispatchEvent(new StorageEvent("storage", { key: "d2d:hint:tour" }));
    });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
