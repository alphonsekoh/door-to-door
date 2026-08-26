import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccountPage from "@/app/account/page";
import FollowUpsPage from "@/app/follow-ups/page";
import HistoryPage from "@/app/history/page";
import NotFound from "@/app/not-found";
import SessionPage from "@/app/page";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("placeholder screens", () => {
  it.each([
    ["session", SessionPage, "Active session", 24],
    ["history", HistoryPage, "History", 27],
    ["follow-ups", FollowUpsPage, "Follow-ups", 35],
    ["account", AccountPage, "Account", 15],
  ])("%s renders its heading and names its issue", (_name, Page, heading, issue) => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByText(`Arrives in issue #${String(issue)}`)).toBeInTheDocument();
  });
});

describe("not found", () => {
  it("offers a way back to the session screen", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "Not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to session" })).toHaveAttribute("href", "/");
  });
});
