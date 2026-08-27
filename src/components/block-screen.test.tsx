import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { BlockScreen } from "@/components/block-screen";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

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
    latestVisit: null,
    outstandingFollowUps: 0,
  })),
  pagination: { limit: 100, offset: 0, total: units.length, hasMore: false },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BlockScreen", () => {
  it("loads the units already recorded on this block", async () => {
    apiFetch.mockResolvedValue(list(["#05-123", "#05-124"]));
    render(<BlockScreen blockId="b1" />);
    expect(await screen.findByText("2 units recorded here.")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/households?blockId=b1&limit=100");
  });

  it("uses the singular for one unit", async () => {
    apiFetch.mockResolvedValue(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    expect(await screen.findByText("1 unit recorded here.")).toBeInTheDocument();
  });

  it("says so plainly when nothing has been recorded yet", async () => {
    apiFetch.mockResolvedValue(list([]));
    render(<BlockScreen blockId="b1" />);
    expect(await screen.findByText("No units recorded here yet.")).toBeInTheDocument();
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

  it("reloads the unit list after a visit is recorded", async () => {
    apiFetch.mockResolvedValue(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByText("1 unit recorded here.");

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({});
    apiFetch.mockResolvedValueOnce(list(["#05-123", "#05-124"]));

    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(screen.getByText("2 units recorded here.")).toBeInTheDocument();
    });
  });
});
