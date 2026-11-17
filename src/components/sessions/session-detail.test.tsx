import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDetail } from "@/components/sessions/session-detail";
import type { OutingSession, SessionBlock, SessionStatus } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

/* The households panel has its own tests; here it only has to be placed and fed. */
vi.mock("@/components/sessions/session-households", () => ({
  SessionHouseholds: ({
    session,
    blocks,
    tick,
    onChanged,
    onCounted,
  }: {
    session: OutingSession;
    blocks: readonly SessionBlock[];
    tick: number;
    onChanged: () => Promise<void>;
    onCounted: (onList: number) => void;
  }) => (
    <>
      <button type="button" onClick={() => void onChanged()}>
        Households panel: {session.status}, read {String(tick)}, blocks{" "}
        {blocks.map((entry) => `${entry.block.name} (${String(entry.visitCount)})`).join(", ")}
      </button>
      {[0, 2].map((count) => (
        <button
          key={count}
          type="button"
          onClick={() => {
            onCounted(count);
          }}
        >
          Read {String(count)} on the list
        </button>
      ))}
    </>
  ),
}));

/* The team panel has its own tests; here it only has to be placed and fed. */
vi.mock("@/components/admin/admin-teams", () => ({
  AdminTeams: ({ status, tick }: { status: string; tick: number }) => (
    <p>
      Teams panel: {status}, read {String(tick)}
    </p>
  ),
}));

const AT = "2026-03-01T00:00:00.000Z";

function session(status: SessionStatus): OutingSession {
  return {
    id: "s1",
    title: "June outing",
    kind: "regular",
    status,
    startedAt: null,
    endedAt: null,
    createdBy: { id: "admin", name: "Admin", image: null },
    createdAt: AT,
  };
}

function sessionBlock(
  id: string,
  name: string,
  options: { visitCount?: number; householdCount?: number; members?: string[] } = {},
): SessionBlock {
  const { visitCount = 0, householdCount = 0, members = [] } = options;
  return {
    block: { id, name, street: "Test Ave", postalCode: null, createdAt: AT },
    visitCount,
    householdCount,
    activeMembers: members.map((memberName, i) => ({
      id: `m${String(i)}`,
      name: memberName,
      image: null,
    })),
  };
}

/* Routed by path: the screen loads the outing and its blocks in parallel. */
/* The block registry is listed as soon as the attach sheet opens. */
const EMPTY_REGISTRY = { data: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } };

