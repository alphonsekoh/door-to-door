import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionHouseholds } from "@/components/sessions/session-households";
import type {
  FollowUp,
  OutingSession,
  SessionHousehold,
  SessionStatus,
} from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const AT = "2026-10-20T08:00:00.000Z";

function session(status: SessionStatus = "active"): OutingSession {
  return {
    id: "s1",
    title: "Saturday revisits",
    kind: "follow_up",
    status,
    startedAt: status === "draft" ? null : AT,
    endedAt: status === "ended" ? AT : null,
    createdBy: { id: "a1", name: "Admin", image: null },
    createdAt: AT,
  };
}

function note(householdId: string, over: Partial<FollowUp> = {}): FollowUp {
  return {
    id: `n-${householdId}`,
    householdId,
    blockId: "b1",
    blockName: "123",
    unitNumber: `#${householdId}`,
    visitId: null,
    status: "listed",
    author: { id: "a1", name: "Admin", image: null },
    note: `Visit ${householdId}`,
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
    ...over,
  };
}

function pick(
  id: string,
  blockName: string,
  over: Partial<SessionHousehold> = {},
): SessionHousehold {
  return {
    household: {
      id,
      blockId: `b${blockName}`,
      unitNumber: `#${id}`,
      name: id === "h1" ? "Mr Tan" : null,
      contact: null,
      religion: null,
      createdAt: AT,
      updatedAt: AT,
    },
    block: {
      id: `b${blockName}`,
      name: blockName,
      street: "Test Ave",
      postalCode: null,
      createdAt: AT,
    },
    notes: [note(id)],
    onList: true,
    visitedInSession: false,
    ...over,
  };
}

const PICKS = [pick("h1", "123"), pick("h2", "123"), pick("h3", "125")];

const listedPage = (notes: FollowUp[]) => ({
  data: notes,
  pagination: { limit: 100, offset: 0, total: notes.length, hasMore: false },
});

/* The picks, the follow-up list for the add sheet, and the two writes. */
function server({
  picks = () => Promise.resolve({ data: PICKS }),
  listed = () => Promise.resolve(listedPage([note("h1"), note("h4", { blockName: "130" })])),
  add = () => Promise.resolve({ data: PICKS }),
  remove = () => Promise.resolve(undefined),
}: {
  picks?: () => Promise<unknown>;
  listed?: () => Promise<unknown>;
  add?: () => Promise<unknown>;
  remove?: () => Promise<unknown>;
} = {}) {
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "DELETE") return remove();
    if (init?.method === "POST") return add();
    if (path.startsWith("/follow-ups")) return listed();
    return picks();
  });
}

const mount = (status: SessionStatus = "active", onChanged = vi.fn(() => Promise.resolve())) => {
  const view = render(
    <SessionHouseholds session={session(status)} tick={0} onChanged={onChanged} />,
  );
  return { ...view, onChanged };
};

const reads = () =>
  apiFetch.mock.calls.filter(
    ([path, init]) => path === "/sessions/s1/households" && init === undefined,
  ).length;

beforeEach(() => {
  vi.clearAllMocks();
  server();
});

