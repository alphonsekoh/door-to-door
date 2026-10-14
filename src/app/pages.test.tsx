import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccountPage from "@/app/account/page";
import FollowUpsPage from "@/app/follow-ups/page";
import HistoryPage from "@/app/history/page";
import SessionHistoryPage from "@/app/history/[sessionId]/page";
import AdminSessionPage from "@/app/admin/sessions/[id]/page";
import AdminAttentionPage from "@/app/admin/attention/page";
import AdminHistoryPage from "@/app/admin/history/page";
import AdminRecordsPage from "@/app/admin/records/page";
import AdminTeamPage from "@/app/admin/team/page";
import AdminSessionsPage from "@/app/admin/sessions/page";
import BlockPage from "@/app/blocks/[id]/page";
import HouseholdPage from "@/app/households/[id]/page";
import NotFound from "@/app/not-found";
import SessionPage from "@/app/page";
import type * as ApiClientModule from "@/lib/api-client";

const { requireAdminPage } = vi.hoisted(() => ({ requireAdminPage: vi.fn() }));
vi.mock("@/server/auth/pages", () => ({ requireAdminPage }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return {
    ...actual,
    apiFetch: vi.fn().mockRejectedValue(new actual.ApiRequestError(404, undefined)),
  };
});
vi.mock("next-auth/react", () => ({ useSession: () => ({ update: vi.fn() }), signOut: vi.fn() }));
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

describe("follow-ups screen", () => {
  it("renders its heading and the list, which reports a failed read", async () => {
    render(<FollowUpsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Follow-ups" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("account screen", () => {
  it("renders its heading and the name form once loaded", async () => {
    const { apiFetch } = await import("@/lib/api-client");
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: "u1",
      email: "a@b.c",
      name: "Alice",
      role: "member",
    });
    render(<AccountPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Your name")).toHaveValue("Alice");
  });
});

describe("session screen", () => {
  it("renders the heading and the live block picker", async () => {
    render(<SessionPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Active session" })).toBeInTheDocument();
    // No session is running in this test, which is a normal state.
    expect(await screen.findByText("No outing is running.")).toBeInTheDocument();
  });
});

describe("history screens", () => {
  it("renders the member's own outings", async () => {
    render(<HistoryPage />);
    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    // The fetch fails in this test, so the screen must say so rather than
    // pretend the member has never recorded anything.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("renders one outing's records", async () => {
    render(
      await SessionHistoryPage({
        params: Promise.resolve({ sessionId: "s1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Outing records" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("renders a unit's timeline", async () => {
    render(
      await HouseholdPage({
        params: Promise.resolve({ id: "h1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("block screen", () => {
  it("renders the recording form for the block in the route", async () => {
    render(
      await BlockPage({
        params: Promise.resolve({ id: "b1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Record a visit" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Save and next" })).toBeInTheDocument();
  });
});

describe("admin screens", () => {
  it("guards the outing list before rendering it", async () => {
    render(await AdminSessionsPage());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Outings" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // The overdue card failing must not stand in for the outing list's own state.
    expect(await screen.findByText("Could not check for overdue follow-ups.")).toBeInTheDocument();
  });

  it("guards the record list before rendering it", async () => {
    render(await AdminRecordsPage());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Records" })).toBeInTheDocument();
  });

  it("guards the long-term history before rendering it", async () => {
    render(await AdminHistoryPage());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "All records" })).toBeInTheDocument();
  });

  it("guards the return-visit list before rendering it", async () => {
    render(await AdminAttentionPage());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: "Needs a return visit" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("guards the team screen before rendering it", async () => {
    render(await AdminTeamPage());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("guards one outing's detail before rendering it", async () => {
    render(
      await AdminSessionPage({
        params: Promise.resolve({ id: "s1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Outing" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("not found", () => {
  it("offers a way back to the session screen", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "Not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to session" })).toHaveAttribute("href", "/");
  });
});
