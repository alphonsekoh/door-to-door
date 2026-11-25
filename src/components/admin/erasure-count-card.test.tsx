import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErasureCountCard } from "@/components/admin/erasure-count-card";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch }));

const page = (total: number) => ({
  data: [],
  pagination: { limit: 1, offset: 0, total, hasMore: false },
  lastRetentionRun: null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ErasureCountCard (#279)", () => {
  it("says how many requests wait, and leads to them", async () => {
    apiFetch.mockResolvedValue(page(3));
    render(<ErasureCountCard />);
    const card = await screen.findByRole("region", { name: "Erasure requests" });
    expect(card).toHaveTextContent("3 erasure requests waiting");
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/admin/privacy");
    expect(apiFetch).toHaveBeenCalledWith("/erasure-requests?status=open&limit=1");
  });

  it("says one request without a plural", async () => {
    apiFetch.mockResolvedValue(page(1));
    render(<ErasureCountCard />);
    expect(await screen.findByText("1 erasure request waiting")).toBeVisible();
  });

  it.each([
    ["none wait", () => Promise.resolve(page(0))],
    ["the count could not be read", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("is hidden when %s", async (_case, answer) => {
    apiFetch.mockImplementation(answer);
    const { container } = render(<ErasureCountCard />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing from an answer that lands after it is gone", async () => {
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { unmount, container } = render(<ErasureCountCard />);
    unmount();
    answer(page(2));
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});
