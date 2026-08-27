import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { BlockScreen } from "@/components/block-screen";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

const list = (units: string[]) => ({
  data: units.map((unitNumber, i) => ({
    household: {
      id: `h${String(i)}`,
      blockId: "b1",
      unitNumber,
      name: null,
      contact: null,
      religion: null,
      createdAt: "",
      updatedAt: "",
    },
    visitCount: 1,
    latestVisit: {
      id: `v${String(i)}`,
      householdId: `h${String(i)}`,
      sessionId: "s1",
      member: { id: "u1", name: "Ben Lim", image: null },
      interestLevel: "low" as const,
      description: "",
      clientCreatedAt: "",
      createdAt: "",
      updatedAt: "",
    },
    outstandingFollowUps: 0,
  })),
  pagination: { limit: 100, offset: 0, total: units.length, hasMore: false },
});

const active = { session: { id: "s1", title: "Tonight" }, blocks: [] };

/* Routes by path so the two loads can differ, and so a test that breaks one
   does not silently satisfy the other. */
function serve(households: unknown, session: unknown = active) {
  apiFetch.mockImplementation((path: string) =>
    path.startsWith("/sessions/active") ? Promise.resolve(session) : Promise.resolve(households),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({
    userId: "u1",
    role: "member",
    isAdmin: false,
    isMember: true,
    isLoading: false,
    isSignedIn: true,
  });
});

describe("BlockScreen", () => {
  it("loads the units already recorded on this block", async () => {
    serve(list(["#05-123", "#05-124"]));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("tab", { name: "Units (2)" })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/households?blockId=b1&limit=100");
  });

  it("opens on the recording form, not the list", async () => {
    // At a door the form is the whole job; the list is for between floors.
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("button", { name: "Save and next" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Record" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the unit list and back", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "Units (1)" });

    await user.click(screen.getByRole("tab", { name: "Units (1)" }));
    expect(screen.getByLabelText("Search this block")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save and next" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Record" }));
    expect(screen.getByRole("button", { name: "Save and next" })).toBeInTheDocument();
  });

  it("still shows the form when the unit list fails to load", async () => {
    // Recording must not depend on the history lookup succeeding.
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
    expect(screen.getByRole("button", { name: "Save and next" })).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<BlockScreen blockId="b1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this block.");
  });

  it("still lists units when the running session cannot be identified", async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions/active")
        ? Promise.reject(new Error("No session is active."))
        : Promise.resolve(list(["#05-123"])),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "Units (1)" });

    await user.click(screen.getByRole("tab", { name: "Units (1)" }));
    expect(screen.getByText("#05-123")).toBeInTheDocument();
    expect(screen.queryByText("tonight")).not.toBeInTheDocument();
  });

  it("reloads the unit list after a visit is recorded", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "Units (1)" });

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/visits") return Promise.resolve({});
      return Promise.resolve(list(["#05-123", "#05-124"]));
    });

    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Units (2)" })).toBeInTheDocument();
    });
  });

  it("reloads the unit list after an amendment", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "Units (1)" });

    await user.click(screen.getByRole("tab", { name: "Units (1)" }));
    await user.click(screen.getByRole("button", { name: /#05-123/ }));
    await user.click(screen.getByRole("radio", { name: "High" }));

    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/visits/v0") return Promise.resolve({});
      return Promise.resolve(list(["#05-123", "#05-124"]));
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Units (2)" })).toBeInTheDocument();
    });
  });
});
