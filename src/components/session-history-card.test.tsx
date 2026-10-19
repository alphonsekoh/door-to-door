import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionHistoryCard } from "@/components/session-history-card";
import type { Block, SessionHistorySummary } from "@/generated/types.gen";
import { formatDay } from "@/lib/dates";

const block = (id: string, name: string): Block => ({
  id,
  name,
  street: "Test Ave",
  postalCode: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

function summaryFor(overrides: Partial<SessionHistorySummary> = {}): SessionHistorySummary {
  const first = new Date(2026, 2, 14, 19).toISOString();
  return {
    session: {
      id: "s1",
      title: "March outing",
      status: "ended",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: "2026-03-01T00:00:00.000Z",
    },
    blocks: [block("b1", "123")],
    visitCount: 3,
    householdCount: 3,
    interest: { low: 1, medium: 1, high: 1, noResponse: 0 },
    firstRecordedAt: first,
    lastRecordedAt: first,
    ...overrides,
  };
}

describe("SessionHistoryCard", () => {
  it("links to the outing's own records", () => {
    render(<SessionHistoryCard summary={summaryFor()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/history/s1");
  });

  it("names the blocks the member worked", () => {
    render(
      <SessionHistoryCard
        summary={summaryFor({ blocks: [block("b1", "123"), block("b2", "125")] })}
      />,
    );
    expect(screen.getByText("Blk 123, Blk 125")).toBeInTheDocument();
  });

  it("shows one date for an outing worked in an evening", () => {
    const day = formatDay(new Date(2026, 2, 14, 19));
    render(<SessionHistoryCard summary={summaryFor()} />);
    expect(screen.getByText(day)).toBeInTheDocument();
  });

  it("shows both ends when the member's records span days", () => {
    // A reopened outing, or one that ran past midnight.
    const from = new Date(2026, 2, 14, 22).toISOString();
    const to = new Date(2026, 2, 15, 1).toISOString();
    render(
      <SessionHistoryCard summary={summaryFor({ firstRecordedAt: from, lastRecordedAt: to })} />,
    );
    expect(screen.getByText(`${formatDay(from)} – ${formatDay(to)}`)).toBeInTheDocument();
  });

  it("separates units from visits only when they differ", () => {
    const { rerender } = render(<SessionHistoryCard summary={summaryFor()} />);
    expect(screen.queryByText(/visits/)).not.toBeInTheDocument();

    rerender(<SessionHistoryCard summary={summaryFor({ visitCount: 5, householdCount: 3 })} />);
    expect(screen.getByText(/5 visits/)).toBeInTheDocument();
  });

  it("uses the singular for a single unit", () => {
    render(<SessionHistoryCard summary={summaryFor({ visitCount: 1, householdCount: 1 })} />);
    expect(screen.getByText(/unit/)).toBeInTheDocument();
    expect(screen.queryByText(/units/)).not.toBeInTheDocument();
  });

  it("says so plainly when no block came back with the outing", () => {
    render(<SessionHistoryCard summary={summaryFor({ blocks: [] })} />);
    expect(screen.getByText("No blocks recorded")).toBeInTheDocument();
  });
});
