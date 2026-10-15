import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncQueueSheet } from "@/components/sync-queue-sheet";
import type { SyncQueueValue } from "@/components/sync-provider";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import type { QueuedVisit } from "@/lib/sync/types";

const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync-provider", () => ({ useSyncQueue }));

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
        sessionId: null,
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
  return { sheet: screen.getByRole("dialog", { name: "Records not sent" }), onClose };
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
