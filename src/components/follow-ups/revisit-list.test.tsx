import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RevisitList } from "@/components/follow-ups/revisit-list";
import type { ActiveSession, FollowUp, RevisitEntry } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { focusDropped } from "../../../test/focus-dropped";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { noteRevisits } = vi.hoisted(() => ({ noteRevisits: vi.fn() }));
vi.mock("@/components/sync/local-copy-writer", () => ({
  useLocalCopyWriter: () => ({ noteRevisits }),
}));

const STAMP = "2026-10-20T10:00:00.000Z";

const ACTIVE = {
  session: {
    id: "s1",
    title: "Follow-up",
    kind: "follow_up",
    status: "active",
    startedAt: STAMP,
    endedAt: null,
    createdBy: { id: "a1", name: "Admin", image: null },
    createdAt: STAMP,
  },
  blocks: [],
  picks: [],
} satisfies ActiveSession;

const block = (id: string, name: string) => ({
  id,
  name,
  street: "Ang Mo Kio Ave 3",
  postalCode: null,
  createdAt: STAMP,
});

function note(id: string, over: Partial<FollowUp> = {}): FollowUp {
  return {
    id,
    householdId: "h1",
    blockId: "b1",
    blockName: "123",
    unitNumber: "#05-123",
    visitId: null,
    status: "listed",
    author: { id: "a1", name: "Admin", image: null },
    note: `Note ${id}`,
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: STAMP,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    waitingSuggestionBy: null,
    createdAt: STAMP,
    ...over,
  };
}

type EntryOptions = {
  blockId?: string;
  blockName?: string;
  notes?: FollowUp[];
  name?: string | null;
  visited?: boolean;
  interest?: "high" | null;
};

