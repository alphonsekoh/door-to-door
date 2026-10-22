import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProvider, useSyncQueue } from "@/components/sync/sync-provider";
import { SyncStatusBar } from "@/components/sync/sync-status-bar";
import type { VisitSyncItem } from "@/generated/types.gen";
import { shellState } from "@/lib/offline/shell-state";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import type * as SignedInModule from "@/lib/sync/signed-in";
import type { SignedIn } from "@/lib/sync/signed-in";
import type { QueuedVisit, SendOutcome } from "@/lib/sync/types";

const { usePathname, useRole, fetchSignedIn } = vi.hoisted(() => ({
  usePathname: vi.fn<() => string>(),
  useRole: vi.fn(),
  fetchSignedIn: vi.fn<() => Promise<SignedIn>>(),
}));
vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));
/* Who the server says is signed in, asked before every send. */
vi.mock("@/lib/sync/signed-in", async (importOriginal) => ({
  ...(await importOriginal<typeof SignedInModule>()),
  fetchSignedIn,
}));
const { isLeavingOnPurpose } = vi.hoisted(() => ({
  isLeavingOnPurpose: vi.fn(() => false),
}));
vi.mock("@/lib/session/navigate", () => ({ isLeavingOnPurpose }));
const cookieFor = (id: string | null) => fetchSignedIn.mockResolvedValue({ kind: "member", id });

const as = (userId: string | undefined) => useRole.mockReturnValue({ userId });

const draft = (unitNumber: string) => ({
  blockId: "0190a000-0000-7000-8000-0000000000bb",
  unitNumber,
  interestLevel: "high" as const,
  description: "",
  name: "",
  contact: "",
  religion: "" as const,
  sessionId: "0190a000-0000-7000-8000-0000000000cc",
});

const stored = (ownerId: string, unitNumber: string, overrides: Partial<QueuedVisit> = {}) => ({
  ...buildQueuedVisit(draft(unitNumber), ownerId, Date.now() - 1_000),
  ...overrides,
});

const applied = (items: VisitSyncItem[]): SendOutcome => ({
  kind: "ok",
  results: items.map((item) => ({ id: item.id, status: "applied" })),
});

/* Shows what a screen would read from the queue, and the two actions. */
function Probe() {
  const queue = useSyncQueue();
  return (
    <div>
      <p data-testid="owner">{queue.ownerId ?? "none"}</p>
      <p data-testid="units">
        {queue.records.map((r) => `${r.item.unitNumber}:${r.state}`).join(",")}
      </p>
      <p data-testid="version">{queue.syncedVersion}</p>
      <p data-testid="active">{queue.enqueue === null ? "off" : "on"}</p>
      <button type="button" onClick={() => void queue.enqueue?.(draft("#09-01"))}>
        save
      </button>
      <button type="button" onClick={queue.retryAll}>
        retry all
      </button>
      <button
        type="button"
        onClick={() => {
          queue.retry(queue.records[0]?.id ?? "");
        }}
      >
        retry first
      </button>
    </div>
  );
}

function mount(
  queue = createMemoryQueue(),
  send = vi.fn((items: VisitSyncItem[]) => Promise.resolve(applied(items))),
) {
  const open = () => Promise.resolve(queue);
  const view = render(
    <SyncProvider openQueue={open} send={send}>
      <Probe />
    </SyncProvider>,
  );
  return { queue, send, view, open };
}

const text = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  vi.clearAllMocks();
  usePathname.mockReturnValue("/blocks/b1");
  as("ann");
  cookieFor("ann");
});

afterEach(() => {
  shellState.leave();
  Reflect.deleteProperty(navigator, "locks");
  Reflect.deleteProperty(navigator, "storage");
});

