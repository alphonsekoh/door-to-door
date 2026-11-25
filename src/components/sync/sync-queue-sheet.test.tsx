import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncQueueSheet } from "@/components/sync/sync-queue-sheet";
import type { SyncQueueValue } from "@/components/sync/sync-provider";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";

const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync/sync-provider", () => ({ useSyncQueue }));

let clock = Date.parse("2026-10-15T10:00:00.000Z");
const record = (unitNumber: string, overrides: Partial<QueuedVisit> = {}): QueuedVisit => {
  clock += 1;
  return {
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
      clock,
    ),
    ...overrides,
  };
};

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

const open = (value: SyncQueueValue, onClose = vi.fn()) => {
  useSyncQueue.mockReturnValue(value);
  render(
    <>
      <button type="button">behind</button>
      <SyncQueueSheet onClose={onClose} />
    </>,
  );
  return {
    sheet: screen.getByRole("dialog", {
      name: /^(Waiting to send|Records not sent|Records not kept)$/,
    }),
    onClose,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SyncQueueSheet", () => {
  it("is a modal: focus moves in, the page behind is inert, Escape closes", async () => {
    const { sheet, onClose } = open(queue({ records: [record("#05-01")] }));
    expect(sheet).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "behind", hidden: true }).closest("[inert]"),
    ).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("lists each unsent record with its state and the reason in fixed words", () => {
    const { sheet } = open(
      queue({
        records: [
          record("#05-01"),
          record("#05-02", { state: "held", nextAttemptAt: null, lastError: { code: "conflict" } }),
          record("#05-03", {
            state: "quarantined",
            nextAttemptAt: null,
            lastError: { code: "internal_error" },
          }),
          record("#05-04", { state: "synced" }),
        ],
      }),
    );
    const rows = within(sheet).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Waiting to send");
    expect(rows[1]).toHaveTextContent("Held");
    expect(rows[1]).toHaveTextContent("The server would not accept this record. Ask an admin.");
    expect(rows[2]).toHaveTextContent("Stopped");
    expect(rows[2]).toHaveTextContent("Could not send after several tries.");
    expect(sheet).toHaveTextContent(
      "Records not sent are on this phone only. Teammates see them once they are sent.",
    );
  });

  it("never shows the server's own words", () => {
    const { sheet } = open(
      queue({
        records: [
          record("#05-01", {
            state: "held",
            nextAttemptAt: null,
            lastError: { code: "made up by a server" },
          }),
        ],
      }),
    );
    expect(sheet).not.toHaveTextContent("made up by a server");
  });

  it("says why nothing is going out", () => {
    const { sheet } = open(
      queue({ records: [record("#05-01")], block: { reason: "offline", until: null } }),
    );
    expect(sheet).toHaveTextContent("No signal. Sends when you're back online.");
    // Not the loud action when it cannot succeed, but still there: one bar
    // can read as none.
    const retryAll = within(sheet).getByRole("button", { name: "Retry all" });
    expect(retryAll).toBeEnabled();
    expect(retryAll).toHaveClass("btn-secondary");
    expect(retryAll).not.toHaveClass("btn-primary");
  });

  it("makes Retry all the main action again with signal", () => {
    const { sheet } = open(queue({ records: [record("#05-01")] }));
    expect(within(sheet).getByRole("button", { name: "Retry all" })).toHaveClass("btn-primary");
  });

  it("is titled as the bar is: waiting, until a record is stuck", () => {
    const { sheet } = open(queue({ records: [record("#05-01")] }));
    expect(sheet).toHaveAccessibleName("Waiting to send");
    cleanup();
    const { sheet: stuck } = open(
      queue({ records: [record("#05-01", { state: "held", nextAttemptAt: null })] }),
    );
    expect(stuck).toHaveAccessibleName("Records not sent");
  });

  it("retries one record, or all of them", async () => {
    const user = userEvent.setup();
    const value = queue({
      records: [record("#05-01"), record("#05-02", { state: "held", nextAttemptAt: null })],
    });
    const { sheet } = open(value);
    await user.click(within(sheet).getByRole("button", { name: "Retry #05-02" }));
    expect(value.retry).toHaveBeenCalledWith(value.records[1]?.id);

    await user.click(within(sheet).getByRole("button", { name: "Retry all" }));
    expect(value.retryAll).toHaveBeenCalled();
  });

  it("offers no retry for a record already on its way", () => {
    const sending = record("#05-01");
    const { sheet } = open(queue({ records: [sending], inFlight: new Set([sending.id]) }));
    expect(within(sheet).getByRole("listitem")).toHaveTextContent("Sending…");
    expect(within(sheet).queryByRole("button", { name: "Retry #05-01" })).toBeNull();
  });

  it("shows a record it could not read, with nothing to press", () => {
    const { sheet } = open(
      queue({
        records: [
          record("", { state: "quarantined", nextAttemptAt: null, lastError: { code: "corrupt" } }),
        ],
      }),
    );
    expect(sheet).toHaveTextContent("Unreadable record");
    expect(sheet).toHaveTextContent("This record could not be read on this phone.");
    expect(within(sheet).getByRole("button", { name: "Retry all" })).toBeDisabled();
  });

  it("has no way to discard anything (D-33-2)", () => {
    const { sheet } = open(
      queue({
        records: [
          record("#05-01", {
            state: "quarantined",
            nextAttemptAt: null,
            lastError: { code: "invalid" },
          }),
        ],
      }),
    );
    const labels = within(sheet)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels.join(" ")).not.toMatch(/discard|delete|remove|clear/i);
  });

  it("says so when everything has gone", () => {
    const { sheet } = open(queue({ records: [record("#05-01", { state: "synced" })] }));
    expect(sheet).toHaveTextContent("Everything has been sent.");
    expect(within(sheet).getByRole("button", { name: "Retry all" })).toBeDisabled();
  });

  it("closes from its backdrop", async () => {
    const { onClose } = open(queue());
    const [backdrop] = screen.getAllByRole("button", { name: "Close" });
    if (backdrop === undefined) throw new Error("no backdrop");
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("a record not kept, and the day a stuck one goes (#279)", () => {
  const stub = () =>
    record("#05-09", {
      state: "synced",
      syncedAt: clock,
      lastError: { code: "household_erased" },
    });

  it("lists the stub with why it was not kept, and offers no retry for it", () => {
    const { sheet } = open(queue({ records: [stub()] }));
    expect(sheet).toHaveAccessibleName("Records not kept");
    const row = within(sheet).getByText("#05-09").closest("li");
    expect(row).toHaveTextContent("Not kept");
    expect(row).toHaveTextContent(
      "This unit's records were erased after you saved this, so it was not kept.",
    );
    expect(within(row as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Retry all" })).toBeDisabled();
  });

  it("leaves a sent record out, as before", () => {
    const { sheet } = open(
      queue({ records: [stub(), record("#05-10", { state: "synced", syncedAt: clock })] }),
    );
    expect(within(sheet).queryByText("#05-10")).toBeNull();
  });

  it("tells a held record the day it will be deleted from the phone", () => {
    const saved = Date.parse("2026-10-15T10:00:00.000Z");
    const { sheet } = open(
      queue({
        records: [
          record("#05-11", {
            state: "held",
            enqueuedAt: saved,
            lastError: { code: "conflict" },
            nextAttemptAt: null,
          }),
        ],
      }),
    );
    expect(sheet).toHaveTextContent("Deleted from this phone on 14 Nov 2026 if not sent.");
  });

  it("tells a record that is still retrying too, since the purge deletes it as well", () => {
    const { sheet } = open(queue({ records: [record("#05-12")] }));
    expect(sheet).toHaveTextContent("Deleted from this phone on");
  });
});
