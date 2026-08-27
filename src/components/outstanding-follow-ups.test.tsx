import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutstandingFollowUps } from "@/components/outstanding-follow-ups";
import type { FollowUp } from "@/generated/types.gen";

function note(id: string, text: string, dueDate: string | null = null): FollowUp {
  return {
    id,
    householdId: `h-${id}`,
    visitId: null,
    author: { id: "u1", name: "Alice", image: null },
    note: text,
    dueDate,
    doneAt: null,
    doneBy: null,
    createdAt: "2026-03-14T10:00:00.000Z",
  };
}

describe("OutstandingFollowUps", () => {
  it("renders nothing when the member owes none", () => {
    const { container } = render(<OutstandingFollowUps notes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts them in the heading", () => {
    render(<OutstandingFollowUps notes={[note("1", "Bring the book back")]} />);
    expect(screen.getByText("1 follow-up you still owe")).toBeInTheDocument();
  });

  it("uses the plural for several", () => {
    render(<OutstandingFollowUps notes={[note("1", "One"), note("2", "Two")]} />);
    expect(screen.getByText("2 follow-ups you still owe")).toBeInTheDocument();
  });

  it("links each note to the unit it was left at", () => {
    render(<OutstandingFollowUps notes={[note("1", "Bring the book back")]} />);
    expect(screen.getByRole("link", { name: /Bring the book back/ })).toHaveAttribute(
      "href",
      "/households/h-1",
    );
  });

  it("shows a due date when the note has one", () => {
    const due = new Date(2026, 3, 2, 12).toISOString();
    render(<OutstandingFollowUps notes={[note("1", "Call back", due)]} />);
    expect(screen.getByText(`Due ${new Date(due).toLocaleDateString()}`)).toBeInTheDocument();
  });

  it("omits the due line for an undated note", () => {
    render(<OutstandingFollowUps notes={[note("1", "Call back")]} />);
    expect(screen.queryByText(/^Due /)).not.toBeInTheDocument();
  });
});
