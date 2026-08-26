import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "@/components/bottom-nav";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn<() => string>() }));

vi.mock("next/navigation", () => ({ usePathname }));

describe("BottomNav", () => {
  it("renders every primary destination", () => {
    usePathname.mockReturnValue("/");
    render(<BottomNav />);

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    for (const label of ["Session", "History", "Follow-ups", "Account"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the current route with aria-current", () => {
    usePathname.mockReturnValue("/history");
    render(<BottomNav />);

    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Session" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the section tab current on a nested route", () => {
    usePathname.mockReturnValue("/history/session/42");
    render(<BottomNav />);

    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
  });

  it("does not mark the root tab current on a nested route", () => {
    usePathname.mockReturnValue("/account/password");
    render(<BottomNav />);

    expect(screen.getByRole("link", { name: "Session" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page");
  });

  it("points each link at its route", () => {
    usePathname.mockReturnValue("/");
    render(<BottomNav />);

    expect(screen.getByRole("link", { name: "Session" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Follow-ups" })).toHaveAttribute("href", "/follow-ups");
  });
});
