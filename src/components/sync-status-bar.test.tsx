import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatusBar } from "@/components/sync-status-bar";
import type { SyncQueueValue } from "@/components/sync-provider";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";

const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync-provider", () => ({ useSyncQueue }));

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
      sessionId: null,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SyncStatusBar", () => {
  it("is not there when everything is sent", () => {
    useSyncQueue.mockReturnValue(queue({ records: [record("#05-01", { state: "synced" })] }));
    render(<SyncStatusBar />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not flash while a record just saved is on its first send", () => {
    const fresh = record("#05-01");
    useSyncQueue.mockReturnValue(queue({ records: [fresh], justSaved: new Set([fresh.id]) }));
    render(<SyncStatusBar />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts what is waiting and stays above the page, below every sheet", () => {
    useSyncQueue.mockReturnValue(queue({ records: [record("#05-01"), record("#05-02")] }));
    render(<SyncStatusBar />);
    const bar = screen.getByRole("button", { name: /2 waiting to send/ });
    expect(bar).toHaveClass("sticky", "z-20");
    // Not a live status: the form's "Saved" line owns that role.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens the list of unsent records, and closes it again", async () => {
    const user = userEvent.setup();
    useSyncQueue.mockReturnValue(queue({ records: [record("#05-01")] }));
    render(<SyncStatusBar />);

    await user.click(screen.getByRole("button", { name: /1 waiting to send/ }));
    const sheet = screen.getByRole("dialog", { name: "Records not sent" });
    expect(within(sheet).getByText("#05-01")).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
