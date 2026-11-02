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

const page = (data: FollowUp[], hasMore = false) => ({
  data,
  pagination: { limit: 100, offset: 0, total: data.length, hasMore },
});

/* Newest removal first, as the server sends them. */
const five = ["1", "2", "3", "4", "5"].map((id) => declined(id));

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
  it("asks only for the member's own notes removed by others in the last thirty days", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<DeclinedNotice userId="u1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/follow-ups?deleted=true&authorId=u1&removedByOthers=true&deletedSince=${encodeURIComponent(
          new Date(new Date(2026, 9, 23, 12).getTime() - 30 * 86_400_000).toISOString(),
        )}&limit=100&offset=0`,
      );
    });
  });

  it("reads every page, so no removal is left out", async () => {
    apiFetch
      .mockResolvedValueOnce(page([declined("1")], true))
      .mockResolvedValueOnce(page([declined("2")]));
    render(<DeclinedNotice userId="u1" />);
    expect(await screen.findByText("Suggestion 2")).toBeVisible();
    expect(screen.getByText("Suggestion 1")).toBeVisible();
    expect(String(apiFetch.mock.calls[1]?.[0])).toContain("offset=1");
  });

  it("shows nothing when a later page cannot be read", async () => {
    apiFetch
      .mockResolvedValueOnce(page([declined("1")], true))
      .mockRejectedValueOnce(new TypeError("offline"));
    render(<DeclinedNotice userId="u1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("region")).toBeNull();
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

  it("shows the newest three, and the rest on Show all", async () => {
    apiFetch.mockResolvedValue(page(five));
    render(<DeclinedNotice userId="u1" />);
    const card = within(await screen.findByRole("region", { name: "Not on the follow-up list" }));
    expect(card.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Suggestion 1"),
      expect.stringContaining("Suggestion 2"),
      expect.stringContaining("Suggestion 3"),
    ]);
    const toggle = card.getByRole("button", { name: "Show all (5)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(card.getAllByRole("listitem")).toHaveLength(5);
    expect(card.getByText("Suggestion 5")).toBeVisible();
    expect(card.getByRole("button", { name: "Show fewer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(card.getByRole("button", { name: "Show fewer" }));
    expect(card.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says how many there are, and offers Got it to all, above the notes", async () => {
    apiFetch.mockResolvedValue(page(five));
    render(<DeclinedNotice userId="u1" />);
    const card = within(await screen.findByRole("region", { name: "Not on the follow-up list" }));
    const [firstNote] = card.getAllByRole("listitem");
    if (firstNote === undefined) throw new Error("expected a note");
    for (const control of [
      card.getByRole("button", { name: "Show all (5)" }),
      card.getByRole("button", { name: "Got it to all" }),
    ]) {
      expect(control.compareDocumentPosition(firstNote)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("moves the next one up when one is acknowledged", async () => {
    apiFetch.mockResolvedValue(page(five));
    render(<DeclinedNotice userId="u1" />);
    const [first] = await screen.findAllByRole("button", { name: "Got it" });
    if (first === undefined) throw new Error("expected a notice");
    fireEvent.click(first);
    expect(screen.queryByText("Suggestion 1")).toBeNull();
    expect(screen.getByText("Suggestion 4")).toBeVisible();
    expect(screen.queryByText("Suggestion 5")).toBeNull();
    expect(screen.getByRole("button", { name: "Show all (4)" })).toBeInTheDocument();
  });

  it("acknowledges them all at once on this phone with Got it to all", async () => {
    apiFetch.mockResolvedValue(page(five));
    const { unmount } = render(<DeclinedNotice userId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Got it to all" }));
    expect(screen.queryByRole("region")).toBeNull();

    unmount();
    render(<DeclinedNotice userId="u1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("offers neither Show all nor Got it to all for a single note", async () => {
    apiFetch.mockResolvedValue(page([declined("1")]));
    render(<DeclinedNotice userId="u1" />);
    expect(await screen.findByRole("button", { name: "Got it" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Got it to all" })).toBeNull();
  });

  it("offers Got it to all but no Show all for two", async () => {
    apiFetch.mockResolvedValue(page([declined("1"), declined("2")]));
    render(<DeclinedNotice userId="u1" />);
    expect(await screen.findByRole("button", { name: "Got it to all" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
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
