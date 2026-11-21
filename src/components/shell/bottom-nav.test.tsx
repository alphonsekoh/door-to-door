import { act, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "@/components/shell/bottom-nav";
import { accountStore } from "@/lib/session/account-state";
import { shellState } from "@/lib/offline/shell-state";
import type * as UseRoleModule from "@/lib/hooks/use-role";
import type * as ApprovalCountModule from "@/lib/session/approval-count";

const { usePathname, useSelectedLayoutSegment } = vi.hoisted(() => ({
  usePathname: vi.fn<() => string>(),
  useSelectedLayoutSegment: vi.fn<() => string | null>(),
}));
const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
const { useApprovalCount } = vi.hoisted(() => ({
  useApprovalCount: vi.fn<(enabled: boolean) => number | null>(),
}));

vi.mock("next/navigation", () => ({ usePathname, useSelectedLayoutSegment }));
vi.mock("next-auth/react", () => ({ useSession }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));
vi.mock("@/lib/session/approval-count", async (importOriginal) => ({
  ...(await importOriginal<typeof ApprovalCountModule>()),
  useApprovalCount,
}));

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
  useSelectedLayoutSegment.mockReturnValue(null);
  useApprovalCount.mockReturnValue(null);
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

  it("keeps the admin tab current on the admin screens past Sessions", () => {
    asRole(true);
    usePathname.mockReturnValue("/admin/team");
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

  it("does not render on the waiting page, which leads nowhere else (#249)", () => {
    usePathname.mockReturnValue("/waiting");
    const { container } = render(<BottomNav />);
    expect(container).toBeEmptyDOMElement();
    expect(useApprovalCount).toHaveBeenCalledWith(false);
  });

  it("still renders on the routes behind the guard", () => {
    usePathname.mockReturnValue("/history");
    render(<BottomNav />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("drops the Admin tab for a demoted admin once /users/me says so", async () => {
    // The real hook here: the token still says admin and cannot be updated.
    const actual = await vi.importActual<typeof UseRoleModule>("@/lib/hooks/use-role");
    useRole.mockImplementation(actual.useRole);
    useSession.mockReturnValue({
      status: "authenticated",
      data: { user: { id: "u1", role: "admin", deactivated: false } },
    });
    usePathname.mockReturnValue("/");
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();

    act(() => {
      accountStore.noteCurrentUser({ id: "u1", role: "member" });
    });
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });
});

/* #249: in the app only, no email. */
describe("BottomNav's count of who waits for approval", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
  });

  it("asks for the count only for an admin", () => {
    render(<BottomNav />);
    expect(useApprovalCount).toHaveBeenLastCalledWith(false);
    asRole(true);
    render(<BottomNav />);
    expect(useApprovalCount).toHaveBeenLastCalledWith(true);
  });

  it("badges the Admin tab, and names the count with it", () => {
    asRole(true);
    useApprovalCount.mockReturnValue(3);
    render(<BottomNav />);
    const admin = screen.getByRole("link", { name: "Admin, 3 waiting for approval" });
    expect(admin).toHaveTextContent("3");
    for (const label of ["Session", "History", "Follow-ups", "Account"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveTextContent(/\d/);
    }
  });

  it("caps the badge at 99+, and still says the whole count", () => {
    asRole(true);
    useApprovalCount.mockReturnValue(120);
    render(<BottomNav />);
    const admin = screen.getByRole("link", { name: "Admin, 120 waiting for approval" });
    expect(within(admin).getByText("99+")).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["nobody waits", 0],
    ["the count is unknown", null],
  ])("shows no badge when %s", (_case, count) => {
    asRole(true);
    useApprovalCount.mockReturnValue(count);
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveTextContent(/^Admin$/);
  });
});

describe("BottomNav on the offline shell (#77)", () => {
  /* The worker serves the prerendered /offline page at the address that
     failed: the server rendered /offline, the browser reads /blocks/b1. */
  it("hydrates the offline page served at another address as the server drew it", async () => {
    useSelectedLayoutSegment.mockReturnValue("offline");
    usePathname.mockReturnValue("/offline");
    const container = document.createElement("div");
    container.innerHTML = renderToString(<BottomNav />);
    document.body.append(container);

    usePathname.mockReturnValue("/blocks/b1");
    const mismatches: unknown[] = [];
    const root = await act(() =>
      hydrateRoot(container, <BottomNav />, {
        onRecoverableError: (error) => mismatches.push(error),
      }),
    );
    const drawn = container.innerHTML;
    act(() => {
      root.unmount();
    });
    container.remove();
    expect(mismatches).toEqual([]);
    expect(drawn).toBe("");
  });

  it("is hidden while the shell is shown, at any address", () => {
    usePathname.mockReturnValue("/blocks/b1");
    act(() => {
      shellState.enter();
    });
    const { container, rerender } = render(<BottomNav />);
    expect(container).toBeEmptyDOMElement();

    act(() => {
      shellState.leave();
    });
    rerender(<BottomNav />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });
});