function entry(
  unitNumber: string,
  {
    blockId = "b1",
    blockName = "123",
    notes = [note(`n${unitNumber}`)],
    name = "Mr Tan",
    visited = false,
    interest = "high",
  }: EntryOptions = {},
): RevisitEntry {
  const householdId = `h${unitNumber}`;
  return {
    household: {
      id: householdId,
      blockId,
      unitNumber,
      name,
      contact: null,
      religion: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    block: block(blockId, blockName),
    notes,
    latestVisit:
      interest === null
        ? null
        : {
            id: `v${unitNumber}`,
            householdId,
            sessionId: "s0",
            member: { id: "u2", name: "Ben", image: null },
            team: null,
            interestLevel: interest,
            description: "",
            clientCreatedAt: STAMP,
            createdAt: STAMP,
            updatedAt: STAMP,
          },
    visitedInSession: visited,
  };
}

const list = (data: RevisitEntry[]) => ({ data });

beforeEach(() => {
  vi.clearAllMocks();
  useOnline.mockReturnValue(true);
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
});

/* The session picked the household the day before it started, and its note
   was marked done an hour in: on the list, Done, and the member's to reopen. */
const PICKED = { ...ACTIVE, picks: [{ householdId: "h1", addedAt: "2026-10-19T10:00:00.000Z" }] };
const DONE_TONIGHT = "2026-10-20T11:00:00.000Z";

describe("RevisitList", () => {
  it("reads the session's list and keeps it on the phone for the offline shell", async () => {
    const data = [entry("#05-123")];
    apiFetch.mockResolvedValue(list(data));
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    expect(await screen.findByText("#05-123")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/revisits");
    expect(noteRevisits).toHaveBeenCalledWith(ACTIVE, data);
  });

  it("groups households by block, each with a way into its block", async () => {
    apiFetch.mockResolvedValue(
      list([
        entry("#05-123"),
        entry("#06-201"),
        entry("#01-01", { blockId: "b2", blockName: "125" }),
      ]),
    );
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    await screen.findByText("#05-123");
    const links = screen.getAllByRole("link", { name: "Open block" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/blocks/b1", "/blocks/b2"]);
    expect(screen.getByText("Blk 125")).toBeInTheDocument();
  });

  it("opens the block with the unit filled in from each household", async () => {
    apiFetch.mockResolvedValue(list([entry("#05-123")]));
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    const row = (await screen.findByText("#05-123")).closest("a");
    expect(row).toHaveAttribute("href", "/blocks/b1?unit=%2305-123");
    expect(row).toHaveTextContent("Mr Tan");
    expect(row).toHaveTextContent("High");
    expect(row).toHaveTextContent("Note n#05-123");
  });

  it("says when nobody has given a name, and shows no interest for a door never visited", async () => {
    apiFetch.mockResolvedValue(list([entry("#05-123", { name: null, interest: null })]));
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    const row = (await screen.findByText("#05-123")).closest("a");
    expect(row).toHaveTextContent("Name not known");
    expect(row).not.toHaveTextContent("High");
  });

  it("marks a due date, or Overdue in words", async () => {
    apiFetch.mockResolvedValue(
      list([
        entry("#05-123", { notes: [note("a", { dueDate: new Date(2099, 0, 5).toISOString() })] }),
        entry("#06-201", { notes: [note("b", { dueDate: "2020-01-01T00:00:00.000Z" })] }),
      ]),
    );
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    expect(await screen.findByText("Due 5 Jan 2099")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("counts progress and marks visited and done households", async () => {
    apiFetch.mockResolvedValue(
      list([
        entry("#05-123"),
        entry("#06-201", { visited: true }),
        entry("#07-301", { notes: [note("c", { doneAt: STAMP })] }),
      ]),
    );
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    expect(await screen.findByText("2 of 3 visited or done")).toBeInTheDocument();
    expect(screen.getByText("Visited")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    // Nothing left to mark on a household already done; each names its door.
    expect(screen.getAllByRole("button", { name: /^Mark done/ }).map((b) => b.textContent)).toEqual(
      ["Mark done, #05-123", "Mark done, #06-201"],
    );
  });

  it("marks every outstanding note done with one tap's worth of requests, then re-reads", async () => {
    const owed = entry("#05-123", { notes: [note("a"), note("b"), note("c", { doneAt: STAMP })] });
    apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === "PATCH" ? {} : list([owed])),
    );
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    const button = await screen.findByRole("button", { name: "Mark done, #05-123" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => {
      expect(apiFetch.mock.calls.filter(([path]) => path === "/sessions/s1/revisits")).toHaveLength(
        2,
      );
    });
    const patches = apiFetch.mock.calls.filter(([, init]) => init !== undefined);
    expect(patches).toEqual([
      ["/follow-ups/a", { method: "PATCH", body: JSON.stringify({ done: true }) }],
      ["/follow-ups/b", { method: "PATCH", body: JSON.stringify({ done: true }) }],
    ]);
  });

  it("says why a Mark done failed, in its row", async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === "PATCH"
        ? Promise.reject(
            new ApiRequestError(409, { error: { code: "not_on_follow_up_list", message: "raw" } }),
          )
        : Promise.resolve(list([entry("#05-123")])),
    );
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done, #05-123" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can mark this done during a follow-up session that includes this household.",
    );
  });

  /* Disabled while it saves, the row's button loses focus to the page
     (#221). Held until it has, as a real refusal is (D-208-6). */
  it("gives focus back to the row's Mark done after a refusal", async () => {
    let refuse: (reason: unknown) => void = () => undefined;
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === "PATCH"
        ? new Promise((_, reject) => {
            refuse = reject;
          })
        : Promise.resolve(list([entry("#05-123")])),
    );
    const user = userEvent.setup();
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    const button = await screen.findByRole("button", { name: "Mark done, #05-123" });
    await user.click(button);
    await screen.findByRole("button", { name: "Saving…" });
    await focusDropped();

    refuse(new TypeError("Failed to fetch"));
    const alert = await screen.findByRole("alert");
    expect(button).toHaveFocus();
    expect(alert).not.toHaveFocus();
  });

  it("re-reads the list when one of a household's notes closes and the next is refused", async () => {
    // An admin removed the second note meanwhile: the first one is done all the same.
    const owed = entry("#05-123", { notes: [note("a"), note("b")] });
    const closed = entry("#05-123", { notes: [note("a", { doneAt: STAMP })] });
    let reads = 0;
    apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") {
        return path === "/follow-ups/a"
          ? Promise.resolve({})
          : Promise.reject(new ApiRequestError(404, undefined));
      }
      reads += 1;
      return Promise.resolve(list([reads === 1 ? owed : closed]));
    });
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done, #05-123" }));

    expect(await screen.findByText("1 of 1 visited or done")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mark done/ })).toBeNull();
    expect(reads).toBe(2);
  });

  it("cannot mark anything done offline", async () => {
    useOnline.mockReturnValue(false);
    apiFetch.mockResolvedValue(list([entry("#05-123")]));
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    expect(await screen.findByRole("button", { name: "Mark done, #05-123" })).toBeDisabled();
  });

  it("reopens a Done household's notes, then reads the list again", async () => {
    const done = entry("#05-123", {
      visited: true,
      notes: [note("a", { doneAt: DONE_TONIGHT }), note("b", { doneAt: DONE_TONIGHT })],
    });
    const reopened = entry("#05-123", { visited: true, notes: [note("a"), note("b")] });
    let reads = 0;
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return Promise.resolve({});
      reads += 1;
      return Promise.resolve(list([reads === 1 ? done : reopened]));
    });
    render(<RevisitList active={PICKED} tick={1} isAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reopen, #05-123" }));

    // Visited now, not Done, and still counted.
    expect(await screen.findByRole("button", { name: "Mark done, #05-123" })).toBeInTheDocument();
    expect(screen.getByText("Visited")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 visited or done")).toBeInTheDocument();
    expect(apiFetch.mock.calls.filter(([, init]) => init !== undefined)).toEqual([
      ["/follow-ups/a", { method: "PATCH", body: JSON.stringify({ done: false }) }],
      ["/follow-ups/b", { method: "PATCH", body: JSON.stringify({ done: false }) }],
    ]);
  });

  it("says a member's reopen waits on a suggestion at the door, instead of offering it", async () => {
    const waiting = { id: "u2", name: "Ann Lee", image: null };
    apiFetch.mockResolvedValue(
      list([
        entry("#05-123", {
          notes: [note("a", { doneAt: DONE_TONIGHT, waitingSuggestionBy: waiting })],
        }),
      ]),
    );
    render(<RevisitList active={PICKED} tick={1} isAdmin={false} />);
    expect(
      await screen.findByText(
        "Ann's suggestion for this door is waiting for an admin. Ask an admin to review it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reopen/ })).toBeNull();
  });

  it("lets an admin reopen there, and says the suggestion goes on the list too", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    const waiting = { id: "u2", name: "Ann Lee", image: null };
    apiFetch.mockResolvedValue(
      list([
        entry("#05-123", {
          notes: [note("a", { doneAt: DONE_TONIGHT, waitingSuggestionBy: waiting })],
        }),
      ]),
    );
    render(<RevisitList active={PICKED} tick={1} isAdmin />);
    expect(await screen.findByRole("button", { name: "Reopen, #05-123" })).toBeInTheDocument();
    expect(
      screen.getByText("Reopening also adds Ann's suggestion to the list."),
    ).toBeInTheDocument();
  });

  it("says a refused reopen once, and reads the list again", async () => {
    const done = entry("#05-123", { notes: [note("a", { doneAt: DONE_TONIGHT })] });
    let reads = 0;
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") {
        return Promise.reject(
          new ApiRequestError(409, { error: { code: "follow_up_exists", message: "raw" } }),
        );
      }
      reads += 1;
      return Promise.resolve(list([done]));
    });
    render(<RevisitList active={PICKED} tick={1} isAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reopen, #05-123" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not reopened.");
    await waitFor(() => {
      expect(reads).toBe(2);
    });
  });

  it("offers no reopen for a Done household the viewer could not reopen", async () => {
    // Off the running session's list as this phone knows it: the server would refuse.
    apiFetch.mockResolvedValue(
      list([entry("#05-123", { notes: [note("a", { doneAt: DONE_TONIGHT })] })]),
    );
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("tells a member who adds households, and how to check again", async () => {
    apiFetch.mockResolvedValue(list([]));
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    expect(await screen.findByText("No households on the list yet.")).toBeInTheDocument();
    expect(
      screen.getByText("An admin adds households to this session. Tap Refresh to check again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/of 0 visited/)).toBeNull();
  });

  it("takes an admin to the session's page to add households instead", async () => {
    apiFetch.mockResolvedValue(list([]));
    render(<RevisitList active={ACTIVE} tick={1} isAdmin />);
    expect(
      await screen.findByRole("link", { name: "Add households to this session" }),
    ).toHaveAttribute("href", "/admin/sessions/s1");
  });

  it("keeps a failed read to itself, with a way to try again", async () => {
    apiFetch.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(list([]));
    render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the follow-up list. Check your signal.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No households on the list yet.")).toBeInTheDocument();
    expect(noteRevisits).toHaveBeenCalledTimes(1);
  });

  it("re-reads with each tick, and lets only the newest answer land", async () => {
    let late: (value: unknown) => void = () => undefined;
    apiFetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            late = resolve;
          }),
      )
      .mockResolvedValue(list([]));
    const { rerender } = render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
    rerender(<RevisitList active={ACTIVE} tick={2} isAdmin={false} />);
    expect(await screen.findByText("No households on the list yet.")).toBeInTheDocument();
    late(list([entry("#05-123")]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("#05-123")).toBeNull();
  });

  it("ignores a late failure behind a newer answer", async () => {
    let fail: (reason: unknown) => void = () => undefined;
    apiFetch
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(list([]));
    const { rerender } = render(<RevisitList active={ACTIVE} tick={1} isAdmin={false} />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
    rerender(<RevisitList active={ACTIVE} tick={2} isAdmin={false} />);
    await screen.findByText("No households on the list yet.");
    fail(new TypeError("late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