describe("SyncProvider", () => {
  it("is off with nobody signed in, so the form saves directly", () => {
    as(undefined);
    const { send } = mount();
    expect(text("active")).toBe("off");
    expect(text("owner")).toBe("none");
    expect(send).not.toHaveBeenCalled();
  });

  it("is off on a public page", () => {
    usePathname.mockReturnValue("/sign-in");
    mount();
    expect(text("active")).toBe("off");
  });

  it("is off where the queue cannot be opened", async () => {
    render(
      <SyncProvider openQueue={() => Promise.resolve(null)}>
        <Probe />
      </SyncProvider>,
    );
    await act(() => Promise.resolve());
    expect(text("active")).toBe("off");
  });

  it("sends what was waiting as soon as the app starts", async () => {
    const waiting = stored("ann", "#05-01");
    const { send } = mount(createMemoryQueue([waiting]));
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:synced");
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(text("version")).toBe("1");
  });

  it("saves into the queue and sends it", async () => {
    const { queue } = mount();
    await waitFor(() => {
      expect(text("active")).toBe("on");
    });
    await userEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => {
      expect(text("units")).toBe("#09-01:synced");
    });
    expect((await queue.listByOwner("ann"))[0]?.state).toBe("synced");
  });

  it("still saves and sends in a browser with no BroadcastChannel", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    try {
      mount();
      await waitFor(() => {
        expect(text("active")).toBe("on");
      });
      await userEvent.click(screen.getByRole("button", { name: "save" }));
      await waitFor(() => {
        expect(text("units")).toBe("#09-01:synced");
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never shows or sends another member's records on a shared phone (D-33-1)", async () => {
    const theirs = stored("ben", "#05-01");
    const { send } = mount(createMemoryQueue([theirs]));
    await waitFor(() => {
      expect(text("owner")).toBe("ann");
    });
    expect(text("units")).toBe("");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the queue when a session check fails for want of signal", async () => {
    const queue = createMemoryQueue([
      stored("ann", "#05-01", { state: "held", nextAttemptAt: null }),
    ]);
    const { view, open, send } = mount(queue);
    await waitFor(() => {
      expect(text("active")).toBe("on");
    });

    // Auth.js reads a failed refetch as signed out.
    as(undefined);
    view.rerender(
      <SyncProvider openQueue={open} send={send}>
        <Probe />
      </SyncProvider>,
    );
    expect(text("owner")).toBe("ann");
    expect(text("active")).toBe("on");
    await userEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:held,#09-01:synced");
    });
  });

  it("never sends a member's records under the next member's sign-in from another tab (D-33-1)", async () => {
    let online = false;
    const send = vi.fn((items: VisitSyncItem[]) =>
      Promise.resolve<SendOutcome>(online ? applied(items) : { kind: "network" }),
    );
    const queue = createMemoryQueue([stored("ann", "#05-01")]);
    const { view, open } = mount(queue, send);
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });

    // Ann signs out in another tab and Ben signs in there. This tab heard
    // only the sign-out, which reads like a failed refetch, and is focused
    // before Auth.js has fetched Ben.
    as(undefined);
    view.rerender(
      <SyncProvider openQueue={open} send={send}>
        <Probe />
      </SyncProvider>,
    );
    cookieFor("ben");
    online = true;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(text("active")).toBe("off");
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await queue.listByOwner("ann"))[0]?.state).toBe("queued");
  });

  it("sends nothing while the server cannot say who is signed in", async () => {
    fetchSignedIn.mockResolvedValue({ kind: "unknown" });
    const queue = createMemoryQueue([stored("ann", "#05-01")]);
    const { send } = mount(queue);
    await waitFor(() => {
      expect(fetchSignedIn).toHaveBeenCalled();
    });
    await act(() => Promise.resolve());
    expect(send).not.toHaveBeenCalled();
    expect(text("active")).toBe("on");
    expect(text("units")).toBe("#05-01:queued");
  });

  it("lets go of the member on a public page, such as after signing out", async () => {
    const { view, open, send } = mount();
    await waitFor(() => {
      expect(text("active")).toBe("on");
    });
    as(undefined);
    usePathname.mockReturnValue("/sign-in");
    view.rerender(
      <SyncProvider openQueue={open} send={send}>
        <Probe />
      </SyncProvider>,
    );
    expect(text("active")).toBe("off");

    // Back on an app page with nobody signed in: still nobody.
    usePathname.mockReturnValue("/blocks/b1");
    view.rerender(
      <SyncProvider openQueue={open} send={send}>
        <Probe />
      </SyncProvider>,
    );
    expect(text("owner")).toBe("none");
  });

  it("switches to the new member's records when someone else signs in", async () => {
    const queue = createMemoryQueue([
      stored("ann", "#05-01", { state: "held", nextAttemptAt: null }),
      stored("ben", "#06-01", { state: "held", nextAttemptAt: null }),
    ]);
    const { view, open } = mount(queue);
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:held");
    });

    as("ben");
    view.rerender(
      <SyncProvider openQueue={open}>
        <Probe />
      </SyncProvider>,
    );
    // Nothing of Ann's shows while Ben's queue is opening.
    expect(text("units")).toBe("");
    await waitFor(() => {
      expect(text("units")).toBe("#06-01:held");
    });
  });

  it.each([
    ["signal returns", () => window.dispatchEvent(new Event("online"))],
    ["the app is focused", () => window.dispatchEvent(new Event("focus"))],
    [
      "the app comes back into view",
      () => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        document.dispatchEvent(new Event("visibilitychange"));
      },
    ],
  ])("sends at once when %s", async (_, trigger) => {
    let online = false;
    const send = vi.fn((items: VisitSyncItem[]) =>
      Promise.resolve<SendOutcome>(online ? applied(items) : { kind: "network" }),
    );
    mount(createMemoryQueue([stored("ann", "#05-01")]), send);
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });

    online = true;
    act(trigger);
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:synced");
    });
  });

  it("ignores the page going out of view", async () => {
    const send = vi.fn(() => Promise.resolve<SendOutcome>({ kind: "network" }));
    mount(createMemoryQueue([stored("ann", "#05-01")]), send);
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(() => Promise.resolve());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries one record, or all, on a tap", async () => {
    const send = vi.fn((items: VisitSyncItem[]) => Promise.resolve(applied(items)));
    mount(
      createMemoryQueue([
        stored("ann", "#05-01", {
          state: "held",
          nextAttemptAt: null,
          lastError: { code: "conflict" },
        }),
      ]),
      send,
    );
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:held");
    });
    await userEvent.click(screen.getByRole("button", { name: "retry first" }));
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:synced");
    });

    await userEvent.click(screen.getByRole("button", { name: "retry all" }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-reads when another tab changes the queue", async () => {
    const queue = createMemoryQueue();
    mount(queue);
    await waitFor(() => {
      expect(text("active")).toBe("on");
    });
    await queue.put(stored("ann", "#05-01", { state: "held", nextAttemptAt: null }));

    const otherTab = new BroadcastChannel("door-to-door-sync");
    otherTab.postMessage("changed");
    otherTab.close();

    await waitFor(() => {
      expect(text("units")).toBe("#05-01:held");
    });
  });

  it("sends under the origin-wide lock where the browser has one", async () => {
    const request = vi.fn((_name: string, run: () => Promise<void>) => run());
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    mount(createMemoryQueue([stored("ann", "#05-01")]));
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:synced");
    });
    expect(request).toHaveBeenCalledWith("door-to-door-sync", expect.any(Function));
  });

  it("asks the browser to keep the queue, once", async () => {
    const persist = vi.fn(() => Promise.resolve(false));
    Object.defineProperty(navigator, "storage", { value: { persist }, configurable: true });
    mount();
    await waitFor(() => {
      expect(text("active")).toBe("on");
    });
    await userEvent.click(screen.getByRole("button", { name: "save" }));
    await userEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1);
    });
  });

  describe("closing the page", () => {
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it("warns while a record is still being sent", async () => {
      mount(
        createMemoryQueue([stored("ann", "#05-01")]),
        vi.fn(() => Promise.resolve<SendOutcome>({ kind: "network" })),
      );
      await waitFor(() => {
        expect(text("units")).toBe("#05-01:queued");
      });
      // The listener is added in an effect, after the render that shows it.
      await waitFor(() => {
        expect(leave()).toBe(true);
      });
    });

    it("does not stand in the way of a sign-out the member chose", async () => {
      mount(
        createMemoryQueue([stored("ann", "#05-01")]),
        vi.fn(() => Promise.resolve<SendOutcome>({ kind: "network" })),
      );
      await waitFor(() => {
        expect(leave()).toBe(true);
      });
      isLeavingOnPurpose.mockReturnValueOnce(true);
      expect(leave()).toBe(false);
    });

    it("does not warn for records only an admin or a tap can move, which stay on disk", async () => {
      mount(createMemoryQueue([stored("ann", "#05-01", { state: "held", nextAttemptAt: null })]));
      await waitFor(() => {
        expect(text("units")).toBe("#05-01:held");
      });
      expect(leave()).toBe(false);
    });

    it("stops warning once everything is sent", async () => {
      mount(createMemoryQueue([stored("ann", "#05-01")]));
      await waitFor(() => {
        expect(text("units")).toBe("#05-01:synced");
      });
      expect(leave()).toBe(false);
    });
  });

  it("stops listening when unmounted", async () => {
    const send = vi.fn(() => Promise.resolve<SendOutcome>({ kind: "network" }));
    const { view } = mount(createMemoryQueue([stored("ann", "#05-01")]), send);
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    window.dispatchEvent(new Event("online"));
    await act(() => Promise.resolve());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not start a queue that finished opening after the page moved on", async () => {
    let finish: (queue: ReturnType<typeof createMemoryQueue>) => void = () => undefined;
    const send = vi.fn();
    const view = render(
      <SyncProvider openQueue={() => new Promise((resolve) => (finish = resolve))} send={send}>
        <Probe />
      </SyncProvider>,
    );
    view.unmount();
    finish(createMemoryQueue([stored("ann", "#05-01")]));
    await act(() => Promise.resolve());
    expect(send).not.toHaveBeenCalled();
  });
});

