import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSessions } from "@/components/admin/admin-sessions";
import type { OutingSession, SessionStatus } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

function session(id: string, title: string, status: SessionStatus): OutingSession {
  return {
    id,
    title,
    kind: "regular",
    status,
    startedAt: null,
    endedAt: null,
    createdBy: { id: "admin", name: "Admin", image: null },
    createdAt: "2026-03-01T00:00:00.000Z",
  };
}

const page = (rows: OutingSession[]) => ({
  data: rows,
  pagination: { limit: 25, offset: 0, total: rows.length, hasMore: false },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminSessions", () => {
  it("lists the outings with their status in words", async () => {
    apiFetch.mockResolvedValue(
      page([session("s1", "June outing", "active"), session("s2", "March outing", "ended")]),
    );
    render(<AdminSessions />);

    expect(await screen.findByText("June outing")).toBeInTheDocument();
    expect(screen.getByText("Running now")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  it("puts reopen on the row itself, not behind the detail screen", async () => {
    // The acceptance criterion: two taps from here. Burying it costs a member
    // their work while an admin hunts for it.
    apiFetch.mockResolvedValue(page([session("s2", "March outing", "ended")]));
    render(<AdminSessions />);

    expect(await screen.findByRole("button", { name: "Reopen session" })).toBeInTheDocument();
  });

  it("offers start on a draft and end on a running outing", async () => {
    apiFetch.mockResolvedValue(
      page([session("s1", "Draft outing", "draft"), session("s2", "Live outing", "active")]),
    );
    render(<AdminSessions />);

    expect(await screen.findByRole("button", { name: "Start session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument();
  });

  it("links each outing to its detail screen", async () => {
    apiFetch.mockResolvedValue(page([session("s1", "June outing", "active")]));
    render(<AdminSessions />);

    expect(await screen.findByRole("link", { name: /June outing/ })).toHaveAttribute(
      "href",
      "/admin/sessions/s1",
    );
  });

  it("reloads after an action so the status is not stale", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([session("s1", "Draft outing", "draft")]));
    render(<AdminSessions />);
    await screen.findByText("Draft outing");

    apiFetch.mockImplementation((path: string) =>
      path === "/sessions/s1/start"
        ? Promise.resolve(session("s1", "Draft outing", "active"))
        : Promise.resolve(page([session("s1", "Draft outing", "active")])),
    );
    await user.click(screen.getByRole("button", { name: "Start session" }));

    expect(await screen.findByText("Running now")).toBeInTheDocument();
  });

  it("tells an admin with no outings what to do first", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions />);
    expect(await screen.findByText("No sessions yet.")).toBeInTheDocument();
  });

  it("shows the newly created outing without a manual refresh", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions />);
    await screen.findByText("No sessions yet.");

    apiFetch.mockImplementation((path: string) =>
      path === "/sessions"
        ? Promise.resolve(session("s1", "Saturday morning", "draft"))
        : Promise.resolve(page([session("s1", "Saturday morning", "draft")])),
    );
    await user.click(screen.getByRole("button", { name: "New session" }));
    await user.type(screen.getByLabelText("Name this session"), "Saturday morning");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Saturday morning")).toBeInTheDocument();
  });

  it("offers a retry when the list fails to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<AdminSessions />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");

    apiFetch.mockResolvedValue(page([session("s1", "June outing", "active")]));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("June outing")).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<AdminSessions />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the sessions.");
  });
});

describe("follow-up sessions and the list", () => {
  it("marks a follow-up session on its row", async () => {
    apiFetch.mockResolvedValue(
      page([
        { ...session("s1", "Revisits", "draft"), kind: "follow_up" },
        session("s2", "Knocking", "draft"),
      ]),
    );
    render(<AdminSessions />);
    const revisits = (await screen.findByText("Revisits")).closest("li");
    expect(revisits).toHaveTextContent("Follow-up");
    expect(screen.getByText("Knocking").closest("li")).not.toHaveTextContent("Follow-up");
  });

  it("leads to the follow-up list", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions />);
    expect(await screen.findByRole("link", { name: "Follow-up list" })).toHaveAttribute(
      "href",
      "/admin/follow-ups",
    );
  });
});
