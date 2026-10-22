import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverdueFollowUps } from "@/components/follow-ups/overdue-follow-ups";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { startOfToday } from "@/lib/follow-ups";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const note = (id: string): FollowUp => ({
  id,
  householdId: `h-${id}`,
  blockName: "123",
  unitNumber: `#05-${id}`,
  visitId: null,
  author: { id: "u1", name: "Alice", image: null },
  note: `Note ${id}`,
  dueDate: "2020-01-01T00:00:00.000Z",
  doneAt: null,
  doneBy: null,
  createdAt: "2019-12-01T00:00:00.000Z",
});

const page = (data: FollowUp[], total: number): FollowUpList => ({
  data,
  pagination: { limit: 5, offset: 0, total, hasMore: data.length < total },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OverdueFollowUps", () => {
  it("asks only for notes whose due day has passed, five at most", async () => {
    apiFetch.mockResolvedValue(page([], 0));
    render(<OverdueFollowUps />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        `/follow-ups?outstanding=true&dueBefore=${encodeURIComponent(startOfToday(new Date()))}&limit=5`,
      );
    });
  });

  it("is hidden when nothing is overdue", async () => {
    apiFetch.mockResolvedValue(page([], 0));
    const { container } = render(<OverdueFollowUps />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("counts every overdue note and lists the first five, each linking to its door", async () => {
    const shown = ["1", "2", "3", "4", "5"].map(note);
    apiFetch.mockResolvedValue(page(shown, 12));
    render(<OverdueFollowUps />);

    expect(
      await screen.findByRole("heading", { name: "12 overdue follow-ups" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Blk 123 · #05-1/ })).toHaveAttribute(
      "href",
      "/households/h-1",
    );
    expect(screen.getAllByRole("link", { name: /Blk 123/ })).toHaveLength(5);
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/follow-ups");
  });

  it("uses the singular for one", async () => {
    apiFetch.mockResolvedValue(page([note("1")], 1));
    render(<OverdueFollowUps />);
    expect(await screen.findByRole("heading", { name: "1 overdue follow-up" })).toBeInTheDocument();
  });

  it("notes a failed load without blocking anything", async () => {
    apiFetch.mockRejectedValue(new TypeError("offline"));
    render(<OverdueFollowUps />);
    expect(await screen.findByText("Could not check for overdue follow-ups.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