function serve(status: SessionStatus, blocks: SessionBlock[]) {
  apiFetch.mockImplementation((path: string) =>
    path.endsWith("/blocks")
      ? Promise.resolve(blocks)
      : path.startsWith("/blocks")
        ? Promise.resolve(EMPTY_REGISTRY)
        : Promise.resolve(session(status)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SessionDetail", () => {
  it("shows the outing, its status and its blocks", async () => {
    serve("active", [sessionBlock("b1", "123", { visitCount: 4, householdCount: 3 })]);
    render(<SessionDetail sessionId="s1" />);

    expect(await screen.findByText("June outing")).toBeInTheDocument();
    expect(screen.getByText("Running now")).toBeInTheDocument();
    expect(screen.getByText("Blk 123")).toBeInTheDocument();
    // Units visited in this session, never read as the size of the block.
    expect(screen.getByText("3 visited, 4 visits")).toBeInTheDocument();
  });

  it("names the members working a block right now", async () => {
    // Informational: blocks are shared and never locked.
    serve("active", [sessionBlock("b1", "123", { members: ["Alice", "Ben"] })]);
    render(<SessionDetail sessionId="s1" />);

    expect(await screen.findByText(/Alice, Ben\s+here now/)).toBeInTheDocument();
  });

  it("summarises what was recorded once the outing has ended", async () => {
    serve("ended", [
      sessionBlock("b1", "123", { visitCount: 4, householdCount: 3 }),
      sessionBlock("b2", "125", { visitCount: 2, householdCount: 2 }),
    ]);
    render(<SessionDetail sessionId="s1" />);

    expect(await screen.findByText("6 visits recorded across 2 blocks.")).toBeInTheDocument();
  });

  it("counts one visit to one unit on one block in the singular, with no repeat count", async () => {
    serve("ended", [sessionBlock("b1", "123", { visitCount: 1, householdCount: 1 })]);
    render(<SessionDetail sessionId="s1" />);

    expect(await screen.findByText("1 visit recorded across 1 block.")).toBeInTheDocument();
    // Every unit had one knock, so a visit count would only repeat the unit count.
    expect(screen.getByText("1 visited")).toBeInTheDocument();
  });

  it("calls a member working a block with no name on record Someone", async () => {
    const block = sessionBlock("b1", "123");
    serve("active", [{ ...block, activeMembers: [{ id: "m1", name: null, image: null }] }]);
    render(<SessionDetail sessionId="s1" />);

    expect(await screen.findByText(/Someone\s+here now/)).toBeInTheDocument();
  });

  it("offers reopen on an ended outing", async () => {
    serve("ended", []);
    render(<SessionDetail sessionId="s1" />);
    expect(await screen.findByRole("button", { name: "Reopen session" })).toBeInTheDocument();
  });

  it("warns that a block with no attachment leaves members with nowhere to record", async () => {
    serve("draft", []);
    render(<SessionDetail sessionId="s1" />);
    expect(await screen.findByText(/Members cannot record anywhere/)).toBeInTheDocument();
  });

  it("says that members need to refresh when a block is added mid-outing", async () => {
    const user = userEvent.setup();
    serve("active", []);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("June outing");

    apiFetch.mockImplementation((path: string) => {
      if (path === "/blocks?limit=50") {
        return Promise.resolve({
          data: [{ id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT }],
          pagination: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }
      if (path.endsWith("/blocks")) return Promise.resolve([sessionBlock("b1", "123")]);
      return Promise.resolve(session("active"));
    });

    await user.click(screen.getByRole("button", { name: "Add blocks" }));
    await user.click(await screen.findByRole("button", { name: /Blk 123/ }));
    await user.click(screen.getByRole("button", { name: "Attach 1 block" }));

    expect(
      await screen.findByText(/Members will see it the next time they refresh/),
    ).toBeInTheDocument();
  });

  it("does not promise a refresh on a draft nobody is working", async () => {
    const user = userEvent.setup();
    serve("draft", []);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("June outing");

    apiFetch.mockImplementation((path: string) => {
      if (path === "/blocks?limit=50") {
        return Promise.resolve({
          data: [{ id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT }],
          pagination: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }
      if (path.endsWith("/blocks")) return Promise.resolve([sessionBlock("b1", "123")]);
      return Promise.resolve(session("draft"));
    });

    await user.click(screen.getByRole("button", { name: "Add blocks" }));
    await user.click(await screen.findByRole("button", { name: /Blk 123/ }));
    await user.click(screen.getByRole("button", { name: "Attach 1 block" }));

    expect(await screen.findByText("Added.")).toBeInTheDocument();
  });

  it("asks before removing a block, and says what happens to its records", async () => {
    const user = userEvent.setup();
    serve("active", [sessionBlock("b1", "123", { visitCount: 4, householdCount: 3 })]);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("Blk 123");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("alertdialog", { name: "Remove Blk 123?" })).toBeInTheDocument();
    expect(screen.getByText(/4 visits were recorded here. They are kept/)).toBeInTheDocument();
  });

  it("says plainly when an untouched block is removed", async () => {
    const user = userEvent.setup();
    serve("draft", [sessionBlock("b1", "123")]);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("Blk 123");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText(/no longer see it in the block picker/)).toBeInTheDocument();
  });

  it("removes nothing until the removal is confirmed", async () => {
    const user = userEvent.setup();
    serve("active", [sessionBlock("b1", "123")]);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("Blk 123");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Keep as it is" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/blocks/b1"), {
      method: "DELETE",
    });
  });

  it("detaches once confirmed", async () => {
    const user = userEvent.setup();
    serve("active", [sessionBlock("b1", "123")]);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("Blk 123");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove the block" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/blocks/b1", { method: "DELETE" });
    });
  });

  it("reports a refused removal", async () => {
    const user = userEvent.setup();
    serve("active", [sessionBlock("b1", "123")]);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("Blk 123");

    apiFetch.mockRejectedValue(
      new ApiRequestError(409, {
        error: { code: "block_in_use", message: "Visits have been recorded on this block." },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove the block" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Visits have been recorded on this block.",
    );
  });

  it("copes with a non-Error removal failure", async () => {
    const user = userEvent.setup();
    serve("active", [sessionBlock("b1", "123")]);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("Blk 123");

    apiFetch.mockRejectedValue("boom");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove the block" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove that block.");
  });

  it("offers a retry when the outing will not load", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SessionDetail sessionId="s1" />);

    // The screen's sentence, never the browser's (#194).
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this session.");

    serve("active", []);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("June outing")).toBeInTheDocument();
  });

  it("shows the server's sentence when it refuses the session", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(404, { error: { code: "not_found", message: "No such session." } }),
    );
    render(<SessionDetail sessionId="s1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No such session.");
  });

  it("copes with a non-Error load failure", async () => {
    apiFetch.mockRejectedValue("boom");
    render(<SessionDetail sessionId="s1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this session.");
  });

  it("reflects a lifecycle change without a manual refresh", async () => {
    const user = userEvent.setup();
    serve("ended", []);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByRole("button", { name: "Reopen session" });

    apiFetch.mockImplementation((path: string) =>
      path.endsWith("/blocks") ? Promise.resolve([]) : Promise.resolve(session("active")),
    );
    await user.click(screen.getByRole("button", { name: "Reopen session" }));

    expect(await screen.findByText("Running now")).toBeInTheDocument();
  });

  it("does not offer a block the outing already has", async () => {
    const user = userEvent.setup();
    serve("active", [sessionBlock("b1", "123")]);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("Blk 123");

    apiFetch.mockImplementation((path: string) => {
      if (path === "/blocks?limit=50") {
        return Promise.resolve({
          data: [
            { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
            { id: "b2", name: "125", street: "Test Ave", postalCode: null, createdAt: AT },
          ],
          pagination: { limit: 50, offset: 0, total: 2, hasMore: false },
        });
      }
      if (path.endsWith("/blocks")) return Promise.resolve([sessionBlock("b1", "123")]);
      return Promise.resolve(session("active"));
    });

    await user.click(screen.getByRole("button", { name: "Add blocks" }));
    expect(await screen.findByRole("button", { name: /Blk 125/ })).toBeInTheDocument();
    // Blk 123 still shows on the outing behind the sheet, never inside it.
    const sheet = screen.getByRole("dialog", { name: "Add blocks" });
    expect(sheet).not.toHaveTextContent("Blk 123");
  });

  it("closes the block sheet without attaching", async () => {
    const user = userEvent.setup();
    serve("active", []);
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("June outing");

    await user.click(screen.getByRole("button", { name: "Add blocks" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows the team panel for the outing's state", async () => {
    serve("draft", []);
    render(<SessionDetail sessionId="s1" />);
    expect(await screen.findByText("Teams panel: draft, read 0")).toBeInTheDocument();
  });

  it("re-reads the team panel on the same poll as the outing", async () => {
    vi.useFakeTimers();
    try {
      serve("active", []);
      render(<SessionDetail sessionId="s1" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Teams panel: active, read 0")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(screen.getByText("Teams panel: active, read 1")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a follow-up session", () => {
  function serveKind(kind: "regular" | "follow_up") {
    apiFetch.mockImplementation((path: string) =>
      path.endsWith("/blocks")
        ? Promise.resolve([sessionBlock("b1", "123", { visitCount: 2 })])
        : Promise.resolve({ ...session("draft"), kind }),
    );
  }

  it("says what kind it is and what that means for members", async () => {
    serveKind("follow_up");
    render(<SessionDetail sessionId="s1" />);
    expect(await screen.findByText("Follow-up")).toBeInTheDocument();
    expect(screen.getByText("Members can record only households on its list.")).toBeVisible();
  });

  it("shows its households to revisit, fed the blocks and their visits", async () => {
    // A block holding this session's visits keeps its last pick (block_in_use).
    serveKind("follow_up");
    render(<SessionDetail sessionId="s1" />);
    expect(
      await screen.findByText(/Households panel: draft, read 0, blocks 123 \(2\)/),
    ).toBeInTheDocument();
  });

  it("reads its blocks again once the households change, since blocks follow them", async () => {
    serveKind("follow_up");
    render(<SessionDetail sessionId="s1" />);
    const calls = () =>
      apiFetch.mock.calls.filter(([path]) => path === "/sessions/s1/blocks").length;
    await screen.findByText(/Households panel/);
    const before = calls();
    await userEvent.click(screen.getByRole("button", { name: /Households panel/ }));
    await waitFor(() => {
      expect(calls()).toBe(before + 1);
    });
  });

  it("shows its blocks read-only, saying they follow the households", async () => {
    serveKind("follow_up");
    render(<SessionDetail sessionId="s1" />);
    expect(await screen.findByText("Blocks follow the households in this session.")).toBeVisible();
    expect(screen.getByText("Blk 123")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add blocks" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("holds Start once nothing picked is on the list, and says why", async () => {
    serveKind("follow_up");
    render(<SessionDetail sessionId="s1" />);
    const start = await screen.findByRole("button", { name: "Start session" });
    // Unread is not refused: the server decides.
    expect(start).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Read 0 on the list" }));
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      "Every household here is done or off the follow-up list, so members would find nothing to visit. Add households to start it.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Read 2 on the list" }));
    expect(start).toBeEnabled();
    expect(start).not.toHaveAccessibleDescription();
  });

  it("has neither for a door-to-door session", async () => {
    serveKind("regular");
    render(<SessionDetail sessionId="s1" />);
    await screen.findByText("June outing");
    expect(screen.queryByText("Follow-up")).toBeNull();
    expect(screen.queryByText(/Households panel/)).toBeNull();
    expect(screen.queryByText("Blocks follow the households in this session.")).toBeNull();
    expect(screen.getByRole("button", { name: "Add blocks" })).toBeInTheDocument();
  });
});
