import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HouseholdHistoryPanel } from "@/components/household-history";
import type { FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/use-online", () => ({ useOnline }));

const asViewer = (userId: string, isAdmin = false) => {
  useRole.mockReturnValue({ userId, isAdmin });
};

beforeEach(() => {
  vi.clearAllMocks();
  asViewer("u1");
  useOnline.mockReturnValue(true);
  apiFetch.mockResolvedValue({});
});

const noop = () => undefined;

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
  blockName: "123",
  unitNumber: "#05-123",
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
    render(<HouseholdHistoryPanel onChanged={noop} history={history()} />);
    expect(screen.getByText("Mr Tan")).toBeInTheDocument();
  });

  it("says plainly when nobody has ever answered", () => {
    // Better than a blank space, which reads as a loading bug.
    const unknown = history();
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
        history={{ ...unknown, household: { ...unknown.household, name: null } }}
      />,
    );
    expect(screen.getByText("Nobody has answered here yet")).toBeInTheDocument();
  });

  it("shows a contact when there is one", () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history()} />);
    expect(screen.getByText("+65 9000 0000")).toBeInTheDocument();
  });

  it("omits the contact line entirely when unknown", () => {
    const h = history();
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
        history={{ ...h, household: { ...h.household, contact: null } }}
      />,
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
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [note()] })} />);
    expect(screen.getByText("Outstanding follow-up")).toBeInTheDocument();

    // Scoped to the note itself: Alice also appears as the previous visitor.
    const owed = within(screen.getByRole("list", { name: "Outstanding follow-ups" }));
    expect(owed.getByText("Bring the flyer.")).toBeInTheDocument();
    expect(owed.getByText(/Added by Alice/)).toBeInTheDocument();
  });

  it("pluralises for several", () => {
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
        history={history({ followUps: [note(), note({ id: "f2", note: "And call back." })] })}
      />,
    );
    expect(screen.getByText("Outstanding follow-ups")).toBeInTheDocument();
  });

  it("hides notes that are already done", () => {
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
        history={history({ followUps: [note({ doneAt: "2026-04-01T00:00:00.000Z" })] })}
      />,
    );
    expect(screen.queryByText("Outstanding follow-up")).not.toBeInTheDocument();
  });

  it("falls back when the author has no name", () => {
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
        history={history({
          followUps: [note({ author: { id: "u9", name: null, image: null } })],
        })}
      />,
    );
    expect(screen.getAllByText(/Added by Someone/).length).toBeGreaterThan(0);
  });
});

describe("previous visits", () => {
  it("labels the interest level readably", () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ visits: [visit()] })} />);
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("labels a silent door as No response, not no_response", () => {
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
        history={history({ visits: [visit({ interestLevel: "no_response", description: "" })] })}
      />,
    );
    expect(screen.getByText("No response")).toBeInTheDocument();
  });

  it("names who recorded it", () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history()} />);
    const list = screen.getByRole("list", { name: "Timeline" });
    expect(within(list).getByText(/Alice/)).toBeInTheDocument();
  });

  it("falls back when the member has no name", () => {
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
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
    render(
      <HouseholdHistoryPanel onChanged={noop} history={history({ visits: [visit(), teamed] })} />,
    );
    const [solo, paired] = within(screen.getByRole("list", { name: "Timeline" })).getAllByRole(
      "listitem",
    );
    if (solo === undefined || paired === undefined) throw new Error("expected two visits");
    expect(within(solo).getByText("Alice")).toBeInTheDocument();
    expect(within(solo).queryByText(/Team:/)).not.toBeInTheDocument();
    expect(within(paired).getByText("Alice Tan with Ben Lim, Chris Ong")).toBeInTheDocument();
    expect(within(paired).getByText("Team: Alice & Ben")).toBeInTheDocument();
  });

  it("omits an empty description rather than leaving a gap", () => {
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
        history={history({ visits: [visit({ description: "" })] })}
      />,
    );
    expect(screen.queryByText("Listened for a while.")).not.toBeInTheDocument();
  });

  it("renders nothing for a unit with no visits", () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ visits: [] })} />);
    expect(screen.queryByRole("list", { name: "Timeline" })).not.toBeInTheDocument();
  });

  it("shows an unrecognised level as-is rather than blank", () => {
    render(
      <HouseholdHistoryPanel
        onChanged={noop}
        history={history({ visits: [visit({ interestLevel: "unknown" as never })] })}
      />,
    );
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });
});

