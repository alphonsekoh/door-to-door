import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { OfflineShell, PROBE_INTERVAL_MS } from "@/components/shell/offline-shell";
import { SyncProvider } from "@/components/sync/sync-provider";
import type {
  ActiveSession,
  HouseholdSummary,
  RevisitEntry,
  VisitSyncItem,
} from "@/generated/types.gen";
import {
  LOCAL_COPY_TTL_MS,
  type LocalCopy,
  noteBlock,
  noteRevisits,
} from "@/lib/offline/local-copy";
import { shellState } from "@/lib/offline/shell-state";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import type { SignedIn } from "@/lib/sync/signed-in";
import type { SendOutcome, SyncQueue } from "@/lib/sync/types";

/* Text drawn in pieces, as a status is around its unit number: the
   innermost element holding the whole of it. */
const pieced = (label: string) => (_: string, element: Element | null) =>
  element?.textContent === label &&
  ![...element.children].some((child) => child.textContent === label);

const { usePathname, useRole, apiFetch } = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/blocks/b1"),
  /* Offline the session cannot be fetched, so nobody is signed in. */
  useRole: vi.fn(() => ({ userId: undefined })),
  apiFetch: vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
}));
vi.mock("next/navigation", () => ({ usePathname, useSelectedLayoutSegment: () => null }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  apiFetch,
}));

/* Every test hands the shell its copy; what it writes back is watched. */
const { updateLocalCopy } = vi.hoisted(() => ({
  updateLocalCopy: vi.fn((_: (copy: unknown) => unknown) => Promise.resolve()),
}));
vi.mock("@/lib/offline/local-copy-store", () => ({
  loadLocalCopy: () => Promise.resolve(null),
  updateLocalCopy,
}));

/* Real time: the queue purges records sent over 24 h ago by its own clock. */
const NOW = Date.now();
const ALICE = { id: "0190a000-0000-7000-8000-00000000000a", name: "Alice Tan" };
const OUTING = "0190a000-0000-7000-8000-0000000000cc";
const BLK_123 = "0190a000-0000-7000-8000-000000000123";
const BLK_456 = "0190a000-0000-7000-8000-000000000456";
const STAMP = "2026-10-15T09:00:00.000Z";

const active: ActiveSession = {
  session: {
    id: OUTING,
    title: "Thursday evening",
    kind: "regular",
    status: "active",
    startedAt: STAMP,
    endedAt: null,
    createdBy: { id: ALICE.id, name: "Admin" },
    createdAt: STAMP,
  },
  blocks: [BLK_123, BLK_456].map((id) => ({
    block: {
      id,
      name: id === BLK_123 ? "123" : "456",
      street: "Ang Mo Kio Ave 3",
      postalCode: null,
      createdAt: STAMP,
    },
    visitCount: 0,
    householdCount: 0,
    activeMembers: [],
  })),
  picks: [],
};

