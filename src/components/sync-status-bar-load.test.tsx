import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatusBar } from "@/components/sync-status-bar";
import type { SyncQueueValue } from "@/components/sync-provider";
import type { SyncQueueView } from "@/components/sync-queue-loader";
import { buildQueuedVisit } from "@/lib/sync/enqueue";

/*
 * The sheet behind the bar is a chunk of its own, so fetching it can fail:
 * no signal, and no service worker in charge of the page to serve it.
 */

const { useSyncQueue, usePathname, loadSyncQueue, idle } = vi.hoisted(() => ({
  useSyncQueue: vi.fn(),
  usePathname: vi.fn<() => string>(),
  loadSyncQueue: vi.fn<() => Promise<SyncQueueView>>(),
  idle: { tasks: [] as (() => void)[] },
}));
vi.mock("@/components/sync-provider", () => ({ useSyncQueue }));
vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("@/components/sync-queue-loader", () => ({ loadSyncQueue }));
vi.mock("@/lib/when-idle", () => ({
  whenIdle: (task: () => void) => {
    idle.tasks.push(task);
    return () => {
      idle.tasks = idle.tasks.filter((queued) => queued !== task);
    };
  },
}));

const Sheet: SyncQueueView = ({ open, onClose }) =>
  open ? (
    <div role="dialog" aria-label="Waiting to send">
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ) : null;

let signal = true;

/* Runs what was waiting for an idle moment, and lets the fetch it starts
   settle. */
async function runIdle(): Promise<void> {
  await act(async () => {
    for (const task of idle.tasks.splice(0)) task();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  idle.tasks = [];
  signal = true;
  usePathname.mockReturnValue("/blocks/b1");
  loadSyncQueue.mockImplementation(() =>
    signal ? Promise.resolve(Sheet) : Promise.reject(new TypeError("Failed to fetch")),
  );
  useSyncQueue.mockReturnValue({
    records: [
      buildQueuedVisit(
        {
          blockId: "0190a000-0000-7000-8000-0000000000bb",
          unitNumber: "#05-01",
          interestLevel: "medium",
          description: "",
          name: "",
          contact: "",
          religion: "",
          sessionId: "0190a000-0000-7000-8000-0000000000cc",
        },
        "ann",
        Date.parse("2026-10-15T10:00:00.000Z"),
      ),
    ],
    inFlight: new Set(),
    justSaved: new Set(),
    block: null,
    syncedVersion: 0,
    ownerId: "ann",
    enqueue: vi.fn(),
    retry: vi.fn(),
    retryAll: vi.fn(),
  } satisfies SyncQueueValue);
});

describe("SyncStatusBar, loading its sheet", () => {
  it("fetches the sheet once the page is idle, so a tap with no signal still opens it", async () => {
    const user = userEvent.setup();
    render(<SyncStatusBar />);
    expect(loadSyncQueue).not.toHaveBeenCalled();
    await runIdle();
    expect(loadSyncQueue).toHaveBeenCalledOnce();

    signal = false;
    await user.click(screen.getByRole("button", { name: /1 waiting to send/ }));
    expect(await screen.findByRole("dialog", { name: "Waiting to send" })).toBeInTheDocument();
    expect(loadSyncQueue).toHaveBeenCalledOnce();
  });

  it("keeps the bar when the sheet cannot be fetched, and opens it on a later tap", async () => {
    const user = userEvent.setup();
    signal = false;
    render(<SyncStatusBar />);
    await runIdle();
    const bar = screen.getByRole("button", { name: /1 waiting to send/ });

    await user.click(bar);
    // Nothing opened, and the bar says so rather than doing nothing.
    await waitFor(() => {
      expect(bar).toHaveTextContent("Try again");
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    signal = true;
    await user.click(bar);
    expect(await screen.findByRole("dialog", { name: "Waiting to send" })).toBeInTheDocument();
    expect(bar).toHaveTextContent("View");
    expect(loadSyncQueue).toHaveBeenCalledTimes(3);
  });

  it("tries again when signal comes back", async () => {
    signal = false;
    render(<SyncStatusBar />);
    await runIdle();
    expect(loadSyncQueue).toHaveBeenCalledOnce();

    signal = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(loadSyncQueue).toHaveBeenCalledTimes(2);
    // Loaded now, so it no longer listens.
    window.dispatchEvent(new Event("online"));
    expect(loadSyncQueue).toHaveBeenCalledTimes(2);
  });

  it("fetches nothing on a public page, where the bar is not shown", () => {
    usePathname.mockReturnValue("/sign-in");
    render(<SyncStatusBar />);
    expect(idle.tasks).toEqual([]);
    window.dispatchEvent(new Event("online"));
    expect(loadSyncQueue).not.toHaveBeenCalled();
  });
});
