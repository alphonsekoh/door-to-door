import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackLink } from "@/components/back-link";
import { arrived, resetTrail } from "@/lib/screen-trail";

beforeEach(() => {
  resetTrail();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BackLink", () => {
  it("retraces the member's steps when an in-app screen is behind", async () => {
    arrived("/follow-ups");
    arrived("/households/h1");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<BackLink href="/follow-ups" label="Back" retrace />);

    await userEvent.setup().click(screen.getByRole("link", { name: "Back" }));
    expect(back).toHaveBeenCalledOnce();
  });

  it("follows its address when what is behind is not the app's, however long the history", async () => {
    // Another site's page, or the sign-in form, in this tab's history.
    window.history.pushState({}, "", "/sign-in");
    window.history.pushState({}, "", "/households/h1");
    arrived("/households/h1");
    const back = vi.spyOn(window.history, "back");
    render(<BackLink href="/follow-ups" label="Back" retrace />);

    await userEvent.setup().click(screen.getByRole("link", { name: "Back" }));
    expect(back).not.toHaveBeenCalled();
  });

  it("follows its address when it is not asked to retrace", async () => {
    arrived("/blocks");
    arrived("/blocks/b1");
    const back = vi.spyOn(window.history, "back");
    render(<BackLink href="/" label="Session" />);

    const link = screen.getByRole("link", { name: "Back to Session" });
    expect(link).toHaveAttribute("href", "/");
    await userEvent.setup().click(link);
    expect(back).not.toHaveBeenCalled();
  });
});
