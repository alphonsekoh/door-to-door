import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewCountCard } from "@/components/follow-ups/review-count-card";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const total = (count: number) => ({
  data: [],
  pagination: { limit: 1, offset: 0, total: count, hasMore: count > 1 },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReviewCountCard", () => {
  it("counts suggestions from the list's own total, one row asked for", async () => {
    apiFetch.mockResolvedValue(total(12));
    render(<ReviewCountCard />);
    expect(await screen.findByText("12 suggestions to review")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups?status=suggested&limit=1");
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/admin/follow-ups?tab=review",
    );
  });

  it("says one suggestion without a plural", async () => {
    apiFetch.mockResolvedValue(total(1));
    render(<ReviewCountCard />);
    expect(await screen.findByText("1 suggestion to review")).toBeInTheDocument();
  });

  it("is hidden when nothing waits", async () => {
    apiFetch.mockResolvedValue(total(0));
    const { container } = render(<ReviewCountCard />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when it cannot check, without blocking the page", async () => {
    apiFetch.mockRejectedValue(new TypeError("offline"));
    render(<ReviewCountCard />);
    expect(await screen.findByText("Could not check for suggestions.")).toBeInTheDocument();
  });
});
