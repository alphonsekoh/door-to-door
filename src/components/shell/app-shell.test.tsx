import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/shell/app-shell";
import { accountStore } from "@/lib/session/account-state";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSelectedLayoutSegment: () => null,
}));
/* The nav reads the role to decide whether to offer the admin tab, so it needs
   a session. The real tree gets one from SessionProvider in the root layout. */
vi.mock("@/lib/hooks/use-role", () => ({
  useRole: () => ({
    userId: "u1",
    role: "member",
    isAdmin: false,
    isMember: true,
    isLoading: false,
    isSignedIn: true,
  }),
}));

/* The shell reads /users/me once on load; that read is the gate's to test. */
vi.mock("@/lib/session/users", () => ({
  loadCurrentUser: () => Promise.resolve({ id: "u1", role: "member" }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("visibility");
});

describe("AppShell", () => {
  it("renders page content inside the main landmark", () => {
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("Page body");
  });

  it("pads the content for the nav and for any banner floating over it", () => {
    // Both utilities add the --banner-* variables the banners publish.
    render(<AppShell>content</AppShell>);
    expect(screen.getByRole("main")).toHaveClass("pt-banner", "pb-nav");
  });

  it("renders the primary navigation alongside the content", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("loads the page again when Back restores it from the back/forward cache", () => {
    // Whoever was signed in when it was left must not reappear on a shared phone (#129).
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    render(<AppShell>content</AppShell>);

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));

    expect(reload).toHaveBeenCalledOnce();
  });

  it("puts the page, the banners and the nav behind the account message", () => {
    // Last: a reported failure sticks for the rest of this file.
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );
    act(() => {
      accountStore.reportAuthFailure("deactivated");
    });
    expect(screen.getByText("Page body").closest("[inert]")).not.toBeNull();
    expect(screen.getByText("Session").closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("alertdialog", { name: "Account deactivated" })).toBeInTheDocument();

    // A page left from behind the message, as by the sign-out it offers, is
    // loaded again too.
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
