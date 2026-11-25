import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { HouseholdHistoryPanel } from "@/components/households/household-history";
import type { ActiveSession, FollowUp, HouseholdHistory, Visit } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { focusDropped, pressByKey } from "../../../test/focus-dropped";
import { landWhileTyping } from "../../../test/land-while-typing";

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
  picks: [{ householdId: "h1", addedAt: "2025-12-31T00:00:00.000Z" }],
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

/* The whole unit on one page unless a test says otherwise. */
const history = (over: Partial<HouseholdHistory> = {}): HouseholdHistory => {
  const visits = over.visits ?? [visit()];
  return {
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
    visits,
    answered: true,
    pagination: { limit: 20, offset: 0, total: visits.length, hasMore: false },
    followUps: [],
    ...over,
  };
};

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
    render(
      <Panel
        over={{
          household: { ...unknown.household, name: null },
          visits: [visit({ interestLevel: "no_response" })],
          answered: false,
        }}
      />,
    );
    expect(screen.getByText("Nobody has answered here yet")).toBeInTheDocument();
  });

  it("says only the name is not known once someone has answered", () => {
    const unnamed = history();
    render(<Panel over={{ household: { ...unnamed.household, name: null } }} />);
    expect(screen.getByText("Name not known")).toBeInTheDocument();
    expect(screen.queryByText("Nobody has answered here yet")).not.toBeInTheDocument();
  });

  it("knows someone answered from a visit on an older page, not only the visits shown", () => {
    // The newest page is all silence; the answer was further back (#160).
    const unnamed = history();
    render(
      <Panel
        over={{
          household: { ...unnamed.household, name: null },
          visits: [visit({ interestLevel: "no_response" })],
          answered: true,
          pagination: { limit: 20, offset: 0, total: 30, hasMore: true },
        }}
      />,
    );
    expect(screen.getByText("Name not known")).toBeInTheDocument();
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
    render(<Panel over={{ visits: [teamed, visit()] }} />);
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

  /* Disabled while it saves, the button loses focus to the page (#221).
     Held until it has, as a real refusal is (D-208-6). */
  it.each([
    ["Mark done", note()],
    ["Reopen", note({ doneAt: "2026-04-01T00:00:00.000Z" })],
  ])("gives focus back to %s after a refusal", async (label, shown) => {
    let refuse: (reason: unknown) => void = () => undefined;
    apiFetch.mockReturnValueOnce(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    const user = userEvent.setup();
    render(<Panel over={{ followUps: [shown] }} />);
    const button = screen.getByRole("button", { name: label });
    await pressByKey(user, button);
    await screen.findByRole("button", { name: "Saving…" });
    await focusDropped();

    refuse(new TypeError("Failed to fetch"));
    const alert = await screen.findByRole("alert");
    expect(button).toHaveFocus();
    expect(alert).not.toHaveFocus();
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
    const anchor = screen.getByRole("button", { name: "Add to follow-up list" });
    // "follow-" over "up" read as two words at large text (#196).
    expect(within(anchor).getByText("follow-up")).toHaveClass("whole-word");
    fireEvent.click(anchor);
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

  it("says a stale Reopen met a suggestion once, and re-reads so it is no longer offered", async () => {
    // The screen was read before Ben suggested the door; the server knows better.
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, { error: { code: "follow_up_exists", message: "raw" } }),
    );
    const done = note({ doneAt: "2026-04-01T00:00:00.000Z" });
    const onChanged = vi.fn(() => {
      // The re-read: Ben's suggestion now waits at the door.
      rerender(
        <Panel
          over={{
            followUps: [
              { ...done, waitingSuggestionBy: { id: "u2", name: "Ben Tan", image: null } },
            ],
          }}
          onChanged={onChanged}
        />,
      );
    });
    const { rerender } = render(<Panel over={{ followUps: [done] }} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not reopened.");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getAllByText(/suggestion for this door is waiting for an admin/)
        .map((n) => n.textContent),
    ).toEqual([
      "Ben's suggestion for this door is waiting for an admin. Ask an admin to review it.",
    ]);
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });

  it("keeps the screen as it is after a refusal that changes nothing at the door", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(403, { error: { code: "forbidden", message: "raw" } }),
    );
    const onChanged = vi.fn();
    render(<Panel over={{ followUps: [note()] }} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await screen.findByRole("alert");
    expect(onChanged).not.toHaveBeenCalled();
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

describe("older visits (#160)", () => {
  /* Visit n was stored on day n, so a higher n is newer. */
  const day = (n: number) => new Date(2026, 0, n, 12).toISOString();
  const dated = (n: number) =>
    visit({
      id: `v${String(n).padStart(2, "0")}`,
      description: `Visit ${String(n)}`,
      createdAt: day(n),
      updatedAt: day(n),
    });
  /* Newest first, as the server answers. */
  const run = (from: number, to: number) => {
    const visits: Visit[] = [];
    for (let n = from; n >= to; n -= 1) visits.push(dated(n));
    return visits;
  };
  const firstPage = (over: Partial<HouseholdHistory> = {}) =>
    history({
      visits: run(30, 11),
      pagination: { limit: 20, offset: 0, total: 30, hasMore: true },
      ...over,
    });
  const olderPage = history({
    visits: run(10, 1),
    pagination: { limit: 20, offset: 20, total: 30, hasMore: false },
  });
  const shown = () =>
    within(screen.getByRole("list", { name: "Timeline" }))
      .getAllByRole("listitem")
      .map((item) => /Visit \d+|Old promise|Recent promise/.exec(item.textContent)?.[0]);
  const showEarlier = () => screen.getByRole("button", { name: "Show earlier visits" });

  /* An answer that waits until the test lets it go. */
  function later() {
    let settle: { resolve: (value: unknown) => void; reject: (reason: unknown) => void } = {
      resolve: noop,
      reject: noop,
    };
    const answer = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    apiFetch.mockReturnValueOnce(answer);
    return settle;
  }

  it("offers them only while the unit has more than the visits shown", () => {
    const { unmount } = render(
      <HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} />,
    );
    expect(showEarlier()).toBeEnabled();
    unmount();

    render(<Panel over={{ visits: run(30, 11) }} />);
    expect(screen.queryByRole("button", { name: "Show earlier visits" })).not.toBeInTheDocument();
  });

  it("reads the next page from where the first ended, and puts it above, oldest first", async () => {
    apiFetch.mockResolvedValueOnce(olderPage);
    render(<HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} />);
    expect(shown()[0]).toBe("Visit 11");

    fireEvent.click(showEarlier());
    expect(apiFetch).toHaveBeenCalledWith("/households/h1?limit=20&offset=20");
    await waitFor(() => {
      expect(shown()).toHaveLength(30);
    });
    expect(shown().slice(0, 3)).toEqual(["Visit 1", "Visit 2", "Visit 3"]);
    expect(shown().at(-1)).toBe("Visit 30");
    // Every visit is shown, so there is nothing earlier to offer.
    expect(screen.queryByRole("button", { name: "Show earlier visits" })).not.toBeInTheDocument();
  });

  it("says it is loading, and takes no second tap, while a read is in flight", async () => {
    const answer = later();
    render(<HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} />);
    fireEvent.click(showEarlier());

    const loading = screen.getByRole("button", { name: "Loading…" });
    expect(loading).toBeDisabled();
    fireEvent.click(loading);
    expect(apiFetch).toHaveBeenCalledTimes(1);

    answer.resolve(olderPage);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Loading…" })).not.toBeInTheDocument();
    });
  });

  it("keeps every visit and the control when a read fails, and says so in one line", async () => {
    apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} />);
    fireEvent.click(showEarlier());

    expect(await screen.findByText("Could not load earlier visits.")).toBeInTheDocument();
    expect(shown()).toHaveLength(20);
    expect(showEarlier()).toBeEnabled();

    // Trying again clears the line while it reads.
    later();
    fireEvent.click(showEarlier());
    expect(screen.queryByText("Could not load earlier visits.")).not.toBeInTheDocument();
  });

  /* jsdom lays nothing out, so the control is put where the member left it:
     by default just above the docked Save of a 768px screen. */
  const placeControl = (top = 640) => {
    const rect = vi.spyOn(showEarlier(), "getBoundingClientRect");
    rect.mockReturnValue(DOMRect.fromRect({ y: top, width: 320, height: 44 }));
    return rect;
  };

  /* Drawn under the control, the line landed under the docked Save at the
     door on an iPhone 13, and a tap there seemed to do nothing. */
  it("brings a failure into view, clear of the docked Save at the door, and only a failure", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} atDoor />);
    placeControl();
    fireEvent.click(showEarlier());

    const failure = await screen.findByText("Could not load earlier visits.");
    expect(scrolled).toHaveBeenCalledOnce();
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    /* The line itself: at large text the control can fill the room left,
       and the two together would then be aligned by the control's top. */
    expect(scrolled.mock.contexts[0]).toBe(failure);
    expect(failure).toHaveClass("scroll-clear-chrome");

    // A second failure is brought into view again; a page that lands is not.
    apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(showEarlier());
    await screen.findByText("Could not load earlier visits.");
    expect(scrolled).toHaveBeenCalledTimes(2);
    apiFetch.mockResolvedValueOnce(olderPage);
    fireEvent.click(showEarlier());
    await waitFor(() => {
      expect(shown()).toHaveLength(30);
    });
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it("brings a failure clear of the nav and any floating banner away from the door", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} />);
    placeControl();
    fireEvent.click(showEarlier());

    const failure = await screen.findByText("Could not load earlier visits.");
    expect(scrolled.mock.contexts).toEqual([failure]);
    expect(failure).toHaveClass("scroll-clear-nav");
    expect(failure).not.toHaveClass("scroll-clear-chrome");
  });

  /* On poor signal the failure can land long after the tap, once the member
     is at the interest picker or typing a note: bringing the line into view
     then pulled the page 1,500px up, away from the note, on both phones. */
  it("leaves the page where it is when a failure lands after the member moved on to a note", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const answer = later();
    render(
      <>
        <HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} atDoor />
        <textarea aria-label="Notes" />
      </>,
    );
    placeControl();
    fireEvent.click(showEarlier());
    const notes = screen.getByRole("textbox", { name: "Notes" });
    act(() => {
      notes.focus();
    });

    answer.reject(new TypeError("Failed to fetch"));
    expect(await screen.findByText("Could not load earlier visits.")).toBeInTheDocument();
    expect(scrolled).not.toHaveBeenCalled();
    expect(notes).toHaveFocus();
  });

  /* Disabled while it reads, the control loses focus to the page (#221).
     Held until it has, as a real failure is (D-208-6). */
  it("gives focus back to the control after a failed read, before the line is brought into view", async () => {
    const focusAtScroll: (Element | null)[] = [];
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {
      focusAtScroll.push(document.activeElement);
    });
    onTestFinished(() => {
      scrolled.mockRestore();
    });
    const answer = later();
    const user = userEvent.setup();
    render(<HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} atDoor />);
    placeControl();
    const button = showEarlier();
    await pressByKey(user, button);
    expect(button).toBeDisabled();
    await focusDropped();

    answer.reject(new TypeError("Failed to fetch"));
    await screen.findByText("Could not load earlier visits.");
    expect(button).toHaveFocus();
    expect(focusAtScroll).toEqual([button]);
  });

  it("leaves the page where it is when a failure lands after the member scrolled away, and moves it once they are back", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const answer = later();
    render(<HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} atDoor />);
    const rect = placeControl();
    fireEvent.click(showEarlier());
    // Down at the interest picker, the control far above the screen.
    rect.mockReturnValue(DOMRect.fromRect({ y: -1500, width: 320, height: 44 }));

    answer.reject(new TypeError("Failed to fetch"));
    await screen.findByText("Could not load earlier visits.");
    expect(scrolled).not.toHaveBeenCalled();

    // Back at the control, a failure is brought into view again.
    rect.mockReturnValue(DOMRect.fromRect({ y: 640, width: 320, height: 44 }));
    apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(showEarlier());
    const failure = await screen.findByText("Could not load earlier visits.");
    expect(scrolled.mock.contexts).toEqual([failure]);
  });

  it("keeps the older visits when the parent reads the first page again", async () => {
    apiFetch.mockResolvedValueOnce(olderPage);
    const view = render(
      <HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} />,
    );
    fireEvent.click(showEarlier());
    await waitFor(() => {
      expect(shown()).toHaveLength(30);
    });

    // A visit stored since: the new first page moves one visit down.
    const reread = firstPage({
      visits: run(31, 12),
      pagination: { limit: 20, offset: 0, total: 31, hasMore: true },
    });
    view.rerender(<HouseholdHistoryPanel history={reread} active={null} onChanged={noop} />);
    expect(shown()).toHaveLength(31);
    expect(shown().at(-1)).toBe("Visit 31");
    expect(shown()[0]).toBe("Visit 1");
  });

  it("leaves no gap when the first page is read again while an older one is on its way", async () => {
    const answer = later();
    const view = render(
      <HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} />,
    );
    fireEvent.click(showEarlier());
    // Visit 31 is stored: Visit 11 is now on neither the new first page nor the older one.
    view.rerender(
      <HouseholdHistoryPanel
        history={firstPage({
          visits: run(31, 12),
          pagination: { limit: 20, offset: 0, total: 31, hasMore: true },
        })}
        active={null}
        onChanged={noop}
      />,
    );
    answer.resolve(olderPage);

    await waitFor(() => {
      expect(shown()).toHaveLength(31);
    });
    expect(shown()).toContain("Visit 11");
  });

  it("holds back a resolved note older than every visit shown until its visits are", async () => {
    const promise = (id: string, n: number) =>
      note({
        id,
        note: id === "old" ? "Old promise" : "Recent promise",
        createdAt: day(n),
        doneAt: day(n),
      });
    apiFetch.mockResolvedValueOnce(olderPage);
    render(
      <HouseholdHistoryPanel
        history={firstPage({ followUps: [promise("old", 3), promise("recent", 25)] })}
        active={null}
        onChanged={noop}
      />,
    );
    expect(shown()).not.toContain("Old promise");
    expect(shown()).toContain("Recent promise");

    fireEvent.click(showEarlier());
    await waitFor(() => {
      expect(shown()).toContain("Old promise");
    });
    expect(shown().slice(0, 4)).toEqual(["Visit 1", "Visit 2", "Visit 3", "Old promise"]);
  });

  /* At the door: WebKit can run the answer inside the input event of the next
     unit landing in the field, before React has read it (#155). Landing must
     not render the field's owner again with the unit it still holds. */
  it("keeps what is typed as an older page lands", async () => {
    function AtTheDoor() {
      const [unit, setUnit] = useState("#05-123");
      return (
        <>
          <input
            aria-label="Unit number"
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value);
            }}
          />
          <HouseholdHistoryPanel history={firstPage()} active={null} onChanged={noop} atDoor />
        </>
      );
    }
    const answer = later();
    render(<AtTheDoor />);
    fireEvent.click(showEarlier());
    const field = screen.getByLabelText<HTMLInputElement>("Unit number");

    await landWhileTyping(field, "#05-1234", () => {
      answer.resolve(olderPage);
    });

    expect(field).toHaveValue("#05-1234");
    await waitFor(() => {
      expect(shown()).toHaveLength(30);
    });
    expect(field).toHaveValue("#05-1234");
  });
});

