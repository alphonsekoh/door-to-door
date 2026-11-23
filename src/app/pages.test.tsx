import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AccountPage from "@/app/account/page";
import FollowUpsPage from "@/app/follow-ups/page";
import HistoryPage from "@/app/history/page";
import SessionHistoryPage from "@/app/history/[sessionId]/page";
import AdminSessionPage from "@/app/admin/sessions/[id]/page";
import AdminAttentionPage from "@/app/admin/attention/page";
import AdminFollowUpsPage from "@/app/admin/follow-ups/page";
import AdminHistoryPage from "@/app/admin/history/page";
import AdminRecordsPage from "@/app/admin/records/page";
import AdminTeamPage from "@/app/admin/team/page";
import AdminMemberPage from "@/app/admin/team/[id]/page";
import AdminSessionsPage from "@/app/admin/sessions/page";
import BlockLoading from "@/app/blocks/[id]/loading";
import BlockPage from "@/app/blocks/[id]/page";
import HouseholdPage, { generateStaticParams } from "@/app/households/[id]/page";
import NotFound from "@/app/not-found";
import SessionPage from "@/app/page";
import WaitingPage from "@/app/waiting/page";
import type * as ApiClientModule from "@/lib/api-client";

const { requireAdminPage, requireWaitingPage } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  requireWaitingPage: vi.fn(),
}));
vi.mock("@/server/auth/pages", () => ({ requireAdminPage, requireWaitingPage }));
vi.mock("@/auth/google", () => ({ googleDomains: () => ["gmail.com", "tjc.sg"] }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSelectedLayoutSegment: () => null,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "h1" }),
}));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return {
    ...actual,
    apiFetch: vi.fn().mockRejectedValue(new actual.ApiRequestError(404, undefined)),
  };
});
vi.mock("next-auth/react", () => ({ useSession: () => ({ update: vi.fn() }), signOut: vi.fn() }));
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

  it("links the privacy policy from the page itself, so it shows before the account loads (#273)", () => {
    render(<AccountPage />);
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});

describe("session screen", () => {
  it("renders the heading and the live block picker", async () => {
    render(<SessionPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Active session" })).toBeInTheDocument();
    // No session is running in this test, which is a normal state.
    expect(await screen.findByText("No session is running.")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { level: 1, name: "Session records" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("renders the timeline of the unit in the address", async () => {
    const { apiFetch } = await import("@/lib/api-client");
    render(<HouseholdPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringMatching(/^\/households\/h1\?/));
  });

  /* Read on the client, the unit leaves nothing for the server to draw per
     request, so no unit is drawn at build time either: each is drawn when
     first asked for (#252). */
  it("draws no unit's page at build time", () => {
    expect(generateStaticParams()).toEqual([]);
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

  it("arrives with the unit picked from a follow-up list", async () => {
    render(
      await BlockPage({
        params: Promise.resolve({ id: "b1" }),
        searchParams: Promise.resolve({ unit: "#05-123" }),
      }),
    );
    expect(await screen.findByLabelText("Unit number")).toHaveValue("#05-123");
  });

  it("ignores a unit given twice in the address", async () => {
    render(
      await BlockPage({
        params: Promise.resolve({ id: "b1" }),
        searchParams: Promise.resolve({ unit: ["#05-123", "#06-201"] }),
      }),
    );
    expect(await screen.findByLabelText("Unit number")).toHaveValue("");
  });
});

describe("block screen while it loads", () => {
  it("answers the tap at once, with a way back", () => {
    render(<BlockLoading />);
    // On one line, as the screen it stands in for draws it.
    expect(screen.getByRole("heading", { level: 1, name: "Record a visit" })).toHaveClass(
      "truncate",
    );
    expect(screen.getByRole("link", { name: "Back to Session" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Loading the block…")).toBeInTheDocument();
  });
});

describe("admin screens", () => {
  it("guards the outing list before rendering it", async () => {
    render(await AdminSessionsPage());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // The overdue card failing must not stand in for the outing list's own state.
    expect(await screen.findByText("Could not check for overdue follow-ups.")).toBeInTheDocument();
    expect(await screen.findByText("Could not check for suggestions.")).toBeInTheDocument();
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

  it("guards the follow-up list before rendering it", async () => {
    render(await AdminFollowUpsPage());
    expect(requireAdminPage).toHaveBeenCalled();
    const heading = screen.getByRole("heading", { level: 1, name: "Follow-up list" });
    // At large text "Follow-" over "up" read as two words (#196).
    expect(within(heading).getByText("Follow-up")).toHaveClass("whole-word");
    expect(screen.getByRole("link", { name: "Back to Sessions" })).toHaveAttribute(
      "href",
      "/admin/sessions",
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("guards the team screen before rendering it", async () => {
    render(await AdminTeamPage());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("tells Add someone where Google sign-in works, as config.yaml has it (#14)", async () => {
    const { apiFetch } = await import("@/lib/api-client");
    const none = { data: [], pagination: { limit: 100, offset: 0, total: 0, hasMore: false } };
    // Waiting for approval, the team, and Not approved (#249).
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(none)
      .mockResolvedValueOnce(none)
      .mockResolvedValueOnce(none);
    const user = userEvent.setup();
    render(await AdminTeamPage());
    await user.click(await screen.findByRole("button", { name: "Add someone" }));
    expect(screen.getByLabelText("Initial password")).toHaveAccessibleDescription(
      "Leave empty to sign in with Google only. That works for addresses at gmail.com or tjc.sg.",
    );
  });

  it("guards one outing's detail before rendering it", async () => {
    render(
      await AdminSessionPage({
        params: Promise.resolve({ id: "s1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Session" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

/* #249: drawn from the account's row, so Check again shows a change at once. */
describe("waiting page", () => {
  it("says an account is waiting, from the guard's own read of it", async () => {
    requireWaitingPage.mockResolvedValueOnce({
      email: "pat@gmail.com",
      name: "Pat",
      approval: "pending",
    });
    render(await WaitingPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Waiting for approval" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveValue("Pat");
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
    // There is nowhere else to go but the policy (#273).
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/privacy",
    ]);
  });

  it("says a rejected account wasn't approved", async () => {
    requireWaitingPage.mockResolvedValueOnce({
      email: "pat@gmail.com",
      name: "Pat",
      approval: "blocked",
    });
    render(await WaitingPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Your request wasn't approved" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("draws nothing for anyone the guard sends elsewhere", async () => {
    requireWaitingPage.mockRejectedValueOnce(new Error("NEXT_REDIRECT /"));
    await expect(WaitingPage()).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("not found", () => {
  it("offers a way back to the session screen", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "Not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to session" })).toHaveAttribute("href", "/");
  });

  it("guards one member's sign-ins before rendering them (#125)", async () => {
    render(
      await AdminMemberPage({
        params: Promise.resolve({ id: "u1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Member" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Team" })).toHaveAttribute(
      "href",
      "/admin/team",
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
