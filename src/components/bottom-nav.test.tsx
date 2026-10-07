import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "@/components/bottom-nav";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn<() => string>() }));
const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("@/lib/use-role", () => ({ useRole }));

const asRole = (isAdmin: boolean) =>
  useRole.mockReturnValue({
    userId: "u1",
    role: isAdmin ? "admin" : "member",
    isAdmin,
    isMember: !isAdmin,
    isLoading: false,
    isSignedIn: true,
  });

beforeEach(() => {
  asRole(false);
});

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

  it("keeps the admin section out of a member's nav", () => {
    // Affordance only - the handlers re-check - but a member should not be
    // shown a tab whose every request would come back 403.
    usePathname.mockReturnValue("/");
    render(<BottomNav />);
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("offers the admin section to an admin", () => {
    asRole(true);
    usePathname.mockReturnValue("/");
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin/sessions");
  });

  it("keeps the admin tab current on a nested admin route", () => {
    asRole(true);
    usePathname.mockReturnValue("/admin/sessions/42");
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
  });

  it("does not render on a public route", () => {
    /*
     * Not cosmetic. Its Links prefetch while the visitor is signed out, the
     * proxy answers each with a redirect to /sign-in, and the client router
     * caches those - so the push after a successful sign-in replayed one and
     * left the member on the form. Found by the e2e suite, in the production
     * build only.
     */
    usePathname.mockReturnValue("/sign-in");
    const { container } = render(<BottomNav />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders on the routes behind the guard", () => {
    usePathname.mockReturnValue("/history");
    render(<BottomNav />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });
});
