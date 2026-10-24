import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeclinedNotice } from "@/components/follow-ups/declined-notice";
import type { FollowUp } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const declined = (id: string, over: Partial<FollowUp> = {}): FollowUp => ({
  id,
  householdId: "h1",
  blockId: "b1",
  blockName: "123",
  unitNumber: `#05-${id}`,
  visitId: null,
  status: "suggested",
  author: { id: "u1", name: "Ann", image: null },
  note: `Suggestion ${id}`,
  dueDate: null,
  doneAt: null,
  doneBy: null,
  listedAt: null,
  listedBy: null,
  deletedAt: new Date(2026, 9, 20, 12).toISOString(),
  deletedBy: { id: "admin", name: "Admin", image: null },
  deleteReason: "Visited last week",
  waitingSuggestionBy: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const page = (data: FollowUp[]) => ({
  data,
  pagination: { limit: 20, offset: 0, total: data.length, hasMore: false },
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DeclinedNotice", () => {
  it("asks only for the member's own removed notes, of either kind", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<DeclinedNotice userId="u1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups?deleted=true&authorId=u1&limit=20");
    });
  });

  it("says which suggestions were declined and which notes came off the list, by whom and why", async () => {
    apiFetch.mockResolvedValue(
      page([
        declined("1"),
        declined("2", { status: "listed", deleteReason: "The family has moved" }),
        declined("3", { deleteReason: null }),
      ]),
    );
    render(<DeclinedNotice userId="u1" />);
    const card = within(await screen.findByRole("region", { name: "Not on the follow-up list" }));
    expect(card.getByText("Suggestion 1")).toBeVisible();
    expect(card.getByText("Declined by Admin · 20 Oct 2026: Visited last week")).toBeVisible();
    expect(
      card.getByText(
        "Removed from the follow-up list by Admin · 20 Oct 2026: The family has moved",
      ),
    ).toBeVisible();
    // Removed before a reason was required.
    expect(card.getByText("Declined by Admin · 20 Oct 2026")).toBeVisible();
  });

  it("leaves out a suggestion the member withdrew themself, which is not news to them", async () => {
    apiFetch.mockResolvedValue(
      page([declined("1", { deletedBy: { id: "u1", name: "Ann", image: null } })]),
    );
    render(<DeclinedNotice userId="u1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("hides one for good on this phone with Got it", async () => {
    apiFetch.mockResolvedValue(page([declined("1"), declined("2")]));
    const { unmount } = render(<DeclinedNotice userId="u1" />);
    const [first] = await screen.findAllByRole("button", { name: "Got it" });
    if (first === undefined) throw new Error("expected a notice");
    fireEvent.click(first);
    expect(screen.queryByText("Suggestion 1")).toBeNull();
    expect(screen.getByText("Suggestion 2")).toBeVisible();

    unmount();
    render(<DeclinedNotice userId="u1" />);
    expect(await screen.findByText("Suggestion 2")).toBeVisible();
    expect(screen.queryByText("Suggestion 1")).toBeNull();
  });

  it("shows nothing when the list cannot be read", async () => {
    apiFetch.mockRejectedValue(new TypeError("offline"));
    render(<DeclinedNotice userId="u1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    expect(screen.queryByRole("region")).toBeNull();
  });
});
