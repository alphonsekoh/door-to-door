import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCountCard } from "@/components/admin/approval-count-card";

const { useApprovalCount } = vi.hoisted(() => ({
  useApprovalCount: vi.fn<(enabled: boolean) => number | null>(),
}));
vi.mock("@/lib/session/approval-count", () => ({ useApprovalCount }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ApprovalCountCard (#249)", () => {
  it("says how many people wait, and leads to Team", () => {
    useApprovalCount.mockReturnValue(4);
    render(<ApprovalCountCard />);
    expect(useApprovalCount).toHaveBeenCalledWith(true);
    const card = screen.getByRole("region", { name: "Waiting for approval" });
    expect(card).toHaveTextContent("4 people waiting for approval");
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/admin/team");
  });

  it("says one person without a plural", () => {
    useApprovalCount.mockReturnValue(1);
    render(<ApprovalCountCard />);
    expect(screen.getByText("1 person waiting for approval")).toBeInTheDocument();
  });

  it.each([
    ["nobody waits", 0],
    ["the count could not be read", null],
  ])("is hidden when %s", (_case, count) => {
    useApprovalCount.mockReturnValue(count);
    const { container } = render(<ApprovalCountCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
