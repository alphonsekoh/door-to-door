import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HouseholdHistoryPanel } from "@/components/households/household-history";
import type { ActiveSession, FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

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

/* A follow-up session covering the unit's block, started before any test's
   resolution, so a member may act on its listed notes. */
const FOLLOW_UP: ActiveSession = {
  session: {
    id: "s9",
    title: "Follow-up",
    kind: "follow_up",
    status: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    createdBy: { id: "admin", name: "Admin", image: null },
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  blocks: [
    {
      block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: "" },
      visitCount: 0,
      householdCount: 0,
      activeMembers: [],
    },
  ],
  householdIds: ["h1"],
};

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
  blockId: "b1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  status: "listed",
  author: { id: "u1", name: "Alice", image: null },
  note: "Bring the flyer.",
  dueDate: null,
  doneAt: null,
  doneBy: null,
  listedAt: null,
  listedBy: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  waitingSuggestionBy: null,
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

function Panel({
  over = {},
  active = FOLLOW_UP,
  onChanged = noop,
  anchorVisits = false,
}: {
  over?: Partial<HouseholdHistory>;
  active?: ActiveSession | null;
  onChanged?: () => void;
  anchorVisits?: boolean;
}) {
  return (
    <HouseholdHistoryPanel
      history={history(over)}
      active={active}
      onChanged={onChanged}
      anchorVisits={anchorVisits}
    />
  );
}

const suggestion = (over: Partial<FollowUp> = {}) =>
  note({ id: "s1", status: "suggested", note: "Asked us back after 7pm.", ...over });

describe("what is known about the unit", () => {
  it("leads with the name", () => {
    render(<Panel />);
    expect(screen.getByText("Mr Tan")).toBeInTheDocument();
  });

  it("says plainly when nobody has ever answered", () => {
    // Better than a blank space, which reads as a loading bug.
    const unknown = history();
    render(<Panel over={{ household: { ...unknown.household, name: null } }} />);
    expect(screen.getByText("Nobody has answered here yet")).toBeInTheDocument();
  });

  it("shows a contact when there is one", () => {
    render(<Panel />);
    expect(screen.getByText("+65 9000 0000")).toBeInTheDocument();
  });

  it("omits the contact line entirely when unknown", () => {
    const h = history();
    render(<Panel over={{ household: { ...h.household, contact: null } }} />);
    expect(screen.queryByText("+65 9000 0000")).not.toBeInTheDocument();
  });
});

describe("on the follow-up list", () => {
  it("surfaces a promise made last time", () => {
    /*
     * The point of the panel: arriving at the door knowing what was promised,
     * rather than finding out afterwards.
     */
    render(<Panel over={{ followUps: [note()] }} />);
    // Scoped to the note itself: Alice also appears as the previous visitor.
    const owed = within(screen.getByRole("list", { name: "On the follow-up list" }));
    expect(owed.getByText("Bring the flyer.")).toBeInTheDocument();
    // Alice is reading her own note, as the header calls her.
    expect(owed.getByText(/^Added by you · /)).toBeInTheDocument();
  });

  it("names the author to everyone else", () => {
    asViewer("u2");
    render(<Panel over={{ followUps: [note()] }} />);
    const owed = within(screen.getByRole("list", { name: "On the follow-up list" }));
    expect(owed.getByText(/^Added by Alice · /)).toBeInTheDocument();
  });

  it("hides notes that are already done", () => {
    render(<Panel over={{ followUps: [note({ doneAt: "2026-04-01T00:00:00.000Z" })] }} />);
    expect(screen.queryByRole("list", { name: "On the follow-up list" })).not.toBeInTheDocument();
  });

  it("falls back when the author has no name", () => {
    render(
      <Panel over={{ followUps: [note({ author: { id: "u9", name: null, image: null } })] }} />,
    );
    expect(screen.getAllByText(/Added by Someone/).length).toBeGreaterThan(0);
  });

  it("names who put a member's words on the list", () => {
    const promoted = note({
      listedAt: new Date(2026, 2, 20, 12).toISOString(),
      listedBy: { id: "admin", name: "Admin", image: null },
    });
    render(<Panel over={{ followUps: [promoted] }} />);
    expect(screen.getByText(/^Suggested by you · /)).toBeInTheDocument();
    expect(screen.getByText("Added to the list by Admin · 20 Mar 2026")).toBeInTheDocument();
  });

  it.each([
    ["their own", "u1"],
    ["another member's", "u2"],
  ])("never offers a member a way to take %s listed note off the list", (_, viewer) => {
    asViewer(viewer);
    render(<Panel over={{ followUps: [note()] }} active={FOLLOW_UP} />);
    const owed = within(screen.getByRole("list", { name: "On the follow-up list" }));
    // Mark done is there, so the session lets the member act on the note.
    expect(owed.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    for (const name of ["Withdraw", "Remove from list", "Dismiss"]) {
      expect(owed.queryByRole("button", { name })).toBeNull();
    }
  });
});

describe("waiting for review", () => {
  it("shows another member's suggestion to everyone, as waiting", () => {
    asViewer("u2");
    render(<Panel over={{ followUps: [suggestion()] }} />);
    const waiting = within(screen.getByRole("list", { name: "Waiting for review" }));
    expect(waiting.getByText("Asked us back after 7pm.")).toBeInTheDocument();
    expect(waiting.getByText(/^Suggested by Alice · .* · Waiting for review$/)).toBeInTheDocument();
    // Not theirs, so nothing to do but read it.
    expect(waiting.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lets the author edit or withdraw it, but never mark it done", () => {
    render(<Panel over={{ followUps: [suggestion()] }} />);
    const waiting = within(screen.getByRole("list", { name: "Waiting for review" }));
    expect(waiting.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(waiting.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(waiting.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
  });

  it("lets an admin add it to the list, edit it or dismiss it", async () => {
    asViewer("admin", true);
    const onChanged = vi.fn();
    render(<Panel over={{ followUps: [suggestion()] }} onChanged={onChanged} />);
    const waiting = within(screen.getByRole("list", { name: "Waiting for review" }));
    expect(waiting.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(waiting.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    fireEvent.click(waiting.getByRole("button", { name: "Add to list" }));
    // Read before it is owed, in a sheet of its own.
    const sheet = within(
      screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" }),
    );
    const add = sheet.getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    fireEvent.click(add);
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/s1", {
      method: "PATCH",
      body: JSON.stringify({ status: "listed" }),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Added to the follow-up list.");
  });
});

describe("previous visits", () => {
  it("labels the interest level readably", () => {
    render(<Panel />);
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("labels a silent door as No response, not no_response", () => {
    render(<Panel over={{ visits: [visit({ interestLevel: "no_response", description: "" })] }} />);
    expect(screen.getByText("No response")).toBeInTheDocument();
  });

  it("names who recorded it", () => {
    render(<Panel />);
    const list = screen.getByRole("list", { name: "Timeline" });
    expect(within(list).getByText(/Alice/)).toBeInTheDocument();
  });

  it("falls back when the member has no name", () => {
    render(<Panel over={{ visits: [visit({ member: { id: "u9", name: null, image: null } })] }} />);
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
    render(<Panel over={{ visits: [visit(), teamed] }} />);
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
    render(<Panel over={{ visits: [visit({ description: "" })] }} />);
    expect(screen.queryByText("Listened for a while.")).not.toBeInTheDocument();
  });

  it("renders nothing for a unit with no visits", () => {
    render(<Panel over={{ visits: [] }} />);
    expect(screen.queryByRole("list", { name: "Timeline" })).not.toBeInTheDocument();
  });

  it("shows an unrecognised level as-is rather than blank", () => {
    render(<Panel over={{ visits: [visit({ interestLevel: "unknown" as never })] }} />);
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
    render(<Panel over={{ followUps: notes }} />);

    const owed = within(screen.getByRole("list", { name: "On the follow-up list" }));
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
    render(<Panel over={{ followUps: [resolved] }} />);
    expect(screen.queryByRole("list", { name: "On the follow-up list" })).not.toBeInTheDocument();
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
    render(<Panel over={{ followUps: [done] }} />);
    expect(screen.getByText("Done by Ben Lim · 9 Jun 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("marks an overdue note in words, not only colour", () => {
    const overdue = note({ dueDate: "2020-01-01T00:00:00.000Z" });
    render(<Panel over={{ followUps: [overdue] }} />);
    const owed = within(screen.getByRole("list", { name: "On the follow-up list" }));
    expect(owed.getByText("Overdue")).toBeInTheDocument();
  });

  it("does not call a note due later overdue", () => {
    const later = note({ dueDate: "2099-01-01T00:00:00.000Z" });
    render(<Panel over={{ followUps: [later] }} />);
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("offers one Mark done per outstanding note", () => {
    render(<Panel over={{ followUps: [note()] }} />);
    expect(screen.getAllByRole("button", { name: "Mark done" })).toHaveLength(1);
  });
});

describe("acting on a note", () => {
  it("marks it done with one request on a double tap, then asks for a re-read", async () => {
    const onChanged = vi.fn();
    render(<Panel over={{ followUps: [note()] }} onChanged={onChanged} />);
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
    render(<Panel over={{ followUps: [done] }} onChanged={onChanged} />);
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
    render(<Panel over={{ followUps: [note()] }} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm. Refresh to see whether it went through.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("lets any member resolve in its session, but offers Edit only to the author", () => {
    asViewer("u2");
    render(<Panel over={{ followUps: [note()] }} />);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("tells a member outside a follow-up session when they can mark it done", () => {
    // Members change listed notes only during the session whose list they are on.
    render(<Panel over={{ followUps: [note()] }} active={null} />);
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "You can mark this done during a follow-up session that includes this household.",
      ),
    ).toBeVisible();
  });

  it("says so when the follow-up session running did not pick the household", () => {
    // One is running, so "during a follow-up session" alone would read as now.
    const elsewhere = note({ householdId: "far" });
    render(<Panel over={{ followUps: [elsewhere] }} />);
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "You can mark this done during a follow-up session that includes this household.",
      ),
    ).toBeVisible();
  });

  it("offers a member no Reopen while a suggestion waits at the door, and says why", () => {
    const done = note({
      doneAt: "2026-04-01T00:00:00.000Z",
      waitingSuggestionBy: { id: "u2", name: "Ben Lim", image: null },
    });
    render(<Panel over={{ followUps: [done] }} />);
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Ben's suggestion for this door is waiting for an admin. Ask an admin to review it.",
      ),
    ).toBeVisible();
  });

  it("tells an admin that reopening lists the waiting suggestion too", () => {
    asViewer("admin", true);
    const done = note({
      doneAt: "2026-04-01T00:00:00.000Z",
      waitingSuggestionBy: { id: "u2", name: "Ben Lim", image: null },
    });
    render(<Panel over={{ followUps: [done] }} active={null} />);
    expect(screen.getByRole("button", { name: "Reopen" })).toBeEnabled();
    expect(screen.getByText("Reopening also adds Ben's suggestion to the list.")).toBeVisible();
  });

  it("sends a member to an admin to reopen a resolved note, never to a session", () => {
    // Resolved before a session starts, a note is never on that session's list.
    const done = note({ doneAt: "2026-04-01T00:00:00.000Z" });
    render(<Panel over={{ followUps: [done] }} active={null} />);
    expect(screen.getByText("Ask an admin if it needs reopening.")).toBeVisible();
    expect(screen.queryByText(/during a follow-up session/)).not.toBeInTheDocument();
  });

  it("offers Edit to the author in the session", () => {
    render(<Panel over={{ followUps: [note()] }} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("offers an admin everything on anyone's note, at any time", () => {
    asViewer("admin", true);
    render(<Panel over={{ followUps: [note()] }} active={null} />);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from list" })).toBeInTheDocument();
    expect(screen.queryByText(/during a follow-up session/)).not.toBeInTheDocument();
  });

  it("disables every control offline and says why", () => {
    useOnline.mockReturnValue(false);
    render(<Panel over={{ followUps: [note()] }} />);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByText("Connect to change follow-ups")).toBeInTheDocument();
  });

  it("edits through the sheet and re-reads once saved", async () => {
    const onChanged = vi.fn();
    render(<Panel over={{ followUps: [note()] }} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { name: "Edit follow-up, #05-123" });
    fireEvent.change(within(sheet).getByLabelText("What should the next visit do?"), {
      target: { value: "Bring two." },
    });
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
    render(<Panel over={{ followUps: [note()] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lets a member suggest a return visit from a visit, and says it was sent", async () => {
    const onChanged = vi.fn();
    render(<Panel anchorVisits onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Suggest a return visit" }));
    const sheet = screen.getByRole("dialog", { name: "Suggest a return visit, #05-123" });
    expect(sheet).toHaveTextContent(
      "An admin reviews every suggestion and decides whether to add it to the follow-up list.",
    );
    fireEvent.change(within(sheet).getByLabelText("Why should we go back?"), {
      target: { value: "Call back" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Send suggestion" }));
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
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Suggestion sent. An admin will review it.",
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("lets an admin add a visit's household straight to the list", async () => {
    asViewer("admin", true);
    render(<Panel anchorVisits />);
    fireEvent.click(screen.getByRole("button", { name: "Add to follow-up list" }));
    const sheet = screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" });
    fireEvent.change(within(sheet).getByLabelText("What should the next visit do?"), {
      target: { value: "Bring the flyer" },
    });
    const add = within(sheet).getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    fireEvent.click(add);
    expect(await screen.findByRole("status")).toHaveTextContent("Added to the follow-up list.");
  });

  it("offers no anchor where the household is already listed or waiting", () => {
    const { unmount } = render(<Panel anchorVisits over={{ followUps: [note()] }} />);
    expect(screen.queryByRole("button", { name: "Suggest a return visit" })).toBeNull();
    unmount();
    render(
      <Panel
        anchorVisits
        over={{ followUps: [suggestion({ author: { id: "u2", name: "Ben", image: null } })] }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Suggest a return visit" })).toBeNull();
  });

  it("does not offer anchoring unless asked", () => {
    render(<Panel />);
    expect(
      screen.queryByRole("button", { name: "Suggest a return visit" }),
    ).not.toBeInTheDocument();
  });

  it("shows the 403 wording when the server refuses", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "raw" } }),
    );
    render(<Panel over={{ followUps: [note()] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the person who wrote this, or an admin, can change it.",
    );
  });

  it("explains a refusal outside the note's session", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, { error: { code: "not_on_follow_up_list", message: "raw" } }),
    );
    render(<Panel over={{ followUps: [note()] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can mark this done during a follow-up session that includes this household.",
    );
  });
});
