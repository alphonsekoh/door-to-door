import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HouseholdScreen } from "@/components/households/household-screen";
import type { FollowUp, HouseholdHistory } from "@/generated/types.gen";
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

/* A follow-up session that picked the unit, so a member may resolve. */
const { useActiveSession } = vi.hoisted(() => ({ useActiveSession: vi.fn() }));
vi.mock("@/lib/hooks/use-active-session", () => ({ useActiveSession }));
const FOLLOW_UP = {
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

const AT = "2026-03-14T11:00:00.000Z";

const history: HouseholdHistory = {
  household: {
    id: "h1",
    blockId: "b1",
    unitNumber: "#05-123",
    name: "Mr Tan",
    contact: "91234567",
    religion: null,
    createdAt: AT,
    updatedAt: AT,
  },
  block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
  visits: [
    {
      id: "v1",
      householdId: "h1",
      sessionId: "s1",
      member: { id: "u2", name: "Ben Lim", image: null },
      team: null,
      interestLevel: "medium",
      description: "Asked us to come back",
      clientCreatedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  answered: true,
  pagination: { limit: 20, offset: 0, total: 1, hasMore: false },
  followUps: [],
};

/* Nobody has knocked yet. */
const unvisited: HouseholdHistory = {
  ...history,
  visits: [],
  answered: false,
  pagination: { ...history.pagination, total: 0 },
};

const owed: FollowUp = {
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
  createdAt: AT,
};

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
  useOnline.mockReturnValue(true);
  useActiveSession.mockReturnValue(FOLLOW_UP);
});

/* Answers GETs with the unit and everything else with an empty success. */
const serve = (unit: (call: number) => HouseholdHistory | Promise<HouseholdHistory>) => {
  let reads = 0;
  apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
    init?.method === undefined ? Promise.resolve(unit(++reads)) : Promise.resolve({}),
  );
};

