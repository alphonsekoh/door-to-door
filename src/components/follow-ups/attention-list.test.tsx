import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttentionList,
  daysSince,
  sinceLabel,
  whyHere,
} from "@/components/follow-ups/attention-list";
import type { HouseholdAttention, InterestLevel } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

/* A door's label, drawn in pieces so its unit number never breaks: the
   innermost element holding the whole of it. */
const door = (label: string) => (_: string, element: Element | null) =>
  element?.textContent === label &&
  ![...element.children].some((child) => child.textContent === label);

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

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
  useRole.mockReturnValue({ userId: "a1", isAdmin: true });
  useOnline.mockReturnValue(true);
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

    expect(await screen.findByText(door("Blk 123, #05-123"))).toBeInTheDocument();
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
    await screen.findByText(door("Blk 123, #05-123"));

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
    expect(await screen.findByText(door("Blk 123, #05-123"))).toBeInTheDocument();
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<AttentionList />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the list.");
  });
});

describe("adding a door to the follow-up list", () => {
  it("says why the door is here", () => {
    expect(whyHere(row("#05-123", { lastVisitedAt: new Date(2026, 2, 3, 12).toISOString() }))).toBe(
      "Showed high interest on 3 Mar 2026.",
    );
    expect(
      whyHere(
        row("#05-123", {
          interestLevel: "medium",
          lastVisitedAt: new Date(2026, 2, 3, 12).toISOString(),
        }),
      ),
    ).toBe("Showed medium interest on 3 Mar 2026.");
  });

  it("adds a row's household, anchored to its latest visit, then re-reads the list", async () => {
    const user = userEvent.setup();
    let added = false;
    apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      // No follow-up session to offer as well.
      if (path.startsWith("/sessions?")) return Promise.resolve({ data: [] });
      if (init?.method === "POST") {
        added = true;
        return Promise.resolve({});
      }
      return Promise.resolve(page(added ? [] : [row("#05-123")]));
    });
    render(<AttentionList />);
    await user.click(await screen.findByRole("button", { name: "Add to list" }));

    const sheet = within(
      screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" }),
    );
    // Why it is here is said, not saved as what the next visit should do.
    expect(sheet.getByText(whyHere(row("#05-123")))).toBeVisible();
    expect(sheet.getByLabelText("What should the next visit do?")).toHaveValue("");
    await user.type(sheet.getByLabelText("What should the next visit do?"), "Bring the booklet");
    const add = sheet.getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    await user.click(add);

    expect(await screen.findByRole("status")).toHaveTextContent("Added to the follow-up list.");
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
      method: "POST",
      body: JSON.stringify({
        householdId: "h-#05-123",
        visitId: "v-#05-123",
        note: "Bring the booklet",
        dueDate: null,
      }),
    });
    // Listed now, so it has left this list.
    expect(await screen.findByText("Nothing is waiting.")).toBeInTheDocument();
  });

  it("puts the action beside the row, never inside its link", async () => {
    apiFetch.mockResolvedValue(page([row("#05-123")]));
    render(<AttentionList />);
    const button = await screen.findByRole("button", { name: "Add to list" });
    expect(button.closest("a")).toBeNull();
  });

  it("closes without a request on Cancel", async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith("/sessions?") ? { data: [] } : page([row("#05-123")])),
    );
    render(<AttentionList />);
    await user.click(await screen.findByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(apiFetch).not.toHaveBeenCalledWith("/follow-ups", expect.anything());
  });
});
