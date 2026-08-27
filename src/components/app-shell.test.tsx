import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
/* The nav reads the role to decide whether to offer the admin tab, so it needs
   a session. The real tree gets one from SessionProvider in the root layout. */
vi.mock("@/lib/use-role", () => ({
  useRole: () => ({
    userId: "u1",
    role: "member",
    isAdmin: false,
    isMember: true,
    isLoading: false,
    isSignedIn: true,
  }),
}));

describe("AppShell", () => {
  it("renders page content inside the main landmark", () => {
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("Page body");
  });

  it("renders the primary navigation alongside the content", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });
});