describe("when the unit's people ask for something (#279)", () => {
  it("marks a contact that was withdrawn, beside the contact", () => {
    render(
      <Panel
        over={{
          household: {
            ...history().household,
            contactWithdrawnAt: "2026-03-15T10:00:00.000Z",
          },
        }}
      />,
    );
    expect(screen.getByText("No calls or messages")).toBeVisible();
  });

  it("offers a member to pass on a request, and an admin on the page to erase", () => {
    const { unmount } = render(<Panel />);
    expect(
      screen.getByRole("button", { name: "They asked us to delete their data" }),
    ).toBeVisible();
    unmount();

    asViewer("admin", true);
    render(<Panel />);
    expect(screen.getByRole("button", { name: "Erase this unit's data…" })).toBeVisible();
  });

  it("reads the unit again once something was passed on", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<Panel onChanged={onChanged} />);
    await user.click(
      screen.getByRole("button", { name: "Withdrew agreement to calls or messages" }),
    );
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce();
    });
  });

  it("offers nothing for a unit erased and not visited since", () => {
    render(
      <Panel
        over={{
          household: { ...history().household, name: null, contact: null, religion: null },
          visits: [],
          answered: false,
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: /delete their data/ })).toBeNull();
    expect(screen.getByText("Nobody has answered here yet")).toBeVisible();
  });
});