const household: HouseholdSummary = {
  household: {
    id: "0190a000-0000-7000-8000-000000000501",
    blockId: BLK_123,
    unitNumber: "#05-01",
    name: "Mrs Lim",
    contact: null,
    religion: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  visitCount: 1,
  latestVisit: null,
};

function savedCopy(at = NOW): LocalCopy {
  const one = noteBlock(null, ALICE, active, BLK_123, [household], at);
  const two = noteBlock(one, ALICE, active, BLK_456, [], at);
  if (two === null) throw new Error("expected a copy");
  return two;
}

const location = { pathname: "/blocks/b1", search: "", reload: vi.fn(), replace: vi.fn() };

type Setup = {
  copy?: LocalCopy | null;
  load?: () => Promise<LocalCopy | null>;
  probe?: () => Promise<SignedIn>;
  queue?: SyncQueue;
  send?: (items: VisitSyncItem[]) => Promise<SendOutcome>;
  readList?: (outingId: string) => Promise<RevisitEntry[] | null>;
};

function mount({
  copy = savedCopy(),
  load = () => Promise.resolve(copy),
  probe = () => Promise.resolve({ kind: "unknown" }),
  queue = createMemoryQueue(),
  send = () => Promise.resolve({ kind: "network" }),
  readList = () => Promise.resolve(null),
}: Setup = {}) {
  const openQueue = vi.fn(() => Promise.resolve(queue));
  const navigate = vi.fn();
  const probeSpy = vi.fn(probe);
  const readSpy = vi.fn(readList);
  const view = render(
    <SyncProvider
      openQueue={openQueue}
      send={send}
      signedIn={() => Promise.resolve({ kind: "member", id: ALICE.id })}
    >
      <OfflineShell
        load={load}
        probe={probeSpy}
        navigate={navigate}
        now={() => NOW}
        readList={readSpy}
      />
    </SyncProvider>,
  );
  return { view, openQueue, navigate, queue, probe: probeSpy, readList: readSpy };
}

const user = () => userEvent.setup();

async function continueAsAlice() {
  await user().click(await screen.findByRole("button", { name: "Continue as Alice Tan" }));
}

async function openBlock(name: string) {
  await continueAsAlice();
  await user().click(screen.getByRole("button", { name: new RegExp(`Blk ${name}`) }));
}

const reconnectRow = () =>
  screen.getByText(/^(Offline\. Records save|Back online\.)/).parentElement;

beforeEach(() => {
  vi.clearAllMocks();
  location.pathname = "/blocks/b1";
  location.search = "";
  vi.stubGlobal("location", location);
});

afterEach(() => {
  vi.unstubAllGlobals();
  shellState.leave();
});

describe("OfflineShell, before anyone continues", () => {
  it("says it is looking while the copy loads", () => {
    mount({ load: () => new Promise(() => undefined) });
    expect(screen.getByText("Looking for what is saved on this phone…")).toBeInTheDocument();
  });

  it("reloads when signal returns while the copy is still being read", () => {
    mount({ load: () => new Promise(() => undefined) });
    window.dispatchEvent(new Event("online"));
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["nothing saved", () => Promise.resolve(null)],
    ["a copy that cannot be read", () => Promise.reject(new Error("IndexedDB broke"))],
    [
      "a copy older than twelve hours",
      () => Promise.resolve(savedCopy(NOW - LOCAL_COPY_TTL_MS - 1)),
    ],
  ])("with %s, says so and offers Try again as a real page load", async (_, load) => {
    const { view, openQueue } = mount({ load });
    expect(
      await screen.findByText(
        "Nothing is saved on this phone to record with. Connect and open your session first.",
      ),
    ).toBeInTheDocument();
    const form = view.container.querySelector("form");
    expect(form).toContainElement(screen.getByRole("button", { name: "Try again" }));
    expect(form).toHaveAttribute("action", "/");
    expect(form).toHaveAttribute("method", "get");
    expect(openQueue).not.toHaveBeenCalled();

    // Holds no input, so signal coming back may reload it (D-33-22).
    window.dispatchEvent(new Event("online"));
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("asks who is holding the phone, and shows no form and runs no queue until told", async () => {
    const { openQueue } = mount();
    expect(await screen.findByRole("button", { name: "Continue as Alice Tan" })).toBeVisible();
    expect(screen.getByText("Not Alice Tan? Sign in when you have signal.")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Save and next" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Blk 123/)).not.toBeInTheDocument();
    expect(screen.queryByText("Thursday evening")).not.toBeInTheDocument();
    expect(openQueue).not.toHaveBeenCalled();
    expect(shellState.getSnapshot()).toEqual({ active: true, ownerId: null });

    window.dispatchEvent(new Event("online"));
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("hides the nav's room and is the shell while shown, and lets go when gone", () => {
    const { view } = mount();
    expect(document.documentElement.style.getPropertyValue("--nav-height")).toBe("0px");
    expect(shellState.getSnapshot().active).toBe(true);
    view.unmount();
    expect(document.documentElement.style.getPropertyValue("--nav-height")).toBe("");
    expect(shellState.getSnapshot().active).toBe(false);
  });
});

describe("OfflineShell, recording", () => {
  it("runs the queue for the member who continued, and lists their blocks", async () => {
    const { openQueue } = mount();
    await continueAsAlice();

    expect(shellState.getSnapshot()).toEqual({ active: true, ownerId: ALICE.id });
    await waitFor(() => {
      expect(openQueue).toHaveBeenCalled();
    });
    expect(screen.getByText("Thursday evening")).toBeInTheDocument();
    const blocks = screen.getByRole("list", { name: "Blocks saved on this phone" });
    expect(
      within(blocks)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Blk 123Ang Mo Kio Ave 3", "Blk 456Ang Mo Kio Ave 3"]);
  });

  it("no longer reloads when signal returns: someone may be mid-form", async () => {
    mount();
    await continueAsAlice();
    window.dispatchEvent(new Event("online"));
    expect(location.reload).not.toHaveBeenCalled();
    expect(location.replace).not.toHaveBeenCalled();
  });

  it("queues a save under the copy's member and outing", async () => {
    const { queue } = mount();
    await openBlock("123");
    // The block it opened is the title, in place of "Offline".
    expect(screen.getByRole("heading", { level: 1, name: "Blk 123" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Offline" })).not.toBeInTheDocument();

    const u = user();
    await u.type(screen.getByLabelText("Unit number"), "#05-02");
    await u.click(screen.getByRole("radio", { name: "High" }));
    await u.click(screen.getByRole("button", { name: "Save and next" }));

    expect(await screen.findByText(pieced("Saved #05-02 on this phone."))).toBeInTheDocument();
    const [saved] = await queue.listAll();
    expect(saved?.ownerId).toBe(ALICE.id);
    expect(saved?.item).toMatchObject({
      sessionId: OUTING,
      blockId: BLK_123,
      unitNumber: "#05-02",
    });
    // Counted with the blocks, a tap back: the form alone sits under the title.
    expect(screen.queryByText("1 record is saved on this phone.")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "All blocks" }));
    expect(screen.getByRole("heading", { level: 1, name: "Offline" })).toBeInTheDocument();
    expect(await screen.findByText("1 record is saved on this phone.")).toBeInTheDocument();
  });

  /* Its copy of the block may be hours old, and a unit not in it may have
     been visited since (#196). */
  it("never says a unit missing from its copy has no earlier visits", async () => {
    mount();
    await openBlock("123");
    await user().type(screen.getByLabelText("Unit number"), "#05-02");
    const line = document.getElementById("unit-history");
    expect(line).toBeInTheDocument();
    expect(line).toHaveTextContent(/^$/);
  });

  it("counts only this member's records, never another's on the same phone", async () => {
    const draft = {
      blockId: BLK_123,
      unitNumber: "#07-01",
      interestLevel: "low" as const,
      description: "",
      name: "",
      contact: "",
      religion: "" as const,
      sessionId: OUTING,
    };
    const queue = createMemoryQueue([
      buildQueuedVisit(draft, "someone-else", NOW),
      buildQueuedVisit({ ...draft, unitNumber: "#07-02" }, ALICE.id, NOW),
    ]);
    mount({ queue });
    await continueAsAlice();
    expect(await screen.findByText("1 record is saved on this phone.")).toBeInTheDocument();

    await user().click(screen.getByRole("button", { name: /Blk 123/ }));
    await user().click(screen.getByRole("tab", { name: /All units/ }));
    expect(screen.getByText("#07-02")).toBeInTheDocument();
    expect(screen.queryByText("#07-01")).not.toBeInTheDocument();
  });

  it("lists units that cannot be opened, and keeps one sent from here, marked Sent", async () => {
    const sent = {
      ...buildQueuedVisit(
        {
          blockId: BLK_123,
          unitNumber: "#05-09",
          interestLevel: "high",
          description: "",
          name: "",
          contact: "",
          religion: "",
          sessionId: OUTING,
        },
        ALICE.id,
        NOW + 1,
      ),
      state: "synced" as const,
      syncedAt: NOW + 2,
    };
    mount({ queue: createMemoryQueue([sent]) });
    await openBlock("123");
    await user().click(await screen.findByRole("tab", { name: "All units (2)" }));

    expect(screen.getByText("Mrs Lim")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    // Amending needs the server's row: nothing in the list is a button.
    expect(within(screen.getByRole("tabpanel")).queryAllByRole("button")).toEqual([]);
  });

  it("goes back to the blocks in-page, asking first if the form has input", async () => {
    mount();
    await openBlock("123");
    const u = user();

    await u.type(screen.getByLabelText("Unit number"), "#05-02");
    await u.click(screen.getByRole("button", { name: "All blocks" }));
    const dialog = screen.getByRole("alertdialog", { name: "Leave without saving this visit?" });
    await u.click(within(dialog).getByRole("button", { name: "Keep as it is" }));
    expect(screen.getByLabelText("Unit number")).toHaveValue("#05-02");

    await u.click(screen.getByRole("button", { name: "All blocks" }));
    await u.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByRole("list", { name: "Blocks saved on this phone" })).toBeInTheDocument();

    // Nothing typed: straight back.
    await u.click(screen.getByRole("button", { name: /Blk 456/ }));
    await u.click(screen.getByRole("button", { name: "All blocks" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Blocks saved on this phone" })).toBeInTheDocument();
  });
});

describe("the reconnect row", () => {
  it("is the same row in every state, saying the records are safe", async () => {
    let finish: (copy: LocalCopy | null) => void = () => undefined;
    mount({
      load: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const row = reconnectRow();
    expect(row).toHaveTextContent("Offline. Records save on this phone.");

    await act(async () => {
      finish(savedCopy());
      await Promise.resolve();
    });
    expect(reconnectRow()).toBe(row);
    await continueAsAlice();
    expect(reconnectRow()).toBe(row);
    await user().click(screen.getByRole("button", { name: /Blk 123/ }));
    expect(reconnectRow()).toBe(row);
  });

  it("offers Continue only once the server answers, not when the browser says online", async () => {
    let answer: SignedIn = { kind: "unknown" };
    const { probe, navigate } = mount({ probe: () => Promise.resolve(answer) });
    await continueAsAlice();
    expect(probe).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();

    window.dispatchEvent(new Event("online"));
    await act(() => Promise.resolve());
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();

    answer = { kind: "member", id: null };
    window.dispatchEvent(new Event("focus"));
    await user().click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.getByText("Back online.")).toBeInTheDocument();
    // A full load of where the member was going; never a navigation by itself.
    expect(navigate).toHaveBeenCalledWith("/blocks/b1");
  });

  it("offers Continue once a record gets through, even if no probe has yet", async () => {
    mount({
      send: (items) =>
        Promise.resolve({
          kind: "ok",
          results: items.map((item) => ({ id: item.id, status: "applied" as const })),
        }),
    });
    await openBlock("123");
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    const u = user();
    await u.type(screen.getByLabelText("Unit number"), "#05-02");
    await u.click(screen.getByRole("radio", { name: "High" }));
    await u.click(screen.getByRole("button", { name: "Save and next" }));
    expect(await screen.findByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("goes home when the offline page is itself the address, and keeps a query", async () => {
    location.pathname = "/offline";
    const first = mount({ probe: () => Promise.resolve({ kind: "member", id: ALICE.id }) });
    await user().click(await screen.findByRole("button", { name: "Continue" }));
    expect(first.navigate).toHaveBeenCalledWith("/");
    first.view.unmount();

    location.pathname = "/history";
    location.search = "?scope=team";
    const second = mount({ probe: () => Promise.resolve({ kind: "member", id: ALICE.id }) });
    await user().click(await screen.findByRole("button", { name: "Continue" }));
    expect(second.navigate).toHaveBeenCalledWith("/history?scope=team");
  });

  it("asks before leaving a form with input", async () => {
    const { navigate } = mount({ probe: () => Promise.resolve({ kind: "member", id: ALICE.id }) });
    await openBlock("123");
    const u = user();
    await u.click(screen.getByRole("radio", { name: "Low" }));

    await u.click(await screen.findByRole("button", { name: "Continue" }));
    expect(navigate).not.toHaveBeenCalled();
    await u.click(screen.getByRole("button", { name: "Leave" }));
    expect(navigate).toHaveBeenCalledWith("/blocks/b1");
  });

  it("asks again on focus, on coming back into view, and every 30 s, one at a time", async () => {
    vi.useFakeTimers();
    let settle: (answer: SignedIn) => void = () => undefined;
    const { probe } = mount({
      load: () => Promise.resolve(null),
      probe: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    });
    expect(probe).toHaveBeenCalledTimes(1);
    // Still waiting on the first answer: no second request piles up.
    window.dispatchEvent(new Event("focus"));
    expect(probe).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle({ kind: "unknown" });
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(PROBE_INTERVAL_MS);
    });
    expect(probe).toHaveBeenCalledTimes(2);

    await act(async () => {
      settle({ kind: "unknown" });
      await Promise.resolve();
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(probe).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(probe).toHaveBeenCalledTimes(3);

    // Once answered it keeps asking, so a lost signal shows.
    await act(async () => {
      settle({ kind: "member", id: null });
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(PROBE_INTERVAL_MS);
    });
    expect(probe).toHaveBeenCalledTimes(4);
    await act(async () => {
      settle({ kind: "unknown" });
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(reconnectRow()).toHaveTextContent("Offline. Records save on this phone.");
    vi.useRealTimers();
  });

  it("stops offering Continue the moment the signal drops, and ignores an answer from before", async () => {
    let settle: (answer: SignedIn) => void = () => undefined;
    const { probe } = mount({
      probe: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    });
    await continueAsAlice();
    await act(async () => {
      settle({ kind: "member", id: ALICE.id });
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();

    window.dispatchEvent(new Event("focus"));
    expect(probe).toHaveBeenCalledTimes(2);
    const beforeTheDrop = settle;
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(reconnectRow()).toHaveTextContent("Offline. Records save on this phone.");

    // Asked before the drop, answered after it: not proof of anything now.
    await act(async () => {
      beforeTheDrop({ kind: "member", id: ALICE.id });
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();

    // A fresh question is asked, not blocked by the abandoned one.
    window.dispatchEvent(new Event("online"));
    expect(probe).toHaveBeenCalledTimes(3);
    await act(async () => {
      settle({ kind: "member", id: ALICE.id });
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("does not count a send from before the signal dropped, only one after", async () => {
    mount({
      send: (items) =>
        Promise.resolve({
          kind: "ok",
          results: items.map((item) => ({ id: item.id, status: "applied" as const })),
        }),
    });
    await openBlock("123");
    const u = user();
    const save = async (unit: string) => {
      await u.type(screen.getByLabelText("Unit number"), unit);
      await u.click(screen.getByRole("radio", { name: "High" }));
      await u.click(screen.getByRole("button", { name: "Save and next" }));
    };
    await save("#05-02");
    expect(await screen.findByRole("button", { name: "Continue" })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();

    await save("#05-03");
    expect(await screen.findByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
});

const followUp: ActiveSession = { ...active, session: { ...active.session, kind: "follow_up" } };

/* A household on the follow-up list, in Blk 123 unless another is named. */
function onTheList(
  unitNumber = "#05-01",
  blockId = BLK_123,
  note = "Bring the booklet",
  name: string | null = "Mrs Lim",
): RevisitEntry {
  const id = `0190a000-0000-7000-8000-${unitNumber.replace(/\D/g, "").padStart(12, "0")}`;
  const block = active.blocks.find((entry) => entry.block.id === blockId)?.block;
  if (block === undefined) throw new Error("expected a block");
  return {
    household: { ...household.household, id, blockId, unitNumber, name },
    block,
    notes: [
      {
        id: `${id.slice(0, -2)}f1`,
        householdId: id,
        blockId,
        blockName: block.name,
        unitNumber,
        visitId: null,
        status: "listed",
        author: { id: ALICE.id, name: "Admin", image: null },
        note,
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
      },
    ],
    latestVisit: null,
    visitedInSession: false,
  };
}

describe("OfflineShell, in a follow-up session", () => {
  const followUpCopy = (withList: boolean): LocalCopy => {
    const one = noteBlock(null, ALICE, followUp, BLK_123, [household], NOW);
    if (one === null) throw new Error("expected a copy");
    if (!withList) return one;
    return noteRevisits(one, ALICE, followUp, [onTheList()], NOW);
  };

  it("offers the units on the list it saved, and refuses one that is not", async () => {
    mount({ copy: followUpCopy(true) });
    await openBlock("123");
    const chips = within(screen.getByRole("list", { name: "On the list in this block" }));
    expect(chips.getByRole("button", { name: "#05-01" })).toBeInTheDocument();
    await user().type(screen.getByLabelText("Unit number"), "#05-02");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      /^#05-02 is not on this session's list/,
    );
  });

  it("says it could not check when no list was saved", async () => {
    mount({ copy: followUpCopy(false) });
    await openBlock("123");
    await user().type(screen.getByLabelText("Unit number"), "#05-02");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      /^Could not check this session's list\./,
    );
  });

  it("says why only some units can be recorded, before any is typed", async () => {
    mount({ copy: followUpCopy(true) });
    await openBlock("123");
    expect(screen.getByText(/Only units on the list can be recorded\.$/)).toBeInTheDocument();
  });

  const chips = () => screen.queryByRole("list", { name: "On the list in this block" });
  const listed = () => followUpCopy(true).revisits ?? [];

  it("keeps the saved list while the server cannot be read", async () => {
    const { readList } = mount({ copy: followUpCopy(true) });
    await openBlock("123");
    await waitFor(() => {
      expect(readList).toHaveBeenCalledWith(OUTING);
    });
    expect(chips()).toBeInTheDocument();
    expect(updateLocalCopy).not.toHaveBeenCalled();
  });

  it("reads the list again once the server answers, and stops offering a unit taken off it", async () => {
    // The server answers once the block is open: with the list empty, the
    // home would offer no block to open.
    let answer: RevisitEntry[] | null = null;
    mount({ copy: followUpCopy(true), readList: () => Promise.resolve(answer) });
    await openBlock("123");
    answer = [];
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(chips()).not.toBeInTheDocument();
    });
    await user().type(screen.getByLabelText("Unit number"), "#05-01");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      /^#05-01 is not on this session's list/,
    );
    // And the copy a later reload opens says so too.
    const change = updateLocalCopy.mock.calls[0]?.[0];
    expect(change?.(followUpCopy(true))).toEqual({ ...followUpCopy(true), revisits: [] });
  });

  it("reads it again when the server holds a record as off the list", async () => {
    let answer: RevisitEntry[] | null = null;
    const { readList } = mount({
      copy: followUpCopy(true),
      readList: () => Promise.resolve(answer),
      send: (items) => {
        // Signal is back, and an admin took #05-01 off the list meanwhile.
        answer = [];
        return Promise.resolve({
          kind: "ok",
          results: items.map((item) => ({
            id: item.id,
            status: "rejected" as const,
            error: { error: { code: "not_on_follow_up_list" as const, message: "Not listed." } },
          })),
        });
      },
    });
    await openBlock("123");
    const u = user();
    await u.click(within(chips() ?? document.body).getByRole("button", { name: "#05-01" }));
    await u.click(screen.getByRole("radio", { name: "High" }));
    await u.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(chips()).not.toBeInTheDocument();
    });
    expect(readList.mock.calls.length).toBeGreaterThan(1);
  });

  it("reads it again when the member comes back to the app", async () => {
    const { readList } = mount({ copy: followUpCopy(true) });
    await openBlock("123");
    await waitFor(() => {
      expect(readList).toHaveBeenCalled();
    });
    const before = readList.mock.calls.length;
    readList.mockResolvedValueOnce([]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(chips()).not.toBeInTheDocument();
    });
    expect(readList.mock.calls.length).toBe(before + 1);
  });

  it("lets only the newest read land", async () => {
    let first: (list: RevisitEntry[] | null) => void = () => undefined;
    let calls = 0;
    mount({
      copy: followUpCopy(true),
      readList: () => {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              first = resolve;
            })
          : Promise.resolve(listed());
      },
    });
    await openBlock("123");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    // The older read, from before the newest, says the list is empty.
    await act(async () => {
      first([]);
      await Promise.resolve();
    });
    expect(chips()).toBeInTheDocument();
  });

  it("asks for no list in a door-to-door session", async () => {
    const { readList } = mount();
    await openBlock("123");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(readList).not.toHaveBeenCalled();
    expect(screen.queryByText(/Only units on the list/)).toBeNull();
  });
});

/*
 * The stairwell: a member read the list on the session screen with signal,
 * then tapped a household in a block they had never opened, with none.
 */
describe("OfflineShell, from a follow-up session's list", () => {
  const BLK_456_UNIT = "#11-90";
  /* #05-01 answered last week; #11-90 never gave a name. */
  const answered: RevisitEntry = {
    ...onTheList(),
    latestVisit: {
      id: "0190a000-0000-7000-8000-0000000000e1",
      householdId: household.household.id,
      sessionId: "0190a000-0000-7000-8000-0000000000dd",
      member: { id: ALICE.id, name: "Alice Tan", image: null },
      team: null,
      interestLevel: "medium",
      description: "",
      clientCreatedAt: STAMP,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  };
  const listOnly = (
    entries = [answered, onTheList(BLK_456_UNIT, BLK_456, "Ask about Sunday", null)],
  ) => noteRevisits(null, ALICE, followUp, entries, NOW);
  const list = () => screen.getByRole("region", { name: "Households to revisit" });
  const unit = () => screen.getByLabelText("Unit number");

  it("offers the list, grouped by block, with no block ever opened", async () => {
    mount({ copy: listOnly() });
    await continueAsAlice();
    expect(within(list()).getByText("0 of 2 visited or done")).toBeInTheDocument();
    expect(
      within(list()).getByText("As last read with signal. Tap a household to record your visit."),
    ).toBeInTheDocument();
    expect(
      within(list())
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "Open block, Blk 123",
      "#05-01MediumMrs LimBring the booklet",
      "Open block, Blk 456",
      "#11-90Name not knownAsk about Sunday",
    ]);
    expect(screen.queryByRole("list", { name: "Blocks saved on this phone" })).toBeNull();
  });

  it("opens a household's block with its unit filled in, and says what is saved of it", async () => {
    const { queue } = mount({ copy: listOnly() });
    await continueAsAlice();
    const u = user();
    await u.click(within(list()).getByRole("button", { name: /^#11-90/ }));

    expect(screen.getByRole("heading", { level: 1, name: "Blk 456" })).toBeInTheDocument();
    expect(unit()).toHaveValue(BLK_456_UNIT);
    await u.click(screen.getByRole("radio", { name: "High" }));
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(pieced(`Saved ${BLK_456_UNIT} on this phone.`))).toBeVisible();
    const [saved] = await queue.listAll();
    expect(saved?.item).toMatchObject({
      sessionId: OUTING,
      blockId: BLK_456,
      unitNumber: BLK_456_UNIT,
    });

    await u.click(screen.getByRole("tab", { name: /All units/ }));
    expect(
      screen.getByText(
        "This block was not opened with signal, so only its households on the list are saved on this phone.",
      ),
    ).toBeInTheDocument();

    // Back to the list, which counts the visit this phone holds.
    await u.click(screen.getByRole("button", { name: "The list" }));
    expect(within(list()).getByText("1 of 2 visited or done")).toBeInTheDocument();
    expect(
      within(within(list()).getByRole("button", { name: /^#11-90/ })).getByText("Visited"),
    ).toBeInTheDocument();
  });

  it("opens a block whole when it was opened with signal, saying nothing of what is missing", async () => {
    const opened = noteBlock(listOnly(), ALICE, followUp, BLK_123, [household], NOW);
    mount({ copy: opened });
    await continueAsAlice();
    await user().click(within(list()).getByRole("button", { name: "Open block, Blk 123" }));
    expect(unit()).toHaveValue("");
    await user().click(screen.getByRole("tab", { name: /All units/ }));
    expect(screen.queryByText(/was not opened with signal/)).toBeNull();
  });

  it("opens the household it was on its way to as the member continues", async () => {
    location.pathname = `/blocks/${BLK_456}`;
    location.search = `?unit=${encodeURIComponent(BLK_456_UNIT)}`;
    mount({ copy: listOnly() });
    await continueAsAlice();
    expect(screen.getByRole("heading", { level: 1, name: "Blk 456" })).toBeInTheDocument();
    expect(unit()).toHaveValue(BLK_456_UNIT);
    expect(screen.getByText(/Only units on the list can be recorded\.$/)).toBeInTheDocument();
  });

  it("follows the list as read again: a household added shows, and none left says so", async () => {
    let answer: RevisitEntry[] | null = [onTheList(), onTheList("#05-07", BLK_123, "New")];
    const { readList } = mount({ copy: listOnly(), readList: () => Promise.resolve(answer) });
    await continueAsAlice();
    expect(await within(list()).findByRole("button", { name: /^#05-07/ })).toBeInTheDocument();
    expect(within(list()).queryByRole("button", { name: /^#11-90/ })).toBeNull();

    answer = [];
    const before = readList.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(
      await screen.findByText("No households are on this session's list right now."),
    ).toBeInTheDocument();
    expect(readList.mock.calls.length).toBe(before + 1);
  });

  it("keeps a member's form open when a list read again drops its block", async () => {
    let answer: RevisitEntry[] | null = null;
    mount({ copy: listOnly(), readList: () => Promise.resolve(answer) });
    await continueAsAlice();
    await user().click(within(list()).getByRole("button", { name: /^#11-90/ }));
    await user().click(screen.getByRole("radio", { name: "Low" }));

    answer = [onTheList()];
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(unit()).toHaveAccessibleDescription(/^#11-90 is not on this session's list/);
    });
    expect(screen.getByRole("heading", { level: 1, name: "Blk 456" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Low" })).toBeChecked();
  });
});

describe("OfflineShell, at the address it was going to", () => {
  it("opens a saved block a reload there named, as the member continues", async () => {
    location.pathname = `/blocks/${BLK_456}`;
    mount();
    await continueAsAlice();
    expect(screen.getByRole("heading", { level: 1, name: "Blk 456" })).toBeInTheDocument();
    expect(screen.getByLabelText("Unit number")).toHaveValue("");
    await user().click(screen.getByRole("button", { name: "All blocks" }));
    expect(screen.getByRole("list", { name: "Blocks saved on this phone" })).toBeInTheDocument();
  });

  it("offers the blocks when the address names a block it has nothing saved for", async () => {
    location.pathname = "/blocks/0190a000-0000-7000-8000-000000000999";
    mount();
    await continueAsAlice();
    expect(screen.getByRole("list", { name: "Blocks saved on this phone" })).toBeInTheDocument();
  });
});