describe("SyncProvider over a damaged store (#34)", () => {
  it("keeps the page up when the queue cannot be read at all", async () => {
    const queue = createMemoryQueue([stored("ann", "#05-01")]);
    const gone = () => Promise.reject(new DOMException("closed", "InvalidStateError"));
    queue.listByOwner = gone;
    queue.listAll = gone;
    queue.get = gone;
    queue.deleteSyncedBefore = gone;
    const { send } = mount(queue);

    await waitFor(() => {
      expect(text("active")).toBe("on");
    });
    await act(() => Promise.resolve());
    expect(text("units")).toBe("");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a record with damaged bookkeeping, and shows an unreadable one with nothing to press", async () => {
    const user = userEvent.setup();
    const salvaged = stored("ann", "#05-01");
    const unreadable = stored("ann", "#05-02");
    const queue = createMemoryQueue([
      { ...salvaged, state: "sending", attempts: -1 },
      { ...unreadable, item: { ...unreadable.item, interestLevel: "keen" } },
    ]);
    const send = vi.fn((items: VisitSyncItem[]) => Promise.resolve(applied(items)));
    render(
      <SyncProvider openQueue={() => Promise.resolve(queue)} send={send}>
        <SyncStatusBar />
      </SyncProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /1 not sent/ }));
    const sheet = await screen.findByRole("dialog", { name: "Records not sent" });
    expect(sheet).toHaveTextContent("This record could not be read on this phone.");
    expect(within(sheet).queryByRole("button", { name: /^Retry #/ })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Retry all" })).toBeDisabled();

    // Only the salvaged one went out, and nothing was deleted.
    expect(send.mock.calls.flatMap(([items]) => items.map((item) => item.id))).toEqual([
      salvaged.id,
    ]);
    expect([...queue.raw.keys()].sort()).toEqual([salvaged.id, unreadable.id].sort());
  });
});

describe("SyncProvider on the offline shell (#77)", () => {
  it("runs no queue until someone continues, whoever the session names", async () => {
    // The fallback's address is not /offline, and the session may be anyone's.
    act(() => {
      shellState.enter();
    });
    const { send, view } = mount(createMemoryQueue([stored("ann", "#05-01")]));
    await act(() => Promise.resolve());
    expect(text("active")).toBe("off");
    expect(text("owner")).toBe("none");
    expect(send).not.toHaveBeenCalled();
    view.unmount();
  });

  it("runs the queue of the member who continued, even on /offline with nobody signed in", async () => {
    usePathname.mockReturnValue("/offline");
    as(undefined);
    cookieFor("ben");
    act(() => {
      shellState.enter();
    });
    mount(createMemoryQueue([stored("ben", "#05-01"), stored("ann", "#06-01")]));

    act(() => {
      shellState.continueAs("ben");
    });
    await waitFor(() => {
      expect(text("owner")).toBe("ben");
    });
    // Only Ben's records, and sent because the cookie is his.
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:synced");
    });
  });

  it("sends when signal returns, with no reload", async () => {
    as(undefined);
    let online = false;
    const send = vi.fn((items: VisitSyncItem[]) =>
      Promise.resolve<SendOutcome>(online ? applied(items) : { kind: "network" }),
    );
    act(() => {
      shellState.continueAs("ann");
    });
    mount(createMemoryQueue([stored("ann", "#05-01")]), send);
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(text("units")).toBe("#05-01:queued");

    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => {
      expect(text("units")).toBe("#05-01:synced");
    });
  });
});
