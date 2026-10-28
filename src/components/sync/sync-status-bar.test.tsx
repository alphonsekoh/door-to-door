import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatusBar } from "@/components/sync/sync-status-bar";
import type { SyncQueueValue } from "@/components/sync/sync-provider";
import { shellState } from "@/lib/offline/shell-state";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";

const { useSyncQueue, usePathname, useSelectedLayoutSegment } = vi.hoisted(() => ({
  useSyncQueue: vi.fn(),
  usePathname: vi.fn<() => string>(),
  useSelectedLayoutSegment: vi.fn<() => string | null>(),
}));
vi.mock("@/components/sync/sync-provider", () => ({ useSyncQueue }));
vi.mock("next/navigation", () => ({ usePathname, useSelectedLayoutSegment }));

const record = (unitNumber: string, overrides: Partial<QueuedVisit> = {}): QueuedVisit => ({
  ...buildQueuedVisit(
    {
      blockId: "0190a000-0000-7000-8000-0000000000bb",
      unitNumber,
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
  ...overrides,
});

function queue(overrides: Partial<SyncQueueValue> = {}): SyncQueueValue {
  return {
    records: [],
    inFlight: new Set(),
    justSaved: new Set(),
    block: null,
    syncedVersion: 0,
    ownerId: "ann",
    enqueue: null,
    retry: vi.fn(),
    retryAll: vi.fn(),
    ...overrides,
  };
}

const running = (overrides: Partial<SyncQueueValue> = {}) =>
  queue({ enqueue: vi.fn(), ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  usePathname.mockReturnValue("/blocks/b1");
  useSelectedLayoutSegment.mockReturnValue("blocks");
});

describe("SyncStatusBar", () => {
  it("holds an empty row before the queue has opened, so its arrival moves nothing", () => {
    useSyncQueue.mockReturnValue(queue({ records: [record("#05-01")], enqueue: null }));
    render(<SyncStatusBar />);
    expect(screen.queryByRole("button")).toBeNull();
    const row = screen.getByRole("paragraph");
    expect(row).toBeEmptyDOMElement();
    // The bar's own box, at the 16px base whatever the text size.
    expect(row).toHaveClass("chrome-size", "min-h-11", "mb-3");
    expect(row).not.toHaveClass("sync-pinned");
  });

  it("is not on a public page, where nobody is signed in", () => {
    usePathname.mockReturnValue("/sign-in");
    useSyncQueue.mockReturnValue(running({ records: [record("#05-01")] }));
    const { container } = render(<SyncStatusBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("holds its row, one line high, when everything is sent, and lets it scroll away", () => {
    useSyncQueue.mockReturnValue(running({ records: [record("#05-01", { state: "synced" })] }));
    render(<SyncStatusBar />);
    expect(screen.queryByRole("button")).toBeNull();
    // Same row as the button it turns into, so nothing below it moves.
    const row = screen.getByText("All visits sent").parentElement;
    expect(row).toHaveClass("chrome-size", "min-h-11", "mb-3");
    // Good news is not pinned: at large text it would take the form's room.
    expect(row).not.toHaveClass("sync-pinned");
  });

  it("does not flash while a record just saved is on its first send", () => {
    const fresh = record("#05-01");
    useSyncQueue.mockReturnValue(running({ records: [fresh], justSaved: new Set([fresh.id]) }));
    render(<SyncStatusBar />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  it("counts what is waiting and stays above the page, below every sheet", () => {
    useSyncQueue.mockReturnValue(running({ records: [record("#05-01"), record("#05-02")] }));
    render(<SyncStatusBar />);
    const bar = screen.getByRole("button", { name: /2 waiting to send/ });
    // Pinned, in the same box as the row held for it.
    expect(bar).toHaveClass("sync-pinned", "chrome-size", "min-h-11", "mb-3");
    // Separated by a fade once content scrolls under it, not a hard rule.
    expect(bar).toHaveClass("scroll-edge");
    expect(bar).not.toHaveClass("border-b");
    // Not a live status: the form's "Saved" line owns that role.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens the list of unsent records, and closes it again", async () => {
    const user = userEvent.setup();
    useSyncQueue.mockReturnValue(running({ records: [record("#05-01")] }));
    render(<SyncStatusBar />);

    await user.click(screen.getByRole("button", { name: /1 waiting to send/ }));
    // Titled as the bar was: waiting, not "not sent", until something is stuck.
    const sheet = await screen.findByRole("dialog", { name: "Waiting to send" });
    expect(within(sheet).getByText("#05-01")).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // And again: the sheet stays loaded once it has been.
    await user.click(screen.getByRole("button", { name: /1 waiting to send/ }));
    expect(screen.getByRole("dialog", { name: "Waiting to send" })).toBeInTheDocument();
  });
});

describe("SyncStatusBar on the offline shell (#77)", () => {
  afterEach(() => {
    shellState.leave();
  });

  it("shows once someone is recording, even at /offline", () => {
    usePathname.mockReturnValue("/offline");
    useSyncQueue.mockReturnValue(running({ records: [record("#05-01")] }));
    shellState.continueAs("ann");
    render(<SyncStatusBar />);
    expect(screen.getByRole("button", { name: /1 waiting to send/ })).toBeInTheDocument();
  });

  /* The worker serves the prerendered /offline page at the address that
     failed: the server rendered /offline, the browser reads /blocks/b1. */
  it("hydrates the offline page served at another address as the server drew it", async () => {
    useSelectedLayoutSegment.mockReturnValue("offline");
    useSyncQueue.mockReturnValue(running());
    usePathname.mockReturnValue("/offline");
    const container = document.createElement("div");
    container.innerHTML = renderToString(<SyncStatusBar />);
    document.body.append(container);

    usePathname.mockReturnValue("/blocks/b1");
    const mismatches: unknown[] = [];
    const root = await act(() =>
      hydrateRoot(container, <SyncStatusBar />, {
        onRecoverableError: (error) => mismatches.push(error),
      }),
    );
    const drawn = container.innerHTML;
    act(() => {
      root.unmount();
    });
    container.remove();
    expect(mismatches).toEqual([]);
    expect(drawn).toBe("");
  });

  it("is not there before anyone continues, wherever the address is", () => {
    usePathname.mockReturnValue("/blocks/b1");
    useSyncQueue.mockReturnValue(running());
    shellState.enter();
    const { container } = render(<SyncStatusBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
