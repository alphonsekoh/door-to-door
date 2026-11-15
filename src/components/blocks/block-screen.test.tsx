import { act, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { BlockScreen } from "@/components/blocks/block-screen";
import { ApiRequestError } from "@/lib/api-client";
import { knownSessionKind } from "@/lib/session/known-kind";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";
import { landWhileTyping } from "../../../test/land-while-typing";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { noteOuting, noteBlock, noteRevisits } = vi.hoisted(() => ({
  noteOuting: vi.fn(),
  noteBlock: vi.fn(),
  noteRevisits: vi.fn(),
}));
vi.mock("@/components/sync/local-copy-writer", () => ({
  useLocalCopyWriter: () => ({ noteOuting, noteBlock, noteRevisits }),
}));

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

/* Unavailable unless a test says otherwise, so a save goes straight to the
   server as it does where IndexedDB cannot be opened. */
const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync/sync-provider", () => ({ useSyncQueue }));
const NO_QUEUE = {
  records: [] as QueuedVisit[],
  inFlight: new Set<string>(),
  justSaved: new Set<string>(),
  block: null,
  syncedVersion: 0,
  ownerId: undefined,
  enqueue: null,
  retry: vi.fn(),
  retryAll: vi.fn(),
};

type Author = { id: string; name: string };
const BEN: Author = { id: "u1", name: "Ben Lim" };

const list = (units: string[], author: Author = BEN, teamId: string | null = null) => ({
  data: units.map((unitNumber, i) => ({
    household: {
      id: `h${String(i)}`,
      blockId: "b1",
      unitNumber,
      name: null,
      contact: null,
      religion: null,
      createdAt: "",
      updatedAt: "",
    },
    visitCount: 1,
    latestVisit: {
      id: `v${String(i)}`,
      householdId: `h${String(i)}`,
      sessionId: "s1",
      member: { ...author, image: null },
      team: teamId === null ? null : { id: teamId, name: "Ann & Ben", members: [] },
      interestLevel: "low" as const,
      description: "",
      clientCreatedAt: "",
      createdAt: "",
      updatedAt: "",
    },
    outstandingFollowUps: 0,
  })),
  pagination: { limit: 100, offset: 0, total: units.length, hasMore: false },
});

const B1 = {
  block: { id: "b1", name: "123", street: "Ang Mo Kio Ave 3", postalCode: null, createdAt: "" },
  visitCount: 0,
  householdCount: 0,
  activeMembers: [],
};
const active = { session: { id: "s1", title: "Tonight", kind: "regular" }, blocks: [B1] };

/* Routes by path so the two loads can differ, and so a test that breaks one
   does not silently satisfy the other. */
function serve(households: unknown, session: unknown = active, teams: unknown = { data: [] }) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/sessions/active")) return Promise.resolve(session);
    if (path === "/sessions/s1/teams") return Promise.resolve(teams);
    return Promise.resolve(households);
  });
}

/* A test's own answers. The screen asks for the viewer's team once it knows
   the session and the viewer, which on a slow runner can be after a test has
   swapped its answers in (#186), so that path always gets a team list. */
function answerWith(answer: (path: string) => Promise<unknown>) {
  apiFetch.mockImplementation((path: string) =>
    path.endsWith("/teams") ? Promise.resolve({ data: [] }) : answer(path),
  );
}

const teamOf = (id: string, memberIds: string[]) => ({
  data: [
    {
      id,
      sessionId: "s1",
      name: "Ann & Ben",
      members: memberIds.map((member) => ({ id: member, name: member, image: null })),
      createdAt: "",
    },
  ],
});

type Late = { resolve: (value: unknown) => void; reject: (error: unknown) => void };

