import { describe, expect, it } from "vitest";
import { buildQueuedVisit } from "@/lib/sync/enqueue";
import {
  barSummary,
  blockReason,
  deleteNote,
  isSending,
  quietText,
  recordReason,
  savedOnPhoneText,
  stateLabel,
  queueTitle,
} from "@/lib/sync/sync-ui";
import type { QueuedVisit } from "@/lib/sync/types";

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

function record(overrides: Partial<QueuedVisit> = {}): QueuedVisit {
  return {
    ...buildQueuedVisit(
      {
        blockId: "0190a000-0000-7000-8000-0000000000bb",
        unitNumber: "#05-01",
        interestLevel: "high",
        description: "",
        name: "",
        contact: "",
        religion: "",
        sessionId: "0190a000-0000-7000-8000-0000000000cc",
      },
      "ann",
      NOW,
    ),
    ...overrides,
  };
}

const none = new Set<string>();

describe("stateLabel", () => {
  it.each([
    ["queued", "Waiting to send"],
    ["failed", "Will retry"],
    ["held", "Held"],
    ["quarantined", "Stopped"],
    ["synced", "Sent"],
  ] as const)("names %s", (state, label) => {
    expect(stateLabel(record({ state }), none)).toBe(label);
  });

  it("says sending while the request is out", () => {
    const r = record();
    expect(stateLabel(r, new Set([r.id]))).toBe("Sending…");
  });
});

describe("recordReason", () => {
  it("explains each stuck state in fixed words", () => {
    expect(
      recordReason(record({ state: "quarantined", lastError: { code: "internal_error" } })),
    ).toBe("Could not send after several tries.");
    expect(recordReason(record({ state: "held", lastError: { code: "session_not_active" } }))).toBe(
      "The session has ended. Sends if an admin reopens it.",
    );
    expect(
      recordReason(record({ state: "held", lastError: { code: "not_on_follow_up_list" } })),
    ).toBe("Not on this session's list. Sends once an admin adds this unit.");
    for (const code of ["conflict", "not_found", "unknown"]) {
      expect(recordReason(record({ state: "held", lastError: { code } }))).toBe(
        "The server would not accept this record. Ask an admin.",
      );
    }
    expect(recordReason(record({ state: "quarantined", lastError: { code: "corrupt" } }))).toBe(
      "This record could not be read on this phone.",
    );
  });

  it("blames the clock only once restamping has not helped", () => {
    const skewed = (skewCount: number) =>
      record({ state: "queued", skewCount, lastError: { code: "clock_skew" } });
    expect(recordReason(skewed(1))).toBeNull();
    expect(recordReason(skewed(2))).toBe(
      "Your phone's date or time is wrong. Fix it, then tap Retry.",
    );
  });

  it("says nothing more for a record that is simply waiting or sent", () => {
    expect(recordReason(record())).toBeNull();
    expect(
      recordReason(record({ state: "failed", lastError: { code: "internal_error" } })),
    ).toBeNull();
    expect(recordReason(record({ state: "synced" }))).toBeNull();
  });
});

describe("blockReason", () => {
  it.each([
    ["offline", "No signal. Sends when you're back online."],
    ["clock", "Your phone's date or time is wrong. Fix it, then tap Retry."],
    ["server", "The server is busy. Trying again shortly."],
    ["rate_limited", "The server is busy. Trying again shortly."],
    ["signed_out", "Signed out. Sends when you sign in again."],
    ["deactivated", "This account is deactivated. Records wait here until an admin restores it."],
  ] as const)("explains %s", (reason, text) => {
    expect(blockReason({ reason, until: null })).toBe(text);
  });

  it("says nothing when the queue is free to send", () => {
    expect(blockReason(null)).toBeNull();
  });
});

describe("barSummary", () => {
  it("is hidden with nothing unsent", () => {
    expect(barSummary([], none)).toBeNull();
    expect(barSummary([record({ state: "synced" })], none)).toBeNull();
  });

  it("is hidden while a record just saved has its first go", () => {
    const fresh = record();
    expect(barSummary([fresh], new Set([fresh.id]))).toBeNull();
  });

  it("counts what is waiting", () => {
    expect(barSummary([record({ id: "a" }), record({ id: "b", state: "failed" })], none)).toEqual({
      count: 2,
      text: "2 waiting to send",
    });
  });

  it("says not sent once something needs a tap", () => {
    expect(barSummary([record(), record({ id: "b", state: "held" })], none)?.text).toBe(
      "2 not sent",
    );
    expect(barSummary([record({ state: "quarantined" })], none)?.text).toBe("1 not sent");
  });
});

