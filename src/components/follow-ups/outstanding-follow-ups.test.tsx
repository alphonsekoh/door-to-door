import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutstandingFollowUps } from "@/components/follow-ups/outstanding-follow-ups";
import type { FollowUp } from "@/generated/types.gen";

function note(id: string, text: string, dueDate: string | null = null): FollowUp {
  return {
    id,
    householdId: `h-${id}`,
    blockId: "b1",
    blockName: "123",
    unitNumber: `#05-${id}`,
    visitId: null,
    status: "listed",
    author: { id: "u1", name: "Alice", image: null },
    note: text,
    dueDate,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
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

  it("names the door each note was left at", () => {
    render(<OutstandingFollowUps notes={[note("1", "Bring the book back")]} />);
    expect(screen.getByRole("link", { name: /Blk 123 · #05-1/ })).toBeInTheDocument();
  });

  it("shows a due date when the note has one", () => {
    const due = new Date(2099, 3, 2).toISOString();
    render(<OutstandingFollowUps notes={[note("1", "Call back", due)]} />);
    expect(screen.getByText("Due 2 Apr 2099")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("marks a note whose day has passed as overdue", () => {
    render(<OutstandingFollowUps notes={[note("1", "Call back", "2020-01-01T00:00:00.000Z")]} />);
    expect(screen.getByRole("link", { name: /Call back/ })).toHaveTextContent("Overdue");
  });

  it("lists the soonest due first and undated last", () => {
    render(
      <OutstandingFollowUps
        notes={[
          note("1", "Undated"),
          note("2", "Later", "2099-06-01T00:00:00.000Z"),
          note("3", "Sooner", "2099-01-01T00:00:00.000Z"),
        ]}
      />,
    );
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      expect.stringContaining("Sooner"),
      expect.stringContaining("Later"),
      expect.stringContaining("Undated"),
    ]);
  });

  it("omits the due line for an undated note", () => {
    render(<OutstandingFollowUps notes={[note("1", "Call back")]} />);
    expect(screen.queryByText(/^Due /)).not.toBeInTheDocument();
  });
});
