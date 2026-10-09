import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionList, daysSince, sinceLabel } from "@/components/attention-list";
import type { HouseholdAttention, InterestLevel } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const AT = "2026-03-14T11:00:00.000Z";

function row(
  unitNumber: string,
  options: {
    name?: string | null;
    interestLevel?: InterestLevel;
    lastVisitedAt?: string;
    description?: string;
  } = {},
): HouseholdAttention {
  const { name = null, interestLevel = "high", lastVisitedAt = AT, description = "" } = options;
  return {
    household: {
      id: `h-${unitNumber}`,
      blockId: "b1",
      unitNumber,
      name,
      contact: null,
      religion: null,
      createdAt: AT,
      updatedAt: AT,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
    latestVisit: {
      id: `v-${unitNumber}`,
      householdId: `h-${unitNumber}`,
      sessionId: "s1",
      member: { id: "u1", name: "Alice", image: null },
      team: null,
      interestLevel,
      description,
      clientCreatedAt: lastVisitedAt,
      createdAt: lastVisitedAt,
      updatedAt: lastVisitedAt,
    },
    visitCount: 1,
    lastVisitedAt,
  };
}

const page = (rows: HouseholdAttention[], total = rows.length) => ({
  data: rows,
  pagination: { limit: 50, offset: 0, total, hasMore: rows.length < total },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("daysSince", () => {
  it("counts whole days", () => {
    const now = new Date("2026-03-14T11:00:00.000Z");
    expect(daysSince("2026-03-11T11:00:00.000Z", now)).toBe(3);
  });

  it("rounds down, so most of a day is not yet a day", () => {
    const now = new Date("2026-03-14T11:00:00.000Z");
    expect(daysSince("2026-03-13T12:00:00.000Z", now)).toBe(0);
  });
});

describe("sinceLabel", () => {
  it.each([
    [0, "today"],
    [1, "yesterday"],
    [3, "3 days ago"],
    [60, "60 days ago"],
    [90, "3 months ago"],
  ])("reads %s days as %s", (days, label) => {
    expect(sinceLabel(days)).toBe(label);
  });

  it("treats a visit dated in the future as today rather than negative", () => {
    // A device with a wrong clock can queue a visit stamped ahead of now.
    expect(sinceLabel(-2)).toBe("today");
  });
});

describe("AttentionList", () => {
  it("lists the doors that showed interest and were left", async () => {
    apiFetch.mockResolvedValue(page([row("#05-123", { name: "Mr Tan" })]));
    render(<AttentionList />);

    expect(await screen.findByText("Blk 123, #05-123")).toBeInTheDocument();
    expect(screen.getByText(/Mr Tan/)).toBeInTheDocument();
  });

  it("asks for high interest only by default", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AttentionList />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/households/attention?limit=50");
    });
  });

  it("widens to medium when asked, and back again", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(page([row("#05-123")]));
    render(<AttentionList />);
    await screen.findByText("Blk 123, #05-123");

    await user.click(screen.getByRole("button", { name: "Include medium interest" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/households/attention?limit=50&minimumInterest=medium",
      );
    });

    await user.click(screen.getByRole("button", { name: "High interest only" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenLastCalledWith("/households/attention?limit=50");
    });
  });

  it("says how long the door has been waiting", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    apiFetch.mockResolvedValue(page([row("#05-123", { lastVisitedAt: threeDaysAgo })]));
    render(<AttentionList />);

    expect(await screen.findByText(/last visited 3 days ago/)).toBeInTheDocument();
  });

  it("shows the interest level in words", async () => {
    apiFetch.mockResolvedValue(page([row("#05-123", { interestLevel: "medium" })]));
    render(<AttentionList />);
    expect(await screen.findByText("Medium")).toBeInTheDocument();
  });

  it("carries the note from the visit that put it on the list", async () => {
    apiFetch.mockResolvedValue(page([row("#05-123", { description: "Asked for a Bible" })]));
    render(<AttentionList />);
    expect(await screen.findByText("Asked for a Bible")).toBeInTheDocument();
  });

  it("links to the unit's full timeline", async () => {
    apiFetch.mockResolvedValue(page([row("#05-123")]));
    render(<AttentionList />);

    expect(await screen.findByRole("link", { name: /#05-123/ })).toHaveAttribute(
      "href",
      "/households/h-#05-123",
    );
  });

  it("reads as good news when nothing is waiting", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<AttentionList />);
    expect(await screen.findByText("Nothing is waiting.")).toBeInTheDocument();
  });

  it("says when the list is longer than the page", async () => {
    apiFetch.mockResolvedValue(page([row("#05-123")], 120));
    render(<AttentionList />);
    expect(await screen.findByText("Showing the 1 longest-waiting of 120.")).toBeInTheDocument();
  });

  it("offers a retry when the list fails to load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<AttentionList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");

    apiFetch.mockResolvedValue(page([row("#05-123")]));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Blk 123, #05-123")).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<AttentionList />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the list.");
  });
});
