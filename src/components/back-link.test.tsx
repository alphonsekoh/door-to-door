import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackLink } from "@/components/back-link";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BackLink", () => {
  it("retraces the member's steps when there are steps to retrace", async () => {
    window.history.pushState({}, "", "/follow-ups");
    window.history.pushState({}, "", "/households/h1");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<BackLink href="/follow-ups" label="Back" retrace />);

    await userEvent.setup().click(screen.getByRole("link", { name: "Back" }));
    expect(back).toHaveBeenCalledOnce();
  });

  it("follows its address when it is not asked to retrace", async () => {
    window.history.pushState({}, "", "/blocks/b1");
    const back = vi.spyOn(window.history, "back");
    render(<BackLink href="/" label="Session" />);

    const link = screen.getByRole("link", { name: "Back to Session" });
    expect(link).toHaveAttribute("href", "/");
    await userEvent.setup().click(link);
    expect(back).not.toHaveBeenCalled();
  });
});