async function openUnit(unitNumber: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "All units (1)" }));
  await user.click(screen.getByRole("button", { name: new RegExp(unitNumber) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useSyncQueue.mockReturnValue(NO_QUEUE);
  useRole.mockReturnValue({
    userId: "u1",
    role: "member",
    isAdmin: false,
    isMember: true,
    isLoading: false,
    isSignedIn: true,
  });
});

describe("BlockScreen", () => {
  it("is named for its block once the outing says which one it is, with a way back", async () => {
    serve(list([]));
    render(<BlockScreen blockId="b1" />);
    // Generic only until the outing answers, and a stand-in held to one line
    // until then, so the form does not jump up as the name arrives (#181).
    expect(screen.getByRole("heading", { level: 1, name: "Record a visit" })).toHaveClass(
      "truncate",
    );
    const named = await screen.findByRole("heading", { level: 1, name: "Blk 123" });
    expect(named).not.toHaveClass("truncate");
    expect(screen.getByText("Ang Mo Kio Ave 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Session" })).toHaveAttribute("href", "/");
  });

  it.each([
    ["door-to-door", "regular", "Visits can be recorded only in the session's blocks."],
    [
      "follow-up",
      "follow_up",
      "Visits can be recorded only at the households on the session's list.",
    ],
  ])(
    "says a block its %s session does not cover is not in it, and offers no form",
    async (_, kind, rule) => {
      // Opened from a bookmark or a stale tab.
      serve(list(["#05-123"]), { ...active, session: { ...active.session, kind }, blocks: [] });
      render(<BlockScreen blockId="b1" />);
      const notice = await screen.findByRole("status");
      expect(notice).toHaveTextContent("This block is not in the running session.");
      expect(notice).toHaveTextContent(`${rule} Pick one on the Session screen.`);
      expect(within(notice).getByRole("link", { name: "Go to Session" })).toHaveAttribute(
        "href",
        "/",
      );
      // The answer is in: the generic title is this screen's own now, whole.
      expect(screen.getByRole("heading", { level: 1, name: "Record a visit" })).not.toHaveClass(
        "truncate",
      );
      expect(screen.queryByText("One unit at a time.")).toBeNull();
      expect(screen.queryByLabelText("Unit number")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    },
  );

  it("offers the form while no session is known, as a save asks again", async () => {
    answerWith((path) =>
      path.startsWith("/sessions/active")
        ? Promise.reject(new ApiRequestError(404, undefined))
        : Promise.resolve(list([])),
    );
    render(<BlockScreen blockId="b1" />);
    // "Save and next" is drawn only once the 404 has landed.
    expect(await screen.findByRole("button", { name: "Save and next" })).toBeInTheDocument();
    expect(screen.getByLabelText("Unit number")).toBeInTheDocument();
    expect(screen.getByText("One unit at a time.")).toBeInTheDocument();
    // Still standing in: a save asks again, and a running session names it.
    expect(screen.getByRole("heading", { level: 1, name: "Record a visit" })).toHaveClass(
      "truncate",
    );
  });

  it("loads the units already recorded on this block", async () => {
    serve(list(["#05-123", "#05-124"]));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("tab", { name: "All units (2)" })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/households?blockId=b1&limit=100&offset=0");
  });

  describe("on a block of more than one page (#127)", () => {
    /* A hundred units that sort first, then the real one they pushed off page one. */
    const junk = Array.from({ length: 100 }, (_, i) => `#00-${String(i).padStart(3, "0")}`);
    const pageOf = (units: string[], offset: number, hasMore: boolean) => {
      const page = list(units);
      return {
        data: page.data.map((entry, i) => ({
          ...entry,
          household: { ...entry.household, id: `h${String(offset + i)}` },
          latestVisit: { ...entry.latestVisit, id: `v${String(offset + i)}` },
        })),
        pagination: { limit: 100, offset, total: 101, hasMore },
      };
    };
    const first = pageOf(junk, 0, true);
    const second = pageOf(["#09-999"], 100, false);
    const historyOf = (entry: (typeof first.data)[number] | undefined, description: string) => ({
      household: entry?.household,
      block: B1.block,
      visits: [
        {
          ...entry?.latestVisit,
          description,
          clientCreatedAt: "2026-03-14T10:00:00.000Z",
          createdAt: "2026-03-14T10:00:00.000Z",
          updatedAt: "2026-03-14T10:00:00.000Z",
        },
      ],
      answered: true,
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false },
      followUps: [],
    });
    const histories: Record<string, unknown> = {
      "/households/h5?limit=20&offset=0": historyOf(first.data[5], "Came to the door in May."),
      "/households/h100?limit=20&offset=0": historyOf(
        second.data[0],
        "Asked us to come back in June.",
      ),
    };

    function servePages(
      secondPage: () => Promise<unknown> = () => Promise.resolve(second),
      firstPage: () => Promise<unknown> = () => Promise.resolve(first),
    ) {
      apiFetch.mockImplementation((path: string) => {
        if (path.startsWith("/sessions/active")) return Promise.resolve(active);
        if (path === "/sessions/s1/teams") return Promise.resolve({ data: [] });
        if (path in histories) return Promise.resolve(histories[path]);
        if (path.endsWith("offset=100")) return secondPage();
        return firstPage();
      });
    }
    const syncs = (view: ReturnType<typeof render>, version: number) => {
      useSyncQueue.mockReturnValue({ ...NO_QUEUE, syncedVersion: version });
      view.rerender(<BlockScreen blockId="b1" />);
    };
    const partNote = /Not every unit of this block could be loaded/;

    it("reads the next page, and shows the history of a unit only it has", async () => {
      servePages();
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);
      expect(await screen.findByRole("tab", { name: "All units (101)" })).toBeInTheDocument();
      expect(apiFetch).toHaveBeenCalledWith("/households?blockId=b1&limit=100&offset=100");

      await user.type(screen.getByLabelText("Unit number"), "#09-999");
      expect(await screen.findByText("Asked us to come back in June.")).toBeInTheDocument();
    });

    it("writes the offline copy once, from every page, never from the first alone", async () => {
      servePages();
      render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (101)" });
      await waitFor(() => {
        expect(noteBlock).toHaveBeenCalledTimes(1);
      });
      expect(noteBlock).toHaveBeenCalledWith(active, "b1", [...first.data, ...second.data]);
    });

    it("keeps the units it has, and says so, when a later page fails", async () => {
      servePages();
      const view = render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (101)" });

      servePages(() => Promise.reject(new Error("Could not reach the server.")));
      useSyncQueue.mockReturnValue({ ...NO_QUEUE, syncedVersion: 1 });
      view.rerender(<BlockScreen blockId="b1" />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
      expect(screen.getByRole("tab", { name: "All units (101)" })).toBeInTheDocument();
      expect(noteBlock).toHaveBeenCalledTimes(1);
    });

    it("shows the units that arrived when a later page drops on first open, and saves none", async () => {
      servePages(() => Promise.reject(new TypeError("Load failed")));
      const user = userEvent.setup();
      const view = render(<BlockScreen blockId="b1" />);
      expect(await screen.findByRole("tab", { name: "All units (100)" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Load failed");
      await screen.findByRole("heading", { level: 1, name: "Blk 123" });

      // A unit on the page that did arrive still shows its history.
      await user.type(screen.getByLabelText("Unit number"), "#00-005");
      expect(await screen.findByText("Came to the door in May.")).toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: "All units (100)" }));
      expect(screen.getByText(partNote)).toBeInTheDocument();
      // Part of the block must never stand in for all of it on the phone.
      expect(noteBlock).not.toHaveBeenCalled();

      // The next whole read replaces them, newer copies and all, and is saved.
      const fresher = {
        ...first,
        data: first.data.map((entry, i) =>
          i === 5
            ? { ...entry, latestVisit: { ...entry.latestVisit, interestLevel: "high" as const } }
            : entry,
        ),
      };
      servePages(undefined, () => Promise.resolve(fresher));
      syncs(view, 1);
      expect(await screen.findByRole("tab", { name: "All units (101)" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(partNote)).toBeNull();
      expect(
        within(screen.getByRole("button", { name: /#00-005/ })).getByText("High"),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(noteBlock).toHaveBeenCalledTimes(1);
      });
      expect(noteBlock).toHaveBeenCalledWith(active, "b1", [...fresher.data, ...second.data]);
    });

    it("never takes away a unit shown because a later read got less", async () => {
      servePages(() => Promise.reject(new TypeError("Load failed")));
      const view = render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (100)" });

      // The next read loses its first page, so it has nothing at all.
      servePages(undefined, () => Promise.reject(new TypeError("Failed to fetch")));
      syncs(view, 1);
      expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
      expect(screen.getByRole("tab", { name: "All units (100)" })).toBeInTheDocument();
    });

    it("lays a later read's pages over a whole one without saving them", async () => {
      servePages();
      const user = userEvent.setup();
      const view = render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (101)" });
      await waitFor(() => {
        expect(noteBlock).toHaveBeenCalledTimes(1);
      });

      // A unit added since sorts first, and the page after it drops.
      const added = pageOf(["#00-000a"], 200, true).data;
      servePages(
        () => Promise.reject(new TypeError("Load failed")),
        () => Promise.resolve({ ...first, data: [...added, ...first.data.slice(0, 99)] }),
      );
      syncs(view, 1);
      await user.click(await screen.findByRole("tab", { name: "All units (102)" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Load failed");
      // Every unit was read whole before, so nothing is said to be missing.
      expect(screen.getByLabelText("Search this block")).toBeInTheDocument();
      expect(screen.queryByText(partNote)).toBeNull();
      expect(noteBlock).toHaveBeenCalledTimes(1);
    });

    /* A promise settles once, so the late answer and the late failure each
       need their own first read. */
    it.each([
      [
        "answer",
        (late: Late) => {
          late.resolve(pageOf(["#00-000"], 100, false));
        },
      ],
      [
        "failure",
        (late: Late) => {
          late.reject(new Error("late"));
        },
      ],
    ])("never lets a late %s for an older read replace a newer whole one", async (_, settle) => {
      const late: Late = { resolve: () => undefined, reject: () => undefined };
      let reads = 0;
      servePages(() => {
        reads += 1;
        return reads === 1
          ? new Promise((resolve, reject) => {
              late.resolve = resolve;
              late.reject = reject;
            })
          : Promise.resolve(second);
      });
      const view = render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(reads).toBe(1);
      });

      // A record reaching the server starts a second read while the first still pages.
      useSyncQueue.mockReturnValue({ ...NO_QUEUE, syncedVersion: 1 });
      view.rerender(<BlockScreen blockId="b1" />);
      expect(await screen.findByRole("tab", { name: "All units (101)" })).toBeInTheDocument();

      await act(async () => {
        settle(late);
        await Promise.resolve();
      });
      expect(screen.getByRole("tab", { name: "All units (101)" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(noteBlock).toHaveBeenCalledTimes(1);
    });

    /* Slow 3G: a whole read takes longer than the gap between two saves, so
       each sync starts a read while the last one still pages. */
    it("lands each read as it ends, though a newer one has started", async () => {
      let reads = 0;
      const lastPages: Late[] = [];
      servePages(() => {
        reads += 1;
        return reads === 1
          ? Promise.resolve(second)
          : new Promise((resolve, reject) => {
              lastPages.push({ resolve, reject });
            });
      });
      const view = render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (101)" });

      syncs(view, 1);
      await waitFor(() => {
        expect(lastPages).toHaveLength(1);
      });
      syncs(view, 2);
      await waitFor(() => {
        expect(lastPages).toHaveLength(2);
      });

      const sentOne = pageOf(["#09-999", "#10-001"], 100, false);
      lastPages[0]?.resolve(sentOne);
      expect(await screen.findByRole("tab", { name: "All units (102)" })).toBeInTheDocument();
      await waitFor(() => {
        expect(noteBlock).toHaveBeenLastCalledWith(active, "b1", [...first.data, ...sentOne.data]);
      });

      lastPages[1]?.resolve(pageOf(["#09-999", "#10-001", "#10-002"], 100, false));
      expect(await screen.findByRole("tab", { name: "All units (103)" })).toBeInTheDocument();
    });

    it("lands an older whole read after a newer one failed, keeping what that one showed", async () => {
      const added = pageOf(["#00-000a"], 200, true).data;
      let firstPages = 0;
      let lastPage: Late = { resolve: () => undefined, reject: () => undefined };
      let lastPageAsked = false;
      servePages(
        () =>
          lastPageAsked
            ? Promise.reject(new TypeError("Load failed"))
            : new Promise((resolve, reject) => {
                lastPageAsked = true;
                lastPage = { resolve, reject };
              }),
        () => {
          firstPages += 1;
          return Promise.resolve(
            firstPages === 1 ? first : { ...first, data: [...added, ...first.data.slice(0, 99)] },
          );
        },
      );
      const user = userEvent.setup();
      const view = render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(lastPageAsked).toBe(true);
      });

      // The newer read loses its last page first: what it got is shown, not saved.
      syncs(view, 1);
      expect(await screen.findByRole("alert")).toHaveTextContent("Load failed");
      expect(screen.getByRole("tab", { name: "All units (100)" })).toBeInTheDocument();

      // The older read then ends whole: it lands and is saved, under the unit
      // the newer one found, and the failure is still said.
      await act(async () => {
        lastPage.resolve(second);
        await Promise.resolve();
      });
      await user.click(await screen.findByRole("tab", { name: "All units (102)" }));
      expect(screen.getByText("#00-000a")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Load failed");
      expect(screen.queryByText(partNote)).toBeNull();
      await waitFor(() => {
        expect(noteBlock).toHaveBeenCalledWith(active, "b1", [...first.data, ...second.data]);
      });
    });
  });

  it("has Save where it docks in the server's HTML, then hands it to the form", async () => {
    serve(list([]));
    const container = document.createElement("div");
    container.innerHTML = renderToString(<BlockScreen blockId="b1" />);
    // With no script yet there is nothing to save with, and it says so (#156).
    const first = within(container).getByRole("button", { name: "Getting ready…" });
    expect(first).toBeDisabled();
    expect(within(container).queryByRole("button", { name: /^Save/ })).toBeNull();
    // At the end of the screen, where it can rise to the nav at any text
    // size; and a tap must not reload the page.
    expect(container.querySelector("form")).not.toContainElement(first);
    expect(first).toHaveAttribute("type", "button");

    render(<BlockScreen blockId="b1" />);
    const save = await screen.findByRole("button", { name: "Save and next" });
    expect(save).toBeEnabled();
    expect(save).toHaveAttribute("type", "submit");
    expect(save).toHaveAttribute("form", document.querySelector("form")?.id);
    // The same box, so nothing moves as one replaces the other.
    expect(save).toHaveClass(first.className, { exact: true });
    expect(screen.queryByRole("button", { name: "Getting ready…" })).toBeNull();
  });

  /* On a slow connection the server's HTML is up well before its script
     (#113): what the member typed and picked then must survive the screen
     going live, which re-renders the form as Save moves in. */
  it("keeps what was typed and picked into the server's HTML once it is live", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    const page = <BlockScreen blockId="b1" initialUnit="#05-123" />;
    const container = document.createElement("div");
    container.innerHTML = renderToString(page);
    document.body.append(container);
    onTestFinished(() => {
      container.remove();
    });
    const field = within(container).getByLabelText("Unit number");
    if (!(field instanceof HTMLInputElement)) throw new Error("the unit field is not an input");
    field.value = "#05-124";
    within(container).getByRole("radio", { name: "Low" }).click();
    // The stand-in: with no script yet, a tap on it does nothing.
    within(container).getByRole("button", { name: "Getting ready…" }).click();

    const mismatch = vi.fn();
    const root = await act(() => hydrateRoot(container, page, { onRecoverableError: mismatch }));
    onTestFinished(() => {
      act(() => {
        root.unmount();
      });
    });
    await screen.findByRole("tab", { name: "All units (1)" });

    expect(mismatch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Unit number")).toHaveValue("#05-124");
    expect(screen.getByRole("radio", { name: "Low" })).toBeChecked();
    expect(screen.queryByText(/Not saved/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/visits", expect.objectContaining({ method: "POST" }));
    });
    const sent = apiFetch.mock.calls.find(([path]) => path === "/visits")?.[1] as { body: string };
    expect(JSON.parse(sent.body)).toMatchObject({ unitNumber: "#05-124", interestLevel: "low" });
  });

  /* WebKit can run the screen's answers inside the event of text landing in
     the unit field (#155): each must land without putting back the unit
     the field held before. */
  it("keeps a unit typed as the screen's first answers land", async () => {
    let answerSession: (value: unknown) => void = () => undefined;
    let answerUnits: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) {
        return new Promise((resolve) => {
          answerSession = resolve;
        });
      }
      if (path.startsWith("/households?")) {
        return new Promise((resolve) => {
          answerUnits = resolve;
        });
      }
      return new Promise(() => undefined);
    });
    render(<BlockScreen blockId="b1" initialUnit="#05-123" />);
    const field = screen.getByLabelText<HTMLInputElement>("Unit number");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(2);
    });

    await landWhileTyping(field, "#09-999", () => {
      answerSession(active);
      answerUnits(list(["#05-123"]));
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Blk 123" })).toBeInTheDocument();
    await screen.findByRole("tab", { name: "All units (1)" });
    expect(field).toHaveValue("#09-999");
    await waitFor(() => {
      expect(knownSessionKind.getSnapshot()).toBe("regular");
    });
    expect(field).toHaveValue("#09-999");
  });

  it("keeps a unit typed as the viewer's team lands", async () => {
    let answerTeams: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/sessions/s1/teams") {
        return new Promise((resolve) => {
          answerTeams = resolve;
        });
      }
      if (path.startsWith("/households?")) {
        return Promise.resolve(list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"));
      }
      // The picked unit's history: not what this is about.
      return new Promise(() => undefined);
    });
    render(<BlockScreen blockId="b1" initialUnit="#05-123" />);
    const field = screen.getByLabelText<HTMLInputElement>("Unit number");
    await screen.findByRole("tab", { name: "All units (1)" });
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });

    await landWhileTyping(field, "#09-999", () => {
      answerTeams(teamOf("t1", ["ann", "u1"]));
    });

    expect(field).toHaveValue("#09-999");
    // The team landed all the same: a teammate's unit opens for amending.
    await openUnit("#05-123");
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("opens on the recording form, not the list", async () => {
    // At a door the form is the whole job; the list is for between floors.
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("button", { name: "Save and next" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Record" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the unit list and back", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });

    await user.click(screen.getByRole("tab", { name: "All units (1)" }));
    expect(screen.getByLabelText("Search this block")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save and next" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Record" }));
    expect(screen.getByRole("button", { name: "Save and next" })).toBeInTheDocument();
  });

  it("still shows the form when the unit list fails to load", async () => {
    // Recording must not depend on the history lookup succeeding.
    apiFetch.mockRejectedValue(new Error("Could not reach the server."));
    render(<BlockScreen blockId="b1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
    // Nor on the session: unknown, it is a plain Save.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  describe("Save's promise of a next unit", () => {
    const followUpSession = { ...active, session: { ...active.session, kind: "follow_up" } };

    it("is not made until the session is known, then kept for door-to-door", async () => {
      let answer: (value: unknown) => void = () => undefined;
      apiFetch.mockImplementation((path: string) => {
        if (path.startsWith("/sessions/active")) {
          return new Promise((resolve) => {
            answer = resolve;
          });
        }
        return Promise.resolve(path.startsWith("/households") ? list([]) : { data: [] });
      });
      render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (0)" });
      expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "submit");

      act(() => {
        answer(active);
      });
      expect(await screen.findByRole("button", { name: "Save and next" })).toBeInTheDocument();
    });

    it("is never made in a follow-up session, from the server's HTML on", async () => {
      apiFetch.mockImplementation((path: string) => {
        if (path.startsWith("/sessions/active")) return Promise.resolve(followUpSession);
        return Promise.resolve(path.startsWith("/households") ? list([]) : { data: [] });
      });
      const container = document.createElement("div");
      container.innerHTML = renderToString(<BlockScreen blockId="b1" />);
      expect(within(container).getByRole("button", { name: "Getting ready…" })).toHaveAttribute(
        "type",
        "button",
      );
      expect(within(container).queryByRole("button", { name: /^Save/ })).toBeNull();

      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/revisits");
      });
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save and next" })).toBeNull();
    });

    it.each([
      ["a follow-up session", "follow_up", "Save"],
      ["a door-to-door session", "regular", "Save and next"],
      ["no session", null, "Save and next"],
    ] as const)(
      "is what the screen before it learnt, %s, from the first frame",
      (_, kind, label) => {
        knownSessionKind.note(kind);
        apiFetch.mockReturnValue(new Promise(() => undefined));
        render(<BlockScreen blockId="b1" />);
        expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      },
    );

    it("tells the next screen what it learnt", async () => {
      serve(list([]), followUpSession);
      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(knownSessionKind.getSnapshot()).toBe("follow_up");
      });
    });

    it("tells the next screen no session is running", async () => {
      answerWith((path) =>
        path.startsWith("/sessions/active")
          ? Promise.reject(new ApiRequestError(404, undefined))
          : Promise.resolve(list([])),
      );
      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(knownSessionKind.getSnapshot()).toBeNull();
      });
    });
  });

  it("copes with a non-Error failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<BlockScreen blockId="b1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this block.");
  });

  it("still lists units when the running session cannot be identified", async () => {
    const user = userEvent.setup();
    answerWith((path) =>
      path.startsWith("/sessions/active")
        ? Promise.reject(new Error("No session is active."))
        : Promise.resolve(list(["#05-123"])),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });

    await user.click(screen.getByRole("tab", { name: "All units (1)" }));
    expect(screen.getByText("#05-123")).toBeInTheDocument();
    expect(screen.queryByText("this session")).not.toBeInTheDocument();
  });

  it("reloads the unit list after a visit is recorded", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });

    answerWith((path) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/visits") return Promise.resolve({});
      return Promise.resolve(list(["#05-123", "#05-124"]));
    });

    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "All units (2)" })).toBeInTheDocument();
    });
  });

  it("reloads the unit list after an amendment", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });

    await user.click(screen.getByRole("tab", { name: "All units (1)" }));
    await user.click(screen.getByRole("button", { name: /#05-123/ }));
    await user.click(screen.getByRole("radio", { name: "High" }));

    answerWith((path) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/visits/v0") return Promise.resolve({});
      return Promise.resolve(list(["#05-123", "#05-124"]));
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "All units (2)" })).toBeInTheDocument();
    });
  });

  it("shows who recorded each unit, in words", async () => {
    const user = userEvent.setup();
    serve(list(["#05-123"]));
    render(<BlockScreen blockId="b1" />);
    await user.click(await screen.findByRole("tab", { name: "All units (1)" }));
    expect(screen.getByText("By Ben Lim")).toBeInTheDocument();
  });

  it("opens a current teammate's unit for amending", async () => {
    serve(
      list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"),
      active,
      teamOf("t1", ["ann", "u1"]),
    );
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    await openUnit("#05-123");
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("keeps another team's unit closed", async () => {
    serve(list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"), active, teamOf("t2", ["u1"]));
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    await openUnit("#05-123");
    expect(screen.getByText(/Only they, their current teammates or an admin/)).toBeInTheDocument();
  });

  it("treats a failed team lookup as no team", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path.endsWith("/teams")) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"));
    });
    render(<BlockScreen blockId="b1" />);
    await openUnit("#05-123");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("does not look for a team before it knows who is signed in, then looks once", async () => {
    const loading = {
      userId: undefined,
      role: undefined,
      isAdmin: false,
      isMember: false,
      isLoading: true,
      isSignedIn: false,
    };
    useRole.mockReturnValue(loading);
    serve(
      list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"),
      active,
      teamOf("t1", ["ann", "u1"]),
    );
    const { rerender } = render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/active");
    });
    await screen.findByRole("tab", { name: "All units (1)" });
    expect(apiFetch).not.toHaveBeenCalledWith("/sessions/s1/teams");

    useRole.mockReturnValue({ ...loading, userId: "u1", isLoading: false, isSignedIn: true });
    rerender(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    const calls = apiFetch.mock.calls.map(([path]) => path as string);
    expect(calls.filter((path) => path === "/sessions/s1/teams")).toHaveLength(1);
    // Learning who is signed in does not fetch the units a second time.
    expect(calls.filter((path) => path.startsWith("/households"))).toHaveLength(1);
    await openUnit("#05-123");
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  /* A promise settles once, so the late answer and the late failure each
     need their own first request. */
  it.each([
    [
      "answer",
      (late: Late) => {
        late.resolve({ data: [] });
      },
    ],
    [
      "failure",
      (late: Late) => {
        late.reject(new Error("late"));
      },
    ],
  ])("does not let a late %s for an earlier viewer take Amend away", async (_, settle) => {
    const signedIn = (userId: string) => ({
      userId,
      role: "member",
      isAdmin: false,
      isMember: true,
      isLoading: false,
      isSignedIn: true,
    });
    const late: Late = { resolve: () => undefined, reject: () => undefined };
    let first = true;
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(active);
      if (path === "/sessions/s1/teams") {
        if (first) {
          first = false;
          return new Promise((resolve, reject) => {
            late.resolve = resolve;
            late.reject = reject;
          });
        }
        return Promise.resolve(teamOf("t1", ["ann", "u1"]));
      }
      return Promise.resolve(list(["#05-123"], { id: "ann", name: "Ann Tan" }, "t1"));
    });
    useRole.mockReturnValue(signedIn("someone-else"));
    const { rerender } = render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/teams");
    });
    useRole.mockReturnValue(signedIn("u1"));
    rerender(<BlockScreen blockId="b1" />);
    await openUnit("#05-123");
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();

    await act(async () => {
      settle(late);
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  describe("with the offline queue", () => {
    const record = (unitNumber: string) =>
      buildQueuedVisit(
        {
          blockId: "b1",
          unitNumber,
          interestLevel: "high",
          description: "",
          name: "",
          contact: "",
          religion: "",
          sessionId: "s1",
        },
        "u1",
        Date.parse("2026-10-15T10:00:00.000Z"),
      );

    it("lists a unit saved on this phone before the server has it", async () => {
      useSyncQueue.mockReturnValue({ ...NO_QUEUE, records: [record("#05-124")] });
      serve(list(["#05-123"]));
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);

      await user.click(await screen.findByRole("tab", { name: "All units (2)" }));
      expect(screen.getByText("#05-124").closest("li")).toHaveTextContent("Not sent");
    });

    /* Both refuse the save; only one is fixed by finding signal. Save makes
       no promise of a next unit while the session is unknown. */
    it.each([
      [
        "the server says no outing is running",
        () => Promise.reject(new ApiRequestError(404, undefined)),
        "No session is running, so this visit is not saved yet.",
        "Save and next",
      ],
      [
        "the outing cannot be loaded",
        () => Promise.reject(new TypeError("Failed to fetch")),
        "Could not load the session, so this visit is not saved yet. Check your signal",
        "Save",
      ],
      [
        "the server fails",
        () => Promise.reject(new ApiRequestError(500, undefined)),
        "Could not load the session, so this visit is not saved yet. Check your signal",
        "Save",
      ],
    ])("refuses to queue a save when %s", async (_, outing, message, label) => {
      const enqueue = vi.fn();
      useSyncQueue.mockReturnValue({ ...NO_QUEUE, enqueue });
      answerWith((path) =>
        path.startsWith("/sessions/active") ? outing() : Promise.resolve(list([])),
      );
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (0)" });

      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "Low" }));
      await user.click(screen.getByRole("button", { name: label }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("re-reads the units once a queued record reaches the server, and not before", async () => {
      const queue = { ...NO_QUEUE, records: [record("#05-124")] };
      useSyncQueue.mockImplementation(() => queue);
      serve(list(["#05-123"]));
      const view = render(<BlockScreen blockId="b1" />);
      await screen.findByRole("tab", { name: "All units (2)" });
      const households = () =>
        apiFetch.mock.calls.filter(([path]) => String(path).startsWith("/households")).length;
      expect(households()).toBe(1);

      view.rerender(<BlockScreen blockId="b1" />);
      expect(households()).toBe(1);

      serve(list(["#05-123", "#05-124"]));
      queue.records = [{ ...record("#05-124"), state: "synced" }];
      queue.syncedVersion = 1;
      view.rerender(<BlockScreen blockId="b1" />);

      await waitFor(() => {
        expect(households()).toBe(2);
      });
      expect(screen.getByRole("tab", { name: "All units (2)" })).toBeInTheDocument();
    });
  });
});

