import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OfflinePage from "@/app/offline/page";

describe("the offline page", () => {
  it("says so, and offers a retry that is a real page load", () => {
    const { container } = render(<OfflinePage />);

    expect(screen.getByRole("heading", { name: "You're offline" })).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Try again" });
    const form = container.querySelector("form");
    expect(form).toContainElement(retry);
    expect(form).toHaveAttribute("action", "/");
    expect(form).toHaveAttribute("method", "get");
  });

  it("says saved visits are kept, without naming anyone's", () => {
    render(<OfflinePage />);
    expect(
      screen.getByText(
        "Visits already saved on this phone are kept. They send once your signal is back.",
      ),
    ).toBeInTheDocument();
  });
});