describe("queueTitle", () => {
  it("says waiting while records are only waiting, as the bar does", () => {
    expect(queueTitle([record({ state: "queued" }), record({ state: "failed" })])).toBe(
      "Waiting to send",
    );
  });

  it("says not sent once a record is held or stopped", () => {
    expect(queueTitle([record({ state: "queued" }), record({ state: "held" })])).toBe(
      "Records not sent",
    );
    expect(queueTitle([record({ state: "quarantined" })])).toBe("Records not sent");
  });
});

describe("quietText", () => {
  it("says everything is sent when it is, or when nothing was ever saved", () => {
    expect(quietText([], none)).toBe("All visits sent");
    const sent = record({ state: "synced" });
    expect(quietText([sent], new Set([sent.id]))).toBe("All visits sent");
  });

  it("does not claim a record just saved has gone while its first send is out", () => {
    const fresh = record();
    expect(quietText([fresh], new Set([fresh.id]))).toBe("Sending…");
  });
});

describe("isSending", () => {
  it("is true only for records the queue is still trying to send", () => {
    expect(isSending(record())).toBe(true);
    expect(isSending(record({ state: "failed" }))).toBe(true);
    expect(isSending(record({ state: "held" }))).toBe(false);
    expect(isSending(record({ state: "quarantined" }))).toBe(false);
    expect(isSending(record({ state: "synced" }))).toBe(false);
  });
});

describe("savedOnPhoneText", () => {
  it("counts every record not yet sent, stuck ones included", () => {
    expect(
      savedOnPhoneText([
        record({ id: "a" }),
        record({ id: "b", state: "held" }),
        record({ id: "c", state: "synced" }),
      ]),
    ).toBe("2 records are saved on this phone.");
  });

  it("says one in the singular, and nothing when all are sent", () => {
    expect(savedOnPhoneText([record()])).toBe("1 record is saved on this phone.");
    expect(savedOnPhoneText([record({ state: "synced" })])).toBe(
      "Nothing is waiting to send on this phone.",
    );
  });
});

describe("a record not kept because its unit was erased (#279)", () => {
  const stub = (overrides: Partial<QueuedVisit> = {}) =>
    record({
      state: "synced",
      syncedAt: NOW,
      lastError: { code: "household_erased" },
      ...overrides,
    });

  it("is labelled, and explained", () => {
    expect(stateLabel(stub(), none)).toBe("Not kept");
    expect(recordReason(stub())).toBe(
      "This unit's records were erased after you saved this, so it was not kept.",
    );
    // A record that was sent is still just sent.
    expect(stateLabel(record({ state: "synced", syncedAt: NOW }), none)).toBe("Sent");
  });

  it("is what the bar says when nothing is unsent", () => {
    expect(barSummary([stub(), stub({ id: "b" })], none)).toEqual({ count: 2, text: "2 not kept" });
    expect(barSummary([stub()], none)).toEqual({ count: 1, text: "1 not kept" });
  });

  it("leaves the bar to the unsent ones, when there are some", () => {
    expect(barSummary([stub(), record({ id: "q" })], none)).toEqual({
      count: 1,
      text: "1 waiting to send",
    });
  });

  it("waits for the first send to be over, as a saved record does", () => {
    const saved = stub();
    expect(barSummary([saved], new Set([saved.id]))).toBeNull();
  });

  it("titles the sheet by what it lists", () => {
    expect(queueTitle([stub()])).toBe("Records not kept");
    expect(queueTitle([stub(), record({ state: "held" })])).toBe("Records not sent");
    expect(queueTitle([stub(), record()])).toBe("Waiting to send");
    expect(queueTitle([])).toBe("Waiting to send");
  });
});

describe("deleteNote", () => {
  const day = (iso: string) => Date.parse(iso);

  it("tells a held or stopped record the day it goes, 30 days after it was saved", () => {
    const saved = day("2026-10-15T10:00:00.000Z");
    expect(deleteNote(record({ state: "held", enqueuedAt: saved }))).toBe(
      "Deleted from this phone on 14 Nov 2026 if not sent.",
    );
    expect(deleteNote(record({ state: "quarantined", enqueuedAt: saved }))).toBe(
      "Deleted from this phone on 14 Nov 2026 if not sent.",
    );
  });

  it("says it goes at the next start when its saved time cannot be read", () => {
    expect(deleteNote(record({ state: "quarantined", enqueuedAt: 0 }))).toBe(
      "Deleted from this phone the next time the app opens.",
    );
  });

  it("says nothing of a record that is still retrying, or sent", () => {
    for (const state of ["queued", "failed", "synced"] as const) {
      expect(deleteNote(record({ state }))).toBeNull();
    }
  });
});
