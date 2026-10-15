import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProvider, useSyncQueue } from "@/components/sync-provider";
import type { VisitSyncItem } from "@/generated/types.gen";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import { createMemoryQueue } from "@/lib/sync/memory-queue";
import type { QueuedVisit, SendOutcome } from "@/lib/sync/types";

const { usePathname, useRole } = vi.hoisted(() => ({
  usePathname: vi.fn<() => string>(),
  useRole: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("@/lib/use-role", () => ({ useRole }));

const as = (userId: string | undefined) => useRole.mockReturnValue({ userId });

const draft = (unitNumber: string) => ({
  blockId: "0190a000-0000-7000-8000-0000000000bb",
  unitNumber,
  interestLevel: "high" as const,
  description: "",
  name: "",
  contact: "",
  religion: "" as const,
  sessionId: null,
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
});

afterEach(() => {
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

  it("never shows or sends another member's records on a shared phone (D-33-1)", async () => {
    const theirs = stored("ben", "#05-01");
    const { send } = mount(createMemoryQueue([theirs]));
    await waitFor(() => {
      expect(text("owner")).toBe("ann");
    });
    expect(text("units")).toBe("");
    expect(send).not.toHaveBeenCalled();
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
