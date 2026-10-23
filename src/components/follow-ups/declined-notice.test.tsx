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
  it("asks only for the member's own removed suggestions", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<DeclinedNotice userId="u1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/follow-ups?deleted=true&authorId=u1&status=suggested&limit=20",
      );
    });
  });

  it("says which suggestions were not added, by whom, and why", async () => {
    apiFetch.mockResolvedValue(page([declined("1"), declined("2", { deleteReason: null })]));
    render(<DeclinedNotice userId="u1" />);
    const card = within(
      await screen.findByRole("region", { name: "Not added to the follow-up list" }),
    );
    expect(card.getByText("Suggestion 1")).toBeVisible();
    expect(card.getAllByText("Declined by Admin · 20 Oct 2026")).toHaveLength(2);
    expect(card.getByText("Reason: Visited last week")).toBeVisible();
    expect(card.getAllByText(/^Reason:/)).toHaveLength(1);
  });

  it("leaves out a suggestion the member withdrew themself", async () => {
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

  it("ignores an answer that lands after the screen has gone", async () => {
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { unmount } = render(<DeclinedNotice userId="u1" />);
    unmount();
    answer(page([declined("1")]));
    await Promise.resolve();
    expect(screen.queryByText("Suggestion 1")).toBeNull();
  });
});
