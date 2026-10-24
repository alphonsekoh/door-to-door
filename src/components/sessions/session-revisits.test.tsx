import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRevisits } from "@/components/sessions/session-revisits";
import type { FollowUp, RevisitEntry } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const STAMP = "2026-10-20T10:00:00.000Z";

function note(blockId: string, blockName: string, householdId: string, done = false): FollowUp {
  return {
    id: `n-${householdId}`,
    householdId,
    blockId,
    blockName,
    unitNumber: "#01-01",
    visitId: null,
    status: "listed",
    author: { id: "a1", name: "Admin", image: null },
    note: "Go back",
    dueDate: null,
    doneAt: done ? STAMP : null,
    doneBy: null,
    listedAt: STAMP,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: STAMP,
  };
}

type EntryOptions = { done?: boolean; visited?: boolean; name?: string | null };

function entry(
  unitNumber: string,
  { done = false, visited = false, name = "Mr Tan" }: EntryOptions = {},
): RevisitEntry {
  const householdId = `h${unitNumber}`;
  return {
    household: {
      id: householdId,
      blockId: "b1",
      unitNumber,
      name,
      contact: null,
      religion: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    block: { id: "b1", name: "123", street: "Ave 3", postalCode: null, createdAt: STAMP },
    notes: [note("b1", "123", householdId, done)],
    latestVisit: null,
    visitedInSession: visited,
  };
}

/* Routed by path: the session's list, and every listed note a page at a time. */
function serve(entries: RevisitEntry[], listed: FollowUp[] = []) {
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "POST") return Promise.resolve([]);
    if (path.endsWith("/revisits")) return Promise.resolve({ data: entries });
    return Promise.resolve({
      data: listed,
      pagination: { limit: 100, offset: 0, total: listed.length, hasMore: false },
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

const mount = (onAttached = vi.fn(() => Promise.resolve()), tick = 0) =>
  render(
    <SessionRevisits sessionId="s1" attachedIds={["b1"]} tick={tick} onAttached={onAttached} />,
  );

describe("SessionRevisits", () => {
  it("counts and lists the households, each leading to its page", async () => {
    serve([
      entry("#05-123"),
      entry("#06-201", { visited: true }),
      entry("#07-301", { done: true, name: null }),
    ]);
    mount();
    expect(await screen.findByRole("heading", { name: "Households to revisit (3)" })).toBeVisible();
    const rows = screen.getAllByRole("link");
    expect(rows[0]).toHaveAttribute("href", "/households/h#05-123");
    expect(rows[1]).toHaveTextContent("Visited");
    expect(rows[2]).toHaveTextContent("Done");
    expect(rows[2]).toHaveTextContent("Name not known");
    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/revisits");
  });

  it("says an ended session's list is today's, not a record of that session", async () => {
    serve([entry("#05-123")]);
    render(
      <SessionRevisits
        sessionId="s1"
        ended
        attachedIds={["b1"]}
        tick={0}
        onAttached={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(
      await screen.findByText(
        "This session has ended. This is the follow-up list as it stands today, which members would see if it were reopened.",
      ),
    ).toBeVisible();
  });

  it("says nothing of the sort while the session can still run", async () => {
    serve([entry("#05-123")]);
    mount();
    await screen.findByRole("heading", { name: "Households to revisit (1)" });
    expect(screen.queryByText(/This session has ended/)).toBeNull();
  });

  it("says when its blocks hold nobody on the list", async () => {
    serve([]);
    mount();
    expect(
      await screen.findByText("No households on the list in these blocks yet."),
    ).toBeInTheDocument();
  });

  it("names blocks with listed households it does not cover, and adds one", async () => {
    const onAttached = vi.fn(() => Promise.resolve());
    serve(
      [],
      [
        note("b1", "123", "h1"),
        note("b2", "125", "h2"),
        note("b2", "125", "h3"),
        note("b3", "130", "h4"),
      ],
    );
    mount(onAttached);
    expect(await screen.findByText(/has 2 households on the follow-up list\./)).toBeVisible();
    expect(screen.getByText(/has 1 household on the follow-up list\./)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add Blk 125" }));
    await waitFor(() => {
      expect(onAttached).toHaveBeenCalled();
    });
    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/blocks", {
      method: "POST",
      body: JSON.stringify({ blockIds: ["b2"] }),
    });
  });

  it("adds one block per tap, however fast the taps", async () => {
    let finish: () => void = () => undefined;
    const onAttached = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    serve([], [note("b2", "125", "h2"), note("b3", "130", "h4")]);
    mount(onAttached);
    const add = await screen.findByRole("button", { name: "Add Blk 125" });
    act(() => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(await screen.findByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Blk 130" })).toBeDisabled();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(apiFetch.mock.calls.filter(([, init]) => init !== undefined)).toHaveLength(1);
  });

  it("says why a block could not be added", async () => {
    serve([], [note("b2", "125", "h2")]);
    apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "POST") {
        return Promise.reject(
          new ApiRequestError(404, { error: { code: "not_found", message: "No such block." } }),
        );
      }
      if (path.endsWith("/revisits")) return Promise.resolve({ data: [] });
      return Promise.resolve({
        data: [note("b2", "125", "h2")],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      });
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add Blk 125" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No such block.");
  });

  it("words a failure that gives no reason", async () => {
    serve([], [note("b2", "125", "h2")]);
    mount();
    const add = await screen.findByRole("button", { name: "Add Blk 125" });
    apiFetch.mockRejectedValueOnce("boom");
    fireEvent.click(add);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add that block.");
  });

  it("keeps a failed read to itself, with a way to try again", async () => {
    apiFetch.mockRejectedValueOnce(new TypeError("offline"));
    serve([]);
    apiFetch.mockRejectedValueOnce(new TypeError("offline"));
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the follow-up list.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("No households on the list in these blocks yet."),
    ).toBeInTheDocument();
  });

  it("re-reads with each tick, and lets only the newest answer land", async () => {
    let late: (value: unknown) => void = () => undefined;
    let reads = 0;
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith("/revisits")) {
        reads += 1;
        return reads === 1
          ? new Promise((resolve) => {
              late = resolve;
            })
          : Promise.resolve({ data: [] });
      }
      return Promise.resolve({
        data: [],
        pagination: { limit: 100, offset: 0, total: 0, hasMore: false },
      });
    });
    const { rerender } = mount();
    await waitFor(() => {
      expect(reads).toBe(1);
    });
    rerender(<SessionRevisits sessionId="s1" attachedIds={["b1"]} tick={1} onAttached={vi.fn()} />);
    expect(
      await screen.findByText("No households on the list in these blocks yet."),
    ).toBeInTheDocument();
    late({ data: [entry("#05-123")] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("#05-123")).toBeNull();
  });

  it("ignores a late failure behind a newer answer", async () => {
    let fail: (reason: unknown) => void = () => undefined;
    let reads = 0;
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith("/revisits")) {
        reads += 1;
        return reads === 1
          ? new Promise((_resolve, reject) => {
              fail = reject;
            })
          : Promise.resolve({ data: [] });
      }
      return Promise.resolve({
        data: [],
        pagination: { limit: 100, offset: 0, total: 0, hasMore: false },
      });
    });
    const { rerender } = mount();
    await waitFor(() => {
      expect(reads).toBe(1);
    });
    rerender(<SessionRevisits sessionId="s1" attachedIds={["b1"]} tick={1} onAttached={vi.fn()} />);
    await screen.findByText("No households on the list in these blocks yet.");
    fail(new TypeError("late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