describe("HouseholdScreen", () => {
  it("names the unit and its block", async () => {
    apiFetch.mockResolvedValue(history);
    render(<HouseholdScreen householdId="h1" />);

    // The unit is the page's heading, so the outline has somewhere to land.
    expect(await screen.findByRole("heading", { level: 1, name: "#05-123" })).toBeInTheDocument();
    expect(screen.getByText("Blk 123, Test Ave")).toBeInTheDocument();
  });

  it("offers a way back in every state, so a failed load is no trap", async () => {
    apiFetch.mockRejectedValue(new Error("Could not load this unit."));
    render(<HouseholdScreen householdId="h1" />);
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/follow-ups");
  });

  it("shows what every member learned, not only the caller's own visit", async () => {
    // A door's history is shared; that is the point of the household split.
    apiFetch.mockResolvedValue(history);
    render(<HouseholdScreen householdId="h1" />);

    expect(await screen.findByText("Asked us to come back")).toBeInTheDocument();
    expect(screen.getAllByText(/Ben Lim/).length).toBeGreaterThan(0);
  });

  it("says in the header who made the latest visit, and with whom", async () => {
    const earlier = history.visits[0];
    if (earlier === undefined) throw new Error("fixture has a visit");
    // Newest first (#160): the first visit is the latest knock.
    apiFetch.mockResolvedValue({
      ...history,
      visits: [
        {
          ...earlier,
          id: "v2",
          member: { id: "u1", name: "Alice Tan", image: null },
          team: {
            id: "t1",
            name: "Alice & Ben",
            members: [{ id: "u2", name: "Ben Lim", image: null }],
          },
        },
        earlier,
      ],
      pagination: { ...history.pagination, total: 2 },
    });
    render(<HouseholdScreen householdId="h1" />);

    expect(await screen.findByText("Last visit by Alice Tan with Ben Lim")).toBeInTheDocument();
  });

  it("has no last-visit line for a unit nobody has visited", async () => {
    apiFetch.mockResolvedValue(unvisited);
    render(<HouseholdScreen householdId="h1" />);

    expect(await screen.findByText("#05-123")).toBeInTheDocument();
    expect(screen.queryByText(/Last visit by/)).not.toBeInTheDocument();
  });

  it("asks for the newest page of the unit it was given", async () => {
    apiFetch.mockResolvedValue(history);
    render(<HouseholdScreen householdId="h1" />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/households/h1?limit=20&offset=0");
    });
  });

  it("reports a failure rather than an empty unit", async () => {
    apiFetch.mockRejectedValue(new Error("No such unit."));
    render(<HouseholdScreen householdId="h1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No such unit.");
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<HouseholdScreen householdId="h1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this unit.");
  });

  it("lets a member suggest a return visit from the header, not tied to a visit", async () => {
    serve(() => history);
    render(<HouseholdScreen householdId="h1" />);
    const [header] = await screen.findAllByRole("button", { name: "Suggest a return visit" });
    if (header === undefined) throw new Error("expected the header action");
    fireEvent.click(header);
    const sheet = within(screen.getByRole("dialog", { name: "Suggest a return visit, #05-123" }));
    fireEvent.change(sheet.getByLabelText("Why should we go back?"), {
      target: { value: "Call back" },
    });
    fireEvent.click(sheet.getByRole("button", { name: "Send suggestion" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
        method: "POST",
        body: JSON.stringify({
          householdId: "h1",
          visitId: null,
          note: "Call back",
          dueDate: null,
        }),
      });
    });
    await waitFor(() => {
      expect(
        apiFetch.mock.calls.filter(([path]) => path === "/households/h1?limit=20&offset=0"),
      ).toHaveLength(2);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Suggestion sent. An admin will review it.",
    );
  });

  it("lets an admin add the household straight to the list", async () => {
    useRole.mockReturnValue({ userId: "admin", isAdmin: true });
    serve(() => history);
    render(<HouseholdScreen householdId="h1" />);
    const [header] = await screen.findAllByRole("button", { name: "Add to follow-up list" });
    if (header === undefined) throw new Error("expected the header action");
    fireEvent.click(header);
    const sheet = within(
      screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" }),
    );
    fireEvent.change(sheet.getByLabelText("What should the next visit do?"), {
      target: { value: "Bring the flyer" },
    });
    const add = sheet.getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    fireEvent.click(add);
    expect(await screen.findByText("Added to the follow-up list.")).toBeInTheDocument();
  });

  it("has an admin list a member's waiting suggestion from the header, not write a second note", async () => {
    // A second note would leave Ben's waiting on a listed door, and
    // dismissing it later would tell him it was declined.
    useRole.mockReturnValue({ userId: "admin", isAdmin: true });
    const waiting: FollowUp = {
      ...owed,
      id: "s7",
      status: "suggested",
      author: { id: "u2", name: "Ben Lim", image: null },
    };
    serve((call) => ({
      ...history,
      followUps: [call === 1 ? waiting : { ...waiting, status: "listed" }],
    }));
    render(<HouseholdScreen householdId="h1" />);
    const add = await screen.findAllByRole("button", { name: "Add to follow-up list" });
    // The header alone: no visit row offers a note beside the suggestion.
    expect(add).toHaveLength(1);
    const [header] = add;
    if (header === undefined) throw new Error("expected the header action");
    fireEvent.click(header);
    // The suggestion is read in a sheet before it goes on the list.
    const sheet = within(
      screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" }),
    );
    expect(sheet.getByText("Bring the flyer.")).toBeVisible();
    const confirm = sheet.getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(confirm).toBeEnabled();
    });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups/s7", {
        method: "PATCH",
        body: JSON.stringify({ status: "listed" }),
      });
    });
    expect(apiFetch).not.toHaveBeenCalledWith("/follow-ups", expect.anything());
    expect(await screen.findByRole("status")).toHaveTextContent("Added to the follow-up list.");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // Re-read: the door is now on the list, and says so instead.
    expect(await screen.findAllByText("On the follow-up list")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Add to follow-up list" })).toBeNull();
  });

  it("tells an admin the household is already on the list rather than offering another note", async () => {
    useRole.mockReturnValue({ userId: "admin", isAdmin: true });
    serve(() => ({ ...history, followUps: [owed] }));
    render(<HouseholdScreen householdId="h1" />);
    expect(await screen.findAllByText("On the follow-up list")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Add to follow-up list" })).toBeNull();
  });

  it("says the household is on the list instead of offering a suggestion", async () => {
    serve(() => ({ ...history, followUps: [owed] }));
    render(<HouseholdScreen householdId="h1" />);
    // The header says it, and so does the section holding the note.
    expect(await screen.findAllByText("On the follow-up list")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Suggest a return visit" })).toBeNull();
  });

  it("says whose suggestion is waiting, so nobody suggests the door twice", async () => {
    serve(() => ({
      ...history,
      followUps: [
        { ...owed, status: "suggested", author: { id: "u2", name: "Ben Lim", image: null } },
      ],
    }));
    render(<HouseholdScreen householdId="h1" />);
    expect(await screen.findByText("Suggested by Ben Lim, waiting for review")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Suggest a return visit" })).toBeNull();
  });

  it("closes the add sheet on Cancel", async () => {
    serve(() => history);
    render(<HouseholdScreen householdId="h1" />);
    const [header] = await screen.findAllByRole("button", { name: "Suggest a return visit" });
    if (header === undefined) throw new Error("expected the header action");
    fireEvent.click(header);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("offers a suggestion on each visit row as well as the header", async () => {
    serve(() => history);
    render(<HouseholdScreen householdId="h1" />);
    expect(await screen.findAllByRole("button", { name: "Suggest a return visit" })).toHaveLength(
      2,
    );
  });

  it("re-reads the unit after a note is marked done", async () => {
    serve((call) =>
      call === 1
        ? { ...history, followUps: [owed] }
        : {
            ...history,
            followUps: [
              { ...owed, doneAt: AT, doneBy: { id: "u2", name: "Ben Lim", image: null } },
            ],
          },
    );
    render(<HouseholdScreen householdId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    expect(await screen.findByText(/Done by Ben Lim/)).toBeInTheDocument();
  });

  it("keeps the unit on screen when a re-read fails", async () => {
    serve((call) =>
      call === 1 ? { ...history, followUps: [owed] } : Promise.reject(new TypeError("offline")),
    );
    render(<HouseholdScreen householdId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText("#05-123")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets only the newest of two re-reads land", async () => {
    let releaseFirst: (value: HouseholdHistory) => void = () => undefined;
    serve((call) => {
      if (call === 1) return { ...history, followUps: [owed] };
      if (call === 2) {
        return new Promise<HouseholdHistory>((resolve) => {
          releaseFirst = resolve;
        });
      }
      // Visits are never removed, so the newer read tells itself apart by a name learned since.
      return { ...history, household: { ...history.household, name: "Mrs Lee" }, followUps: [] };
    });
    render(<HouseholdScreen householdId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(3);
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByText("Mrs Lee")).toBeInTheDocument();
    releaseFirst({ ...history, followUps: [owed] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Mrs Lee")).toBeInTheDocument();
    expect(screen.queryByText("Mr Tan")).not.toBeInTheDocument();
  });
});