describe("the offline copy", () => {
  it("is given the block's units with the outing they were loaded under", async () => {
    const units = list(["#05-123"]);
    serve(units);
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(noteBlock).toHaveBeenCalledWith(active, "b1", units.data);
    });
  });

  it("waits for the outing when the units arrive first", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const units = list(["#05-123"]);
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions/active")
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve(path.endsWith("/teams") ? { data: [] } : units),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });
    expect(noteBlock).not.toHaveBeenCalled();

    await act(async () => {
      answer(active);
      await Promise.resolve();
    });
    expect(noteBlock).toHaveBeenCalledWith(active, "b1", units.data);
  });

  it("is not written when the outing cannot be learnt", async () => {
    answerWith((path) =>
      path.startsWith("/sessions/active")
        ? Promise.reject(new ApiRequestError(500, undefined))
        : Promise.resolve(list(["#05-123"])),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("tab", { name: "All units (1)" });
    expect(noteBlock).not.toHaveBeenCalled();
  });

  it("is not written when the units cannot be loaded", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/sessions/active")
        ? Promise.resolve(active)
        : path.endsWith("/teams")
          ? Promise.resolve({ data: [] })
          : Promise.reject(new Error("offline")),
    );
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("alert");
    expect(noteBlock).not.toHaveBeenCalled();
  });
});

