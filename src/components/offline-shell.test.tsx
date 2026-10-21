import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { OfflineShell, PROBE_INTERVAL_MS } from "@/components/offline-shell";
import { SyncProvider } from "@/components/sync-provider";
import type { ActiveSession, HouseholdSummary, VisitSyncItem } from "@/generated/types.gen";
import { LOCAL_COPY_TTL_MS, type LocalCopy, noteBlock } from "@/lib/offline/local-copy";
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
vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("@/lib/use-role", () => ({ useRole }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  apiFetch,
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
};

function mount({
  copy = savedCopy(),
  load = () => Promise.resolve(copy),
  probe = () => Promise.resolve({ kind: "unknown" }),
  queue = createMemoryQueue(),
  send = () => Promise.resolve({ kind: "network" }),
}: Setup = {}) {
  const openQueue = vi.fn(() => Promise.resolve(queue));
  const navigate = vi.fn();
  const probeSpy = vi.fn(probe);
  const view = render(
    <SyncProvider
      openQueue={openQueue}
      send={send}
      signedIn={() => Promise.resolve({ kind: "member", id: ALICE.id })}
    >
      <OfflineShell load={load} probe={probeSpy} navigate={navigate} now={() => NOW} />
    </SyncProvider>,
  );
  return { view, openQueue, navigate, queue, probe: probeSpy };
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