describe("the timeline", () => {
  it("puts what is owed first, soonest due, then visits and resolved notes oldest first", () => {
    const notes = [
      note({ id: "undated", note: "Undated note", createdAt: "2026-02-01T00:00:00.000Z" }),
      note({
        id: "dated",
        note: "Dated note",
        dueDate: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      note({
        id: "done",
        note: "Resolved note",
        doneAt: "2026-06-01T00:00:00.000Z",
        doneBy: { id: "u2", name: "Ben Lim", image: null },
        createdAt: "2026-04-01T00:00:00.000Z",
      }),
    ];
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: notes })} />);

    const owed = within(screen.getByRole("list", { name: "Outstanding follow-ups" }));
    expect(owed.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Dated note"),
      expect.stringContaining("Undated note"),
    ]);

    /* What is owed is not repeated below: at the door it pushed the
       interest picker screens down (#35 review). */
    const timeline = within(screen.getByRole("list", { name: "Timeline" }));
    expect(timeline.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Listened for a while."),
      expect.stringContaining("Resolved note"),
    ]);
    expect(screen.getAllByText("Dated note")).toHaveLength(1);
    expect(screen.getAllByText("Undated note")).toHaveLength(1);
  });

  it("moves a note into the timeline, in date order, once it is resolved", () => {
    const resolved = note({
      note: "Old promise",
      doneAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [resolved] })} />);
    expect(screen.queryByRole("list", { name: "Outstanding follow-ups" })).not.toBeInTheDocument();
    const timeline = within(screen.getByRole("list", { name: "Timeline" }));
    expect(timeline.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Old promise"),
      expect.stringContaining("Listened for a while."),
    ]);
  });

  it("says who resolved a note, and when", () => {
    const done = note({
      doneAt: new Date(2026, 5, 9, 12).toISOString(),
      doneBy: { id: "u2", name: "Ben Lim", image: null },
    });
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [done] })} />);
    expect(screen.getByText("Done by Ben Lim · 9 Jun 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("marks an overdue note in words, not only colour", () => {
    const overdue = note({ dueDate: "2020-01-01T00:00:00.000Z" });
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [overdue] })} />);
    const owed = within(screen.getByRole("list", { name: "Outstanding follow-ups" }));
    expect(owed.getByText("Overdue")).toBeInTheDocument();
  });

  it("does not call a note due later overdue", () => {
    const later = note({ dueDate: "2099-01-01T00:00:00.000Z" });
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [later] })} />);
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("offers one Mark done per outstanding note", () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [note()] })} />);
    expect(screen.getAllByRole("button", { name: "Mark done" })).toHaveLength(1);
  });
});

describe("acting on a note", () => {
  it("marks it done with one request on a double tap, then asks for a re-read", async () => {
    const onChanged = vi.fn();
    render(
      <HouseholdHistoryPanel onChanged={onChanged} history={history({ followUps: [note()] })} />,
    );
    const button = screen.getByRole("button", { name: "Mark done" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1", {
      method: "PATCH",
      body: JSON.stringify({ done: true }),
    });
  });

  it("reopens a resolved note with done alone", async () => {
    const onChanged = vi.fn();
    const done = note({ doneAt: "2026-04-01T00:00:00.000Z", doneBy: null });
    render(
      <HouseholdHistoryPanel onChanged={onChanged} history={history({ followUps: [done] })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1", {
      method: "PATCH",
      body: JSON.stringify({ done: false }),
    });
  });

  it("says a lost answer may still have landed", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const onChanged = vi.fn();
    render(
      <HouseholdHistoryPanel onChanged={onChanged} history={history({ followUps: [note()] })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm. Refresh to see whether it went through.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("lets any member resolve, but offers Edit only to the author", () => {
    asViewer("u2");
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [note()] })} />);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("offers Edit to the author", () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [note()] })} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("offers Edit to an admin on anyone's note", () => {
    asViewer("admin", true);
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [note()] })} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("disables every control offline and says why", () => {
    useOnline.mockReturnValue(false);
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [note()] })} />);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByText("Connect to change follow-ups")).toBeInTheDocument();
  });

  it("edits through the sheet and re-reads once saved", async () => {
    const onChanged = vi.fn();
    render(
      <HouseholdHistoryPanel onChanged={onChanged} history={history({ followUps: [note()] })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { name: "Edit follow-up" });
    fireEvent.change(within(sheet).getByLabelText("Note"), { target: { value: "Bring two." } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/f1", {
      method: "PATCH",
      body: JSON.stringify({ note: "Bring two." }),
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the sheet on Cancel without a request", async () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [note()] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("anchors a new note to a visit when asked", async () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history()} anchorVisits />);
    fireEvent.click(screen.getByRole("button", { name: "Follow up on this visit" }));
    const sheet = screen.getByRole("dialog", { name: "Follow-up for #05-123" });
    fireEvent.change(within(sheet).getByLabelText("Note"), { target: { value: "Call back" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save follow-up" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
        method: "POST",
        body: JSON.stringify({
          householdId: "h1",
          visitId: "v1",
          note: "Call back",
          dueDate: null,
        }),
      });
    });
  });

  it("does not offer anchoring unless asked", () => {
    render(<HouseholdHistoryPanel onChanged={noop} history={history()} />);
    expect(
      screen.queryByRole("button", { name: "Follow up on this visit" }),
    ).not.toBeInTheDocument();
  });

  it("shows the 403 wording when the server refuses", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "raw" } }),
    );
    render(<HouseholdHistoryPanel onChanged={noop} history={history({ followUps: [note()] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the person who wrote this note, or an admin, can change it.",
    );
  });
});
