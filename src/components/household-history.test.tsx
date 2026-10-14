import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HouseholdHistoryPanel } from "@/components/household-history";
import type { FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1",
  householdId: "h1",
  sessionId: "s1",
  member: { id: "u1", name: "Alice", image: null },
  team: null,
  interestLevel: "medium",
  description: "Listened for a while.",
  clientCreatedAt: "2026-03-14T10:00:00.000Z",
  createdAt: "2026-03-14T10:00:00.000Z",
  updatedAt: "2026-03-14T10:00:00.000Z",
  ...over,
});

const note = (over: Partial<FollowUp> = {}): FollowUp => ({
  id: "f1",
  householdId: "h1",
  visitId: null,
  author: { id: "u1", name: "Alice", image: null },
  note: "Bring the flyer.",
  dueDate: null,
  doneAt: null,
  doneBy: null,
  createdAt: "2026-03-14T10:00:00.000Z",
  ...over,
});

const history = (over: Partial<HouseholdHistory> = {}): HouseholdHistory => ({
  household: {
    id: "h1",
    blockId: "b1",
    unitNumber: "#05-123",
    name: "Mr Tan",
    contact: "+65 9000 0000",
    religion: "buddhist",
    createdAt: "2026-03-14T10:00:00.000Z",
    updatedAt: "2026-03-14T10:00:00.000Z",
  },
  block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: "" },
  visits: [visit()],
  followUps: [],
  ...over,
});

describe("what is known about the unit", () => {
  it("leads with the name", () => {
    render(<HouseholdHistoryPanel history={history()} />);
    expect(screen.getByText("Mr Tan")).toBeInTheDocument();
  });

  it("says plainly when nobody has ever answered", () => {
    // Better than a blank space, which reads as a loading bug.
    const unknown = history();
    render(
      <HouseholdHistoryPanel
        history={{ ...unknown, household: { ...unknown.household, name: null } }}
      />,
    );
    expect(screen.getByText("Nobody has answered here yet")).toBeInTheDocument();
  });

  it("shows a contact when there is one", () => {
    render(<HouseholdHistoryPanel history={history()} />);
    expect(screen.getByText("+65 9000 0000")).toBeInTheDocument();
  });

  it("omits the contact line entirely when unknown", () => {
    const h = history();
    render(
      <HouseholdHistoryPanel history={{ ...h, household: { ...h.household, contact: null } }} />,
    );
    expect(screen.queryByText("+65 9000 0000")).not.toBeInTheDocument();
  });
});

describe("outstanding follow-ups", () => {
  it("surfaces a promise made last time", () => {
    /*
     * The point of the panel: arriving at the door knowing what was promised,
     * rather than finding out afterwards.
     */
    render(<HouseholdHistoryPanel history={history({ followUps: [note()] })} />);
    expect(screen.getByText("Outstanding follow-up")).toBeInTheDocument();

    // Scoped to the note itself: Alice also appears as the previous visitor.
    const item = screen.getByText(/Bring the flyer/);
    expect(item).toHaveTextContent("Alice");
  });

  it("pluralises for several", () => {
    render(
      <HouseholdHistoryPanel
        history={history({ followUps: [note(), note({ id: "f2", note: "And call back." })] })}
      />,
    );
    expect(screen.getByText("Outstanding follow-ups")).toBeInTheDocument();
  });

  it("hides notes that are already done", () => {
    render(
      <HouseholdHistoryPanel
        history={history({ followUps: [note({ doneAt: "2026-04-01T00:00:00.000Z" })] })}
      />,
    );
    expect(screen.queryByText("Outstanding follow-up")).not.toBeInTheDocument();
  });

  it("falls back when the author has no name", () => {
    render(
      <HouseholdHistoryPanel
        history={history({
          followUps: [note({ author: { id: "u9", name: null, image: null } })],
        })}
      />,
    );
    expect(screen.getByText(/someone/)).toBeInTheDocument();
  });
});

describe("previous visits", () => {
  it("labels the interest level readably", () => {
    render(<HouseholdHistoryPanel history={history({ visits: [visit()] })} />);
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("labels a silent door as No response, not no_response", () => {
    render(
      <HouseholdHistoryPanel
        history={history({ visits: [visit({ interestLevel: "no_response", description: "" })] })}
      />,
    );
    expect(screen.getByText("No response")).toBeInTheDocument();
  });

  it("names who recorded it", () => {
    render(<HouseholdHistoryPanel history={history()} />);
    const list = screen.getByRole("list");
    expect(within(list).getByText(/Alice/)).toBeInTheDocument();
  });

  it("falls back when the member has no name", () => {
    render(
      <HouseholdHistoryPanel
        history={history({ visits: [visit({ member: { id: "u9", name: null, image: null } })] })}
      />,
    );
    expect(screen.getByText("Someone")).toBeInTheDocument();
  });

  it("names the teammates who were there and the team, on each visit", () => {
    const teamed = visit({
      id: "v2",
      member: { id: "u1", name: "Alice Tan", image: null },
      team: {
        id: "t1",
        name: "Alice & Ben",
        members: [
          { id: "u2", name: "Ben Lim", image: null },
          { id: "u3", name: "Chris Ong", image: null },
        ],
      },
    });
    render(<HouseholdHistoryPanel history={history({ visits: [visit(), teamed] })} />);
    const [solo, paired] = within(screen.getByRole("list")).getAllByRole("listitem");
    if (solo === undefined || paired === undefined) throw new Error("expected two visits");
    expect(within(solo).getByText("Alice")).toBeInTheDocument();
    expect(within(solo).queryByText(/Team:/)).not.toBeInTheDocument();
    expect(within(paired).getByText("Alice Tan with Ben Lim, Chris Ong")).toBeInTheDocument();
    expect(within(paired).getByText("Team: Alice & Ben")).toBeInTheDocument();
  });

  it("omits an empty description rather than leaving a gap", () => {
    render(<HouseholdHistoryPanel history={history({ visits: [visit({ description: "" })] })} />);
    expect(screen.queryByText("Listened for a while.")).not.toBeInTheDocument();
  });

  it("renders nothing for a unit with no visits", () => {
    render(<HouseholdHistoryPanel history={history({ visits: [] })} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows an unrecognised level as-is rather than blank", () => {
    render(
      <HouseholdHistoryPanel
        history={history({ visits: [visit({ interestLevel: "unknown" as never })] })}
      />,
    );
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });
});