describe("the households a follow-up session goes back to", () => {
  it("counts them and groups them by block, each linking to its household", async () => {
    mount();
    expect(
      await screen.findByRole("heading", { name: "Households to revisit (3)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Blk 123")).toBeVisible();
    expect(screen.getByText("Blk 125")).toBeVisible();
    const first = screen.getByRole("link", { name: /#h1/ });
    expect(first).toHaveAttribute("href", "/households/h1");
    expect(first).toHaveTextContent("Mr Tan");
    expect(screen.getByRole("link", { name: /#h2/ })).toHaveTextContent("Name not known");
  });

  it("says where each stands", async () => {
    server({
      picks: () =>
        Promise.resolve({
          data: [
            pick("h1", "123", { visitedInSession: true }),
            pick("h2", "123", { notes: [note("h2", { doneAt: AT })] }),
            pick("h3", "123", { notes: [note("h3", { doneAt: AT })], onList: false }),
            pick("h4", "123", { notes: [], onList: false }),
            pick("h5", "123"),
          ],
        }),
    });
    mount();
    const row = async (id: string) =>
      (await screen.findByRole("link", { name: new RegExp(`#${id}`) })).closest("li");
    expect(await row("h1")).toHaveTextContent("Visited");
    expect(await row("h2")).toHaveTextContent("Done");
    expect(await row("h3")).toHaveTextContent("Done before it started");
    const off = await row("h4");
    expect(off).toHaveTextContent("Off the follow-up list");
    expect(off).toHaveTextContent("Members don't see it.");
    expect(await row("h5")).not.toHaveTextContent(/Visited|Done|Off the/);
  });

  it("calls a note resolved before a draft starts already done", async () => {
    server({
      picks: () =>
        Promise.resolve({
          data: [
            pick("h1", "123", { notes: [note("h1", { doneAt: AT })], onList: false }),
            pick("h2", "123"),
          ],
        }),
    });
    mount("draft");
    expect((await screen.findByRole("link", { name: /#h1/ })).closest("li")).toHaveTextContent(
      "Already done",
    );
  });

  it("re-reads with the screen's poll", async () => {
    const { rerender } = mount();
    await screen.findByRole("heading", { name: "Households to revisit (3)" });
    rerender(<SessionHouseholds session={session()} tick={1} onChanged={vi.fn()} />);
    await waitFor(() => {
      expect(reads()).toBe(2);
    });
  });

  it("keeps a failed read inside the list, with a way to try again", async () => {
    let fail = true;
    server({
      picks: () =>
        fail ? Promise.reject(new TypeError("offline")) : Promise.resolve({ data: PICKS }),
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load this session's households.",
    );
    expect(screen.queryByRole("button", { name: "Add households" })).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Households to revisit (3)" }),
    ).toBeInTheDocument();
  });
});

describe("taking a household out", () => {
  it("asks first, then takes it out of the session only, and re-reads the blocks", async () => {
    const { onChanged } = mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Blk 123 · #h2 from this session" }),
    );
    const dialog = within(
      screen.getByRole("alertdialog", { name: "Remove #h2 from this session?" }),
    );
    expect(
      dialog.getByText(
        "It stays on the follow-up list for a later session. Members will stop seeing it in this one.",
      ),
    ).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Remove from session" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Removed from this session. It is still on the follow-up list.",
    );
    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/households/h2", { method: "DELETE" });
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => {
      expect(reads()).toBe(2);
    });
  });

  it("sends one request on a double tap", async () => {
    let finish: (value: unknown) => void = () => undefined;
    server({
      remove: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Blk 123 · #h2 from this session" }),
    );
    const confirm = screen.getByRole("button", { name: "Remove from session" });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    finish(undefined);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    const deletes = apiFetch.mock.calls.filter(
      ([, init]) => (init as { method?: string } | undefined)?.method === "DELETE",
    );
    expect(deletes).toHaveLength(1);
  });

  it("keeps it on Keep it, with nothing sent", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Blk 123 · #h2 from this session" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(apiFetch).not.toHaveBeenCalledWith(expect.anything(), { method: "DELETE" });
  });

  it("says why the server kept it", async () => {
    server({
      remove: () =>
        Promise.reject(
          new ApiRequestError(409, {
            error: {
              code: "block_in_use",
              message:
                "Its block has visits recorded in this session, so this household stays in the session.",
            },
          }),
        ),
    });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Blk 125 · #h3 from this session" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove from session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Its block has visits recorded in this session, so this household stays in the session.",
    );
  });

  it("says so plainly when it could not be reached", async () => {
    server({ remove: () => Promise.reject(new TypeError("Failed to fetch")) });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Blk 125 · #h3 from this session" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove from session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove that household.");
  });

  it("is not offered for a household visited in this session, and says why", async () => {
    server({
      picks: () =>
        Promise.resolve({
          data: [pick("h1", "123", { visitedInSession: true }), pick("h2", "123")],
        }),
    });
    mount();
    const row = (await screen.findByRole("link", { name: /#h1/ })).closest("li");
    if (row === null) throw new Error("expected a row");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(row).toHaveTextContent("Visited in this session, so it stays.");
  });

  it("is not offered for the last household, and says why", async () => {
    server({ picks: () => Promise.resolve({ data: [pick("h1", "123")] }) });
    mount("draft");
    await screen.findByRole("heading", { name: "Households to revisit (1)" });
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(
      screen.getByText(
        "A follow-up session needs at least one household, so the last one can't be removed.",
      ),
    ).toBeVisible();
  });
});

describe("an ended follow-up session", () => {
  it("keeps its record: no adding, no taking out", async () => {
    mount("ended");
    await screen.findByRole("heading", { name: "Households to revisit (3)" });
    expect(
      screen.getByText(
        "This session has ended. These are the households it was set up to revisit, as they stand today.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add households" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByText(/so it stays|can't be removed/)).toBeNull();
  });
});

describe("adding households", () => {
  const openSheet = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Add households" }));
    return within(screen.getByRole("dialog", { name: "Add households" }));
  };

  it("offers what is on the follow-up list and not in the session, none ticked", async () => {
    mount();
    const sheet = await openSheet();
    expect(sheet.getByText("On the follow-up list, not in this session yet.")).toBeVisible();
    const box = await sheet.findByRole("checkbox", { name: "Blk 130 · #h4" });
    expect(box).not.toBeChecked();
    expect(sheet.queryByRole("checkbox", { name: /#h1/ })).toBeNull();
    const add = sheet.getByRole("button", { name: "Add 0 households" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription("Tick the households to add.");
  });

  it("adds the ticked ones, says members will see them, and re-reads", async () => {
    const { onChanged } = mount();
    const sheet = await openSheet();
    fireEvent.click(await sheet.findByRole("checkbox", { name: "Blk 130 · #h4" }));
    fireEvent.click(sheet.getByRole("button", { name: "Add 1 household" }));
    // The sheet's own count is a status too, until it has gone.
    expect(
      await screen.findByText("Added. Members will see them the next time they refresh."),
    ).toHaveAttribute("role", "status");
    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/households", {
      method: "POST",
      body: JSON.stringify({ householdIds: ["h4"] }),
    });
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("just says Added for a draft, which members cannot see yet", async () => {
    mount("draft");
    const sheet = await openSheet();
    fireEvent.click(await sheet.findByRole("checkbox", { name: "Blk 130 · #h4" }));
    fireEvent.click(sheet.getByRole("button", { name: "Add 1 household" }));
    await waitFor(() => {
      expect(screen.getByText("Added.")).toBeVisible();
    });
  });

  it("says when everything on the list is already in the session", async () => {
    server({ listed: () => Promise.resolve(listedPage([note("h1"), note("h2")])) });
    mount();
    const sheet = await openSheet();
    expect(
      await sheet.findByText("Every household on the follow-up list is already in this session."),
    ).toBeVisible();
    expect(sheet.getByRole("link", { name: "Open the follow-up list" })).toHaveAttribute(
      "href",
      "/admin/follow-ups",
    );
  });

  it("says when the follow-up list cannot be read, and reads it again", async () => {
    let fail = true;
    server({
      listed: () =>
        fail
          ? Promise.reject(new TypeError("offline"))
          : Promise.resolve(listedPage([note("h4", { blockName: "130" })])),
    });
    mount();
    const sheet = await openSheet();
    expect(await sheet.findByRole("alert")).toHaveTextContent("Could not load the follow-up list.");
    fail = false;
    fireEvent.click(sheet.getByRole("button", { name: "Try again" }));
    expect(await sheet.findByRole("checkbox", { name: "Blk 130 · #h4" })).toBeVisible();
  });

  it("says why the server refused, and reads the list again", async () => {
    server({
      add: () =>
        Promise.reject(
          new ApiRequestError(409, {
            error: {
              code: "not_on_follow_up_list",
              message:
                "A household you picked is no longer on the follow-up list. Refresh the list and pick again.",
            },
          }),
        ),
    });
    mount();
    const sheet = await openSheet();
    fireEvent.click(await sheet.findByRole("checkbox", { name: "Blk 130 · #h4" }));
    fireEvent.click(sheet.getByRole("button", { name: "Add 1 household" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "A household you picked is no longer on the follow-up list.",
    );
    await waitFor(() => {
      expect(
        apiFetch.mock.calls.filter(([path]) => String(path).startsWith("/follow-ups")),
      ).toHaveLength(2);
    });
  });

  it("says so plainly when the add could not be reached", async () => {
    server({ add: () => Promise.reject(new TypeError("Failed to fetch")) });
    mount();
    const sheet = await openSheet();
    fireEvent.click(await sheet.findByRole("checkbox", { name: "Blk 130 · #h4" }));
    fireEvent.click(sheet.getByRole("button", { name: "Add 1 household" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent("Could not add those households.");
  });

  it("closes on Cancel with nothing added", async () => {
    mount();
    const sheet = await openSheet();
    fireEvent.click(sheet.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(apiFetch).not.toHaveBeenCalledWith("/sessions/s1/households", expect.anything());
  });

  it("sits above the bottom nav", async () => {
    mount();
    await openSheet();
    expect(screen.getByRole("dialog").parentElement).toHaveClass("z-50");
  });
});
