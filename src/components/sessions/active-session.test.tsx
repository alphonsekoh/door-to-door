import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveSessionScreen } from "@/components/sessions/active-session";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { knownSessionKind } from "@/lib/session/known-kind";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

/* What reaches the offline shell's copy (#77). */
const { noteOuting, noteBlock } = vi.hoisted(() => ({ noteOuting: vi.fn(), noteBlock: vi.fn() }));
vi.mock("@/components/sync/local-copy-writer", () => ({
  useLocalCopyWriter: () => ({ noteOuting, noteBlock }),
}));

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

/* Tested on its own; here only that it is given the session and the beat. */
vi.mock("@/components/follow-ups/revisit-list", () => ({
  RevisitList: ({
    active,
    tick,
    isAdmin,
  }: {
    active: { session: { id: string } };
    tick: number;
    isAdmin: boolean;
  }) => <p>{`revisits ${active.session.id} tick ${String(tick)} admin ${String(isAdmin)}`}</p>,
}));

vi.mock("@/components/teams/outing-team", () => ({
  OutingTeam: ({ sessionId, tick }: { sessionId: string; tick: number }) => (
    <p>{`team card ${sessionId} tick ${String(tick)}`}</p>
  ),
}));

const block = (name: string, over: Record<string, unknown> = {}) => ({
  block: { id: `b-${name}`, name, street: "Ang Mo Kio Ave 3", postalCode: null, createdAt: "" },
  visitCount: 0,
  householdCount: 0,
  activeMembers: [],
  ...over,
});

const session = (blocks: unknown[], kind = "regular") => ({
  session: {
    id: "s1",
    title: "March outing",
    kind,
    status: "active",
    startedAt: null,
    endedAt: null,
    createdBy: { id: "u1", name: "Admin", image: null },
    createdAt: "",
  },
  blocks,
});

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("no active session", () => {
  it("says so plainly rather than showing an error", async () => {
    // A quiet evening is a normal state, not a failure.
    apiFetch.mockRejectedValue(new ApiRequestError(404, undefined));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("No session is running.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("with blocks", () => {
  it("lists each block for the member to pick", async () => {
    apiFetch.mockResolvedValue(session([block("123"), block("125")]));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("Blk 123")).toBeInTheDocument();
    expect(screen.getByText("Blk 125")).toBeInTheDocument();
  });

  it("links each block to its recording screen", async () => {
    apiFetch.mockResolvedValue(session([block("123")]));
    render(<ActiveSessionScreen />);
    expect(await screen.findByRole("link", { name: /Blk 123/ })).toHaveAttribute(
      "href",
      "/blocks/b-123",
    );
  });

  it("shows progress so far", async () => {
    apiFetch.mockResolvedValue(session([block("123", { householdCount: 6, visitCount: 8 })]));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("6")).toBeInTheDocument();
    // This session's units, not the block's size.
    expect(screen.getByText("visited in this session")).toBeInTheDocument();
    // Visits only shown when they exceed units, or it is noise.
    expect(screen.getByText("8 visits")).toBeInTheDocument();
  });

  it("hides the visit count when it matches the unit count", async () => {
    apiFetch.mockResolvedValue(session([block("123", { householdCount: 3, visitCount: 3 })]));
    render(<ActiveSessionScreen />);
    await screen.findByText("Blk 123");
    expect(screen.queryByText("3 visits")).not.toBeInTheDocument();
  });

  it("says who is already working a block, without locking it", async () => {
    /*
     * Blocks are shared. Naming who is here lets a pair split floors; it must
     * not read as "taken".
     */
    apiFetch.mockResolvedValue(
      session([block("123", { activeMembers: [{ id: "u2", name: "Ben", image: null }] })]),
    );
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("Ben here now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Blk 123/ })).toBeInTheDocument();
  });

  it("falls back to a placeholder for a member with no name", async () => {
    apiFetch.mockResolvedValue(
      session([block("123", { activeMembers: [{ id: "u2", name: null, image: null }] })]),
    );
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("Someone here now")).toBeInTheDocument();
  });

  it("says the same for one unit, with no plural to get wrong", async () => {
    apiFetch.mockResolvedValue(session([block("123", { householdCount: 1, visitCount: 1 })]));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByText("visited in this session")).toBeInTheDocument();
  });
});

