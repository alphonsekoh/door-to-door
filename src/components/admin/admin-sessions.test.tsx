import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSessions } from "@/components/admin/admin-sessions";
import type { OutingSession, SessionStatus } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { landWhileTyping } from "../../../test/land-while-typing";

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

  /* Near the foot of the list, a failure under its row landed under the nav
     (#213). jsdom lays nothing out: e2e/session-lifecycle.spec.ts measures. */
  it("says a failed action under its row, bringing into view that and the button, not the title", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      const user = userEvent.setup();
      apiFetch.mockResolvedValue(
        page([session("s1", "June outing", "ended"), session("s2", "Draft outing", "draft")]),
      );
      render(<AdminSessions />);
      await screen.findByText("Draft outing");
      const clash =
        "Another session is already active. End it before starting or reopening this one.";
      apiFetch.mockRejectedValue(
        new ApiRequestError(409, { error: { code: "session_already_active", message: clash } }),
      );
      const start = screen.getByRole("button", { name: "Start session" });

      await user.click(start);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(clash);
      const row = screen.getByText("Draft outing").closest("li");
      if (row === null) throw new Error("no row for Draft outing");
      expect(row).toContainElement(alert);
      expect(screen.getByText("June outing").closest("li")).not.toContainElement(alert);
      expect(scrolled.mock.contexts).toEqual([alert, start]);
      /* At the largest text the title alone is 100 to 200px over the button,
         and with it the two no longer fit above the nav. */
      const title = screen.getByRole("link", { name: /Draft outing/ });
      for (const each of scrolled.mock.contexts) expect(each).not.toContainElement(title);
    } finally {
      scrolled.mockRestore();
    }
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

  /* The list draws New session's form again: landing inside the input event
     of a name being typed, it must not put back the empty name (#171). */
  it("keeps a name typed in New session as the list lands", async () => {
    const user = userEvent.setup();
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions?")
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve({
            data: [],
            pagination: { limit: 100, offset: 0, total: 0, hasMore: false },
          }),
    );
    render(<AdminSessions />);
    await user.click(screen.getByRole("button", { name: "New session" }));
    await screen.findByText("Add households to the follow-up list first.");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions?limit=25");
    });
    const field = screen.getByLabelText<HTMLInputElement>("Name this session");

    await landWhileTyping(field, "Saturday morning", () => {
      answer(page([session("s1", "June outing", "draft")]));
    });

    expect(field).toHaveValue("Saturday morning");
    expect(await screen.findByText("June outing")).toBeInTheDocument();
    expect(field).toHaveValue("Saturday morning");
  });

  it("offers a retry when the list fails to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AdminSessions />);

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the sessions.");
    // Only the list failed: a session can still be created.
    expect(screen.getByRole("button", { name: "New session" })).toBeEnabled();

    apiFetch.mockResolvedValue(page([session("s1", "June outing", "active")]));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("June outing")).toBeInTheDocument();
  });

  it("shows the server's sentence when it refuses the list", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "Admins only." } }),
    );
    render(<AdminSessions />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Admins only.");
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

  it("leads to the follow-up list and the other admin screens", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions />);
    const screens = await screen.findByRole("navigation", { name: "Admin screens" });
    expect(
      within(screens)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Follow-up list", "/admin/follow-ups"],
      ["Needs a return visit", "/admin/attention"],
      ["All records", "/admin/history"],
      ["Team", "/admin/team"],
    ]);
  });

  it("puts New session first, then the notices, then the links, so it is in reach on a short phone", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AdminSessions notices={<p>2 suggestions to review</p>} />);
    const order = [
      await screen.findByRole("button", { name: "New session" }),
      screen.getByText("2 suggestions to review"),
      screen.getByRole("navigation", { name: "Admin screens" }),
      await screen.findByText("No sessions yet."),
    ];
    order.slice(1).forEach((later, i) => {
      const earlier = order[i];
      if (earlier === undefined) throw new Error("expected an earlier element");
      expect(
        earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("offers New session, the notices and the links while the list is still loading", () => {
    apiFetch.mockReturnValue(new Promise(() => undefined));
    render(<AdminSessions notices={<p>2 overdue follow-ups</p>} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New session" })).toBeEnabled();
    expect(screen.getByText("2 overdue follow-ups")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
  });
});