describe("in a follow-up session", () => {
  const followUp = {
    session: { id: "s1", title: "Revisits", kind: "follow_up" },
    blocks: [
      {
        block: {
          id: "b1",
          name: "123",
          street: "Ang Mo Kio Ave 3",
          postalCode: null,
          createdAt: "",
        },
        visitCount: 0,
        householdCount: 0,
        activeMembers: [],
      },
    ],
    picks: [],
  };
  const revisits = {
    data: [
      {
        household: { ...list(["#05-123"]).data[0]?.household, blockId: "b1" },
        block: followUp.blocks[0]?.block,
        notes: [{ id: "n1", doneAt: null }],
        latestVisit: null,
        visitedInSession: false,
      },
    ],
  };

  function serveFollowUp(listAnswer: () => Promise<unknown> = () => Promise.resolve(revisits)) {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(followUp);
      if (path === "/sessions/s1/teams") return Promise.resolve({ data: [] });
      if (path === "/sessions/s1/revisits") return listAnswer();
      return Promise.resolve(list(["#05-123"]));
    });
  }

  it("says only listed units can be recorded, and offers them", async () => {
    serveFollowUp();
    render(<BlockScreen blockId="b1" />);
    expect(
      await screen.findByText(/Only units on the list can be recorded\.$/),
    ).toBeInTheDocument();
    const chips = within(await screen.findByRole("list", { name: "On the list in this block" }));
    expect(chips.getByRole("button", { name: "#05-123" })).toBeInTheDocument();
  });

  it("keeps the list on the phone for the offline shell", async () => {
    serveFollowUp();
    render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(noteRevisits).toHaveBeenCalledWith(followUp, revisits.data);
    });
  });

  it("tells an admin they can record any unit", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    serveFollowUp();
    render(<BlockScreen blockId="b1" />);
    expect(await screen.findByText(/As an admin you can record any unit\./)).toBeInTheDocument();
  });

  it("says it could not check the list when it cannot be read", async () => {
    serveFollowUp(() => Promise.reject(new TypeError("offline")));
    const user = userEvent.setup();
    render(<BlockScreen blockId="b1" />);
    await screen.findByText(/Only units on the list can be recorded/);
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      /^Could not check this session's list\./,
    );
    expect(noteRevisits).not.toHaveBeenCalled();
  });

  it("arrives with the unit picked from the list", () => {
    serveFollowUp();
    render(<BlockScreen blockId="b1" initialUnit="#05-123" />);
    expect(screen.getByLabelText("Unit number")).toHaveValue("#05-123");
  });

  /* The third answer of the screen, so the one most likely to meet a
     member's first paste (#155). */
  it("keeps a unit typed over the picked one as the list lands", async () => {
    let answerList: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(followUp);
      if (path === "/sessions/s1/teams") return Promise.resolve({ data: [] });
      if (path === "/sessions/s1/revisits") {
        return new Promise((resolve) => {
          answerList = resolve;
        });
      }
      if (path.startsWith("/households?")) return Promise.resolve(list(["#05-123"]));
      // The picked unit's history: not what this is about.
      return new Promise(() => undefined);
    });
    render(<BlockScreen blockId="b1" initialUnit="#05-123" />);
    const field = screen.getByLabelText<HTMLInputElement>("Unit number");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/revisits");
    });

    await landWhileTyping(field, "#09-999", () => {
      answerList(revisits);
    });

    // The answer was read while the text was landing, not after.
    expect(noteRevisits).toHaveBeenCalledWith(followUp, revisits.data);
    const chips = within(await screen.findByRole("list", { name: "On the list in this block" }));
    expect(chips.getByRole("button", { name: "#05-123" })).toHaveAttribute("aria-pressed", "false");
    expect(field).toHaveValue("#09-999");
  });

  it("asks for no list in a door-to-door session", async () => {
    serve(list([]), { ...followUp, session: { ...followUp.session, kind: "regular" } });
    render(<BlockScreen blockId="b1" />);
    await screen.findByRole("heading", { level: 1, name: "Blk 123" });
    expect(apiFetch).not.toHaveBeenCalledWith("/sessions/s1/revisits");
    expect(screen.queryByText(/Only units on the list/)).toBeNull();
  });

  it("lets only the newest list land when the session answers twice", async () => {
    let late: (value: unknown) => void = () => undefined;
    let calls = 0;
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/active")) return Promise.resolve(followUp);
      if (path === "/sessions/s1/teams") return Promise.resolve({ data: [] });
      if (path === "/sessions/s1/revisits") {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              late = resolve;
            })
          : Promise.resolve({ data: [] });
      }
      return Promise.resolve(list(["#05-123"]));
    });
    const queue = { ...NO_QUEUE };
    useSyncQueue.mockReturnValue(queue);
    const view = render(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    // A record reaching the server re-reads the list.
    useSyncQueue.mockReturnValue({ ...queue, syncedVersion: 1 });
    view.rerender(<BlockScreen blockId="b1" />);
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    await act(async () => {
      late(revisits);
      await Promise.resolve();
    });
    expect(screen.queryByRole("list", { name: "On the list in this block" })).toBeNull();
  });

  describe("when the list may have moved under the screen", () => {
    const entry = (unitNumber: string) => ({
      ...revisits.data[0],
      household: { ...revisits.data[0]?.household, id: `h-${unitNumber}`, unitNumber },
    });
    const listOf = (...units: string[]) => ({ data: units.map(entry) });
    const chipNames = () =>
      within(screen.getByRole("list", { name: "On the list in this block" }))
        .getAllByRole("button")
        .map((chip) => chip.textContent);
    const reads = () => apiFetch.mock.calls.filter(([path]) => path === "/sessions/s1/revisits");

    /* Answers each read of the list with the next of `answers`, the last for good. */
    function serveLists(...answers: (() => Promise<unknown>)[]) {
      let read = 0;
      serveFollowUp(() => {
        const answer = answers[Math.min(read, answers.length - 1)];
        read += 1;
        return answer === undefined ? Promise.resolve(revisits) : answer();
      });
    }

    const held = (unitNumber: string, code: string): QueuedVisit => ({
      ...buildQueuedVisit(
        {
          blockId: "b1",
          unitNumber,
          interestLevel: "high",
          description: "",
          name: "",
          contact: "",
          religion: "",
          sessionId: "s1",
        },
        "u1",
        Date.parse("2026-10-15T10:00:00.000Z"),
      ),
      state: "held",
      lastError: { code },
    });

    it("stops offering a unit once the server holds a record there as off the list", async () => {
      // An admin took #05-124 off the list after this screen read it.
      serveLists(
        () => Promise.resolve(listOf("#05-123", "#05-124")),
        () => Promise.resolve(listOf("#05-123")),
      );
      const queue = { ...NO_QUEUE };
      useSyncQueue.mockReturnValue(queue);
      const user = userEvent.setup();
      const view = render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123", "#05-124"]);
      });

      // Held for another reason, the list is not the question.
      useSyncQueue.mockReturnValue({ ...queue, records: [held("#05-124", "session_not_active")] });
      view.rerender(<BlockScreen blockId="b1" />);
      expect(reads()).toHaveLength(1);

      useSyncQueue.mockReturnValue({
        ...queue,
        records: [held("#05-124", "not_on_follow_up_list")],
      });
      view.rerender(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123"]);
      });
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      expect(screen.getByText(/is not on this session's list/)).toBeVisible();
    });

    it("reads the list again when the member comes back to the app", async () => {
      // Asked to add a unit, the admin may have while the phone was away.
      serveLists(
        () => Promise.resolve(listOf("#05-123")),
        () => Promise.resolve(listOf("#05-123", "#05-124")),
      );
      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123"]);
      });

      // Put away, nothing is read: nobody is looking.
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      Reflect.deleteProperty(document, "visibilityState");
      expect(document.visibilityState).toBe("visible");
      expect(reads()).toHaveLength(1);

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123", "#05-124"]);
      });
    });

    it("keeps the list it has when a later read fails", async () => {
      serveLists(
        () => Promise.resolve(listOf("#05-123")),
        () => Promise.reject(new TypeError("offline")),
      );
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123"]);
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => {
        expect(reads()).toHaveLength(2);
      });
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      expect(screen.getByText(/is not on this session's list/)).toBeVisible();
      expect(screen.queryByText(/Could not check this session's list/)).toBeNull();
      expect(chipNames()).toEqual(["#05-123"]);
    });

    it("says nothing about the list while it is first read", async () => {
      // The usual way in: a household tapped on the list, on weak signal.
      serveLists(() => new Promise(() => undefined));
      render(<BlockScreen blockId="b1" initialUnit="#05-124" />);
      await screen.findByText(/Only units on the list can be recorded/);
      await waitFor(() => {
        expect(reads()).toHaveLength(1);
      });
      expect(screen.getByLabelText("Unit number")).toHaveValue("#05-124");
      expect(screen.queryByText(/Could not check this session's list/)).toBeNull();
      expect(screen.queryByText(/is not on this session's list/)).toBeNull();
    });

    it("saves a unit an admin added since the list was read, and shows it on the list", async () => {
      serveLists(
        () => Promise.resolve(listOf("#05-123")),
        () => Promise.resolve(listOf("#05-123", "#05-124")),
      );
      const user = userEvent.setup();
      render(<BlockScreen blockId="b1" />);
      await waitFor(() => {
        expect(chipNames()).toEqual(["#05-123"]);
      });
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          "/visits",
          expect.objectContaining({ method: "POST" }),
        );
      });
      expect(chipNames()).toEqual(["#05-123", "#05-124"]);
      expect(screen.queryByText(/Not saved/)).toBeNull();
    });
  });
});
