import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HouseholdHistoryPanel, type Thread } from "@/components/households/household-history";
import type { FollowUp } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { formatDayTime } from "@/lib/history/dates";
import { CLAMP_CHARS } from "@/lib/households/clamp";
import { history, queuedRecord, visit } from "../../../test/thread-fixtures";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
});

const NONE: Thread = { cachedAt: null, queued: [] };
const noop = () => undefined;

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T09:00:00.000Z`;
const dated = (id: string, day: number, over: Partial<ReturnType<typeof visit>> = {}) =>
  visit(id, { createdAt: at(day), updatedAt: at(day), ...over });

function mount(h = history(1), thread: Thread = NONE) {
  return render(
    <HouseholdHistoryPanel history={h} active={null} onChanged={noop} atDoor thread={thread} />,
  );
}

const entries = () =>
  within(screen.getByRole("list", { name: "Timeline" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

describe("a unit's thread", () => {
  it("lists the newest visit first, each with its interest, date, member and description", () => {
    mount(
      history(1, [
        dated("v3", 12, { interestLevel: "high", description: "Wants a Bible study" }),
        dated("v2", 5, { interestLevel: "low", description: "Busy" }),
        dated("v1", 1, { interestLevel: "no_response", description: "" }),
      ]),
    );
    const [newest, middle, oldest] = entries();
    expect(newest).toContain("High");
    expect(newest).toContain("12 Oct 2026");
    expect(newest).toContain("Ben Lim");
    expect(newest).toContain("Wants a Bible study");
    expect(middle).toContain("Low");
    expect(oldest).toContain("No answer");
    expect(oldest).toContain("1 Oct 2026");
  });

  it("shows a team only on a visit stamped with one", () => {
    const team = { id: "t1", name: "Pair A", members: [{ id: "u3", name: "Cho Lee" }] };
    mount(history(1, [dated("v2", 12, { team }), dated("v1", 1)]));
    const [stamped, plain] = entries();
    expect(stamped).toContain("Team: Pair A");
    expect(stamped).toContain("Ben Lim with Cho Lee");
    expect(plain).not.toContain("Team:");
  });

  it("puts this phone's own records first, saying one is not sent yet", () => {
    const sent = queuedRecord(
      "#05-01",
      { id: "q2", state: "synced", syncedAt: 5 },
      { description: "" },
    );
    mount(history(1, [dated("v1", 1)]), {
      cachedAt: null,
      queued: [queuedRecord("#05-01", { id: "q1" }), sent],
    });
    const [own, sentOwn, earlier] = entries();
    expect(own).toContain("You");
    expect(own).toContain("Not sent yet");
    expect(own).toContain("High");
    expect(own).toContain("Asked us in");
    expect(sentOwn).toContain("You");
    expect(sentOwn).not.toContain("Not sent yet");
    expect(earlier).toContain("Ben Lim");
  });

  it("names the religion when it is known, and says nothing of it when it is not", () => {
    const { unmount } = mount(history(1, undefined, "christian"));
    expect(screen.getByText("Religion: Christian")).toBeInTheDocument();
    unmount();
    mount(history(1));
    expect(screen.queryByText(/Religion/)).not.toBeInTheDocument();
  });

  it("says when what it shows was last read with signal, only when told", () => {
    const readAt = Date.parse("2026-10-15T15:38:00.000Z");
    const { unmount } = mount(history(1), { cachedAt: readAt, queued: [] });
    expect(
      screen.getByText(`As last read with signal, ${formatDayTime(readAt)}.`),
    ).toBeInTheDocument();
    unmount();
    mount(history(1), NONE);
    expect(screen.queryByText(/As last read with signal/)).not.toBeInTheDocument();
  });

  it("keeps the head lines and has no timeline for a door with no visits", () => {
    mount(history(1, []));
    expect(screen.getByText("Mrs Tan")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Timeline" })).not.toBeInTheDocument();
  });

  it("clamps a long description behind Read more, and Read less closes it", async () => {
    const long = `${"Talked about the family and the neighbours. ".repeat(8)}Ends here.`;
    expect(long.length).toBeGreaterThan(CLAMP_CHARS);
    const user = userEvent.setup();
    mount(history(1, [dated("v1", 1, { description: long })]));
    const more = screen.getByRole("button", { name: "Read more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Ends here/)).not.toBeInTheDocument();
    await user.click(more);
    const less = screen.getByRole("button", { name: "Read less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Ends here/)).toBeInTheDocument();
    await user.click(less);
    expect(screen.queryByText(/Ends here/)).not.toBeInTheDocument();
  });

  it("offers no Read more for a short description", () => {
    mount(history(1, [dated("v1", 1)]));
    expect(screen.queryByRole("button", { name: /Read/ })).not.toBeInTheDocument();
  });

  it("shows a resolved note as one line among the visits", () => {
    const done: FollowUp = {
      id: "f1",
      householdId: "h1",
      blockId: "b1",
      blockName: "123",
      unitNumber: "#05-01",
      visitId: null,
      status: "listed",
      author: { id: "u2", name: "Ben", image: null },
      note: "Bring the flyer",
      dueDate: null,
      doneAt: at(8),
      doneBy: { id: "u2", name: "Ben", image: null },
      listedAt: at(8),
      listedBy: null,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      waitingSuggestionBy: null,
      createdAt: at(8),
    };
    mount({ ...history(1, [dated("v2", 12), dated("v1", 3)]), followUps: [done] });
    const items = entries();
    expect(items).toHaveLength(3);
    expect(items[1]).toBe("Follow-up done · Bring the flyer");
  });

  it("puts Show earlier visits after the oldest entry, and adds the older page below it", async () => {
    const newer = Array.from({ length: 2 }, (_, i) =>
      dated(`n${String(i)}`, 20 - i, { description: `new ${String(i)}` }),
    );
    const base = history(1, newer);
    apiFetch.mockResolvedValue({
      ...history(1, [dated("old", 2, { description: "from long ago" })]),
      pagination: { total: 3, limit: 20, offset: 2, hasMore: false },
    });
    const user = userEvent.setup();
    mount({ ...base, pagination: { total: 3, limit: 20, offset: 0, hasMore: true } });
    const list = screen.getByRole("list", { name: "Timeline" });
    const button = screen.getByRole("button", { name: "Show earlier visits" });
    expect(list.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await user.click(button);
    await waitFor(() => {
      expect(entries()).toHaveLength(3);
    });
    expect(entries()[2]).toContain("from long ago");
    expect(screen.queryByRole("button", { name: "Show earlier visits" })).not.toBeInTheDocument();
  });

  it("says earlier visits could not be loaded, below the entries", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    mount({ ...history(1), pagination: { total: 40, limit: 20, offset: 0, hasMore: true } });
    await user.click(screen.getByRole("button", { name: "Show earlier visits" }));
    expect(await screen.findByText("Could not load earlier visits.")).toBeInTheDocument();
  });

  describe("with the unit on the running session's list but the session unknown", () => {
    const owed: FollowUp = {
      id: "f2",
      householdId: "h1",
      blockId: "b1",
      blockName: "123",
      unitNumber: "#05-01",
      visitId: null,
      status: "listed",
      author: { id: "u2", name: "Ben", image: null },
      note: "Bring the booklet",
      dueDate: null,
      doneAt: null,
      doneBy: null,
      listedAt: at(8),
      listedBy: null,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      waitingSuggestionBy: null,
      createdAt: at(8),
    };
    const withNote = { ...history(1), followUps: [owed] };

    it.each([
      ["a member", false],
      ["an admin", true],
    ])("tells %s saving marks it done, with no locked line and no Mark done", (_, isAdmin) => {
      useRole.mockReturnValue({ userId: "u1", isAdmin });
      render(
        <HouseholdHistoryPanel
          history={withNote}
          active={null}
          onChanged={noop}
          atDoor
          onSessionList
          thread={NONE}
        />,
      );
      expect(screen.getByText("Saving your visit marks this done.")).toBeInTheDocument();
      expect(screen.queryByText(/You can mark this done during/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    });

    it("still tells a member off the list when it is not said to be on it", () => {
      mount(withNote);
      expect(screen.getByText(/You can mark this done during/)).toBeInTheDocument();
      expect(screen.queryByText("Saving your visit marks this done.")).toBeNull();
    });
  });
});