describe("a session with no blocks yet", () => {
  it("explains that an admin can add them mid-outing", async () => {
    apiFetch.mockResolvedValue(session([]));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("No blocks yet.")).toBeInTheDocument();
    expect(screen.getByText(/add blocks while the session is running/)).toBeInTheDocument();
  });
});

describe("the team card", () => {
  it("is shown for the running outing", async () => {
    apiFetch.mockResolvedValue(session([block("123")]));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText(/team card s1 tick 1/)).toBeInTheDocument();
  });

  it("is told to re-read whenever the screen does", async () => {
    apiFetch.mockResolvedValue(session([block("123")]));
    render(<ActiveSessionScreen />);
    await screen.findByText(/tick 1/);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/tick 2/)).toBeInTheDocument();
  });

  it("is absent when no outing is running", async () => {
    apiFetch.mockRejectedValue(new ApiRequestError(404, undefined));
    render(<ActiveSessionScreen />);
    await screen.findByText("No session is running.");
    expect(screen.queryByText(/team card/)).not.toBeInTheDocument();
  });
});

describe("refreshing", () => {
  it("picks up a block an admin added", async () => {
    // The contingency path: no one should have to restart the app.
    apiFetch.mockResolvedValueOnce(session([block("123")]));
    render(<ActiveSessionScreen />);
    await screen.findByText("Blk 123");

    apiFetch.mockResolvedValueOnce(session([block("123"), block("127")]));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Blk 127")).toBeInTheDocument();
  });

  it("polls without the member touching anything", async () => {
    vi.useFakeTimers();
    apiFetch.mockResolvedValue(session([block("123")]));
    render(<ActiveSessionScreen />);
    await vi.advanceTimersByTimeAsync(0);
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("stops polling once the screen is gone", async () => {
    vi.useFakeTimers();
    apiFetch.mockResolvedValue(session([block("123")]));
    const { unmount } = render(<ActiveSessionScreen />);
    await vi.advanceTimersByTimeAsync(0);
    unmount();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe("when loading fails", () => {
  it("shows the message and offers a retry", async () => {
    apiFetch.mockRejectedValue(new ApiRequestError(500, undefined));
    render(<ActiveSessionScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");

    apiFetch.mockResolvedValue(session([block("123")]));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(screen.getByText("Blk 123")).toBeInTheDocument();
    });
  });

  it("handles a failure that is not an ApiRequestError", async () => {
    apiFetch.mockRejectedValue(new Error("Network down"));
    render(<ActiveSessionScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
  });

  it("copes with something thrown that is not an Error", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<ActiveSessionScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the session.");
  });
});

describe("the offline copy", () => {
  it("is given each outing the screen loads", async () => {
    const data = session([block("123")]);
    apiFetch.mockResolvedValue(data);
    render(<ActiveSessionScreen />);
    await waitFor(() => {
      expect(noteOuting).toHaveBeenCalledWith(data);
    });
  });

  it("is told no outing is running on a 404", async () => {
    apiFetch.mockRejectedValue(new ApiRequestError(404, undefined));
    render(<ActiveSessionScreen />);
    await screen.findByText("No session is running.");
    expect(noteOuting).toHaveBeenCalledWith(null);
  });

  it.each([
    ["a server failure", new ApiRequestError(500, undefined)],
    ["no signal", new TypeError("Failed to fetch")],
  ])("is left alone after %s, which says nothing about the outing", async (_, failure) => {
    apiFetch.mockRejectedValue(failure);
    render(<ActiveSessionScreen />);
    await screen.findByRole("alert");
    expect(noteOuting).not.toHaveBeenCalled();
  });
});

describe("what the next screen is told", () => {
  it("is the kind of session running, so a block opens knowing it", async () => {
    apiFetch.mockResolvedValue(session([block("123")], "follow_up"));
    render(<ActiveSessionScreen />);
    await waitFor(() => {
      expect(knownSessionKind.getSnapshot()).toBe("follow_up");
    });
  });

  it("is that none is running on a 404, and nothing after a failure", async () => {
    apiFetch.mockRejectedValue(new ApiRequestError(404, undefined));
    const view = render(<ActiveSessionScreen />);
    await screen.findByText("No session is running.");
    expect(knownSessionKind.getSnapshot()).toBeNull();
    view.unmount();

    knownSessionKind.forget();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ActiveSessionScreen />);
    await screen.findByRole("alert");
    expect(knownSessionKind.getSnapshot()).toBeUndefined();
  });
});

describe("a follow-up session", () => {
  it("says what kind of session it is and what it allows", async () => {
    apiFetch.mockResolvedValue(session([block("123")], "follow_up"));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("Follow-up")).toBeInTheDocument();
    expect(
      screen.getByText(/Visits can be recorded only at the households below\.$/),
    ).toBeInTheDocument();
    // Said at any hour: a session is not always in the evening.
    expect(screen.queryByText(/Tonight/)).toBeNull();
  });

  it("asks a member to tap a household, not to pick a block", async () => {
    // There are no block cards to pick in a follow-up session.
    apiFetch.mockResolvedValue(session([block("123")], "follow_up"));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("Tap a household to record your visit.")).toBeVisible();
    expect(screen.queryByText("Pick a block to start recording.")).toBeNull();
  });

  it("asks for a block in a door-to-door session, and nothing until the kind is known", async () => {
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    render(<ActiveSessionScreen />);
    expect(screen.getByRole("heading", { name: "Active session" })).toBeVisible();
    expect(screen.queryByText(/Pick a block|Tap a household/)).toBeNull();
    answer(session([block("123")]));
    expect(await screen.findByText("Pick a block to start recording.")).toBeVisible();
  });

  it("tells an admin they can still record any unit, and where", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    apiFetch.mockResolvedValue(session([block("123"), block("125")], "follow_up"));
    render(<ActiveSessionScreen />);
    expect(
      await screen.findByText(/As an admin you can record any unit in this session's blocks\./),
    ).toBeVisible();
    expect(screen.getByText(/admin true/)).toBeInTheDocument();
    // A block with nobody on the list is still reachable from here.
    const blocks = screen.getByRole("region", { name: "Blocks in this session" });
    expect(within(blocks).getByRole("link", { name: /Blk 125/ })).toHaveAttribute(
      "href",
      "/blocks/b-125",
    );
  });

  it("leaves the admin's block list out when the session has no blocks", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    apiFetch.mockResolvedValue(session([], "follow_up"));
    render(<ActiveSessionScreen />);
    await screen.findByText(/admin true/);
    expect(screen.queryByRole("region", { name: "Blocks in this session" })).toBeNull();
  });

  it("drives the screen from the list of households, not the block cards", async () => {
    apiFetch.mockResolvedValue(session([block("123")], "follow_up"));
    render(<ActiveSessionScreen />);
    expect(await screen.findByText("revisits s1 tick 1 admin false")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Blk 123/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Blocks in this session" })).toBeNull();
    // The team card still works as in any session.
    expect(screen.getByText(/team card s1/)).toBeInTheDocument();
  });

  it("re-reads the list with every refresh", async () => {
    apiFetch.mockResolvedValue(session([], "follow_up"));
    render(<ActiveSessionScreen />);
    await screen.findByText(/revisits s1 tick 1/);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/revisits s1 tick 2/)).toBeInTheDocument();
  });

  it("explains how it works once, until dismissed on this phone", async () => {
    apiFetch.mockResolvedValue(session([block("123")], "follow_up"));
    render(<ActiveSessionScreen />);
    const hint = await screen.findByRole("region", { name: "How a follow-up session works" });
    expect(hint).toHaveTextContent("When the follow-up is finished, tap Mark done.");
    // The same way to ask for a household as everywhere else.
    expect(hint).toHaveTextContent("Type its unit in the block and tap Suggest a return visit");
    expect(hint).not.toHaveTextContent(/ask an admin/i);
    fireEvent.click(within(hint).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "How a follow-up session works" })).toBeNull();
  });

  it("carries no badge or rule for a door-to-door session", async () => {
    apiFetch.mockResolvedValue(session([block("123")]));
    render(<ActiveSessionScreen />);
    await screen.findByText("Blk 123");
    expect(screen.queryByText("Follow-up")).toBeNull();
    expect(screen.queryByText(/revisits/)).toBeNull();
  });
});
