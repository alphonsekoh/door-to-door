import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisitEntry } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { ApiRequestError } from "@/lib/api-client";
import { UNDO_READY, markedDoneLine, owedAt, undoMarkedDone } from "@/lib/follow-ups/marked-done";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const STAMP = "2026-10-20T18:00:00.000Z";

function entry(blockId: string, unitNumber: string, done: boolean[]): RevisitEntry {
  const householdId = `${blockId}-${unitNumber}`;
  return {
    household: {
      id: householdId,
      blockId,
      unitNumber,
      name: null,
      contact: null,
      religion: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    block: { id: blockId, name: blockId, street: "Ave 3", postalCode: null, createdAt: STAMP },
    notes: done.map((resolved, i) => ({
      id: `${householdId}-${String(i)}`,
      householdId,
      blockId,
      blockName: blockId,
      unitNumber,
      visitId: null,
      status: "listed",
      author: { id: "admin", name: "Admin", image: null },
      note: "Go back",
      dueDate: null,
      doneAt: resolved ? STAMP : null,
      doneBy: null,
      listedAt: STAMP,
      listedBy: null,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      waitingSuggestionBy: null,
      createdAt: STAMP,
    })),
    latestVisit: null,
    visitedInSession: false,
  };
}

const refusal = (status: number, message: string) =>
  new ApiRequestError(status, { error: { code: "follow_up_exists", message } });

describe("owedAt", () => {
  const list = [entry("b1", "#05-123", [false, true, false]), entry("b2", "#05-123", [false])];

  it("counts the notes the unit still owes on the list, in its own block", () => {
    expect(owedAt(list, "b1", "#05-123")).toBe(2);
    expect(owedAt(list, "b2", "#05-123")).toBe(1);
  });

  it("matches the unit as the form normalises it", () => {
    expect(owedAt(list, "b1", " 05-123 ")).toBe(2);
  });

  it("is none for a unit off the list, or a list not read", () => {
    expect(owedAt(list, "b1", "#09-999")).toBe(0);
    expect(owedAt(null, "b1", "#05-123")).toBe(0);
    expect(owedAt(undefined, "b1", "#05-123")).toBe(0);
  });
});

describe("markedDoneLine", () => {
  it("says the follow-up will be marked done once a queued visit is sent", () => {
    expect(markedDoneLine(1, null, UNDO_READY)).toEqual({
      text: "Follow-up marked done once sent.",
      undo: null,
    });
    expect(markedDoneLine(2, null, UNDO_READY)?.text).toBe("2 follow-ups marked done once sent.");
  });

  it("says nothing before sending where nothing was owed", () => {
    expect(markedDoneLine(0, null, UNDO_READY)).toBeNull();
  });

  it("offers to undo exactly what the server marked", () => {
    expect(markedDoneLine(1, ["f1"], UNDO_READY)).toEqual({
      text: "Follow-up marked done.",
      undo: ["f1"],
    });
    expect(markedDoneLine(1, ["f1", "f2"], { kind: "undoing" })).toEqual({
      text: "2 follow-ups marked done.",
      undo: ["f1", "f2"],
    });
  });

  it("says nothing once sent if the server marked nothing", () => {
    expect(markedDoneLine(1, [], UNDO_READY)).toBeNull();
  });

  it("says what was reopened, and offers nothing more", () => {
    expect(markedDoneLine(1, ["f1"], { kind: "undone", count: 1 })).toEqual({
      text: "Undone. Follow-up reopened.",
      undo: null,
    });
    expect(markedDoneLine(2, ["f1", "f2"], { kind: "undone", count: 2 })?.text).toBe(
      "Undone. 2 follow-ups reopened.",
    );
    expect(markedDoneLine(1, ["f1"], { kind: "undone", count: 0 })?.text).toBe("Undone.");
  });

  it("gives the server's reason for a refusal, with nothing to retry", () => {
    expect(
      markedDoneLine(1, ["f1"], { kind: "refused", reason: "Ask an admin to review it." }),
    ).toEqual({ text: "Not undone. Ask an admin to review it.", undo: null });
  });

  it("keeps Undo for what is left after no answer", () => {
    expect(markedDoneLine(2, ["f1", "f2"], { kind: "failed", left: ["f2"], reopened: 1 })).toEqual({
      text: "Not undone. Check your signal and try again.",
      undo: ["f2"],
    });
  });
});

describe("undoMarkedDone", () => {
  it("reopens each note in turn, and nothing else", async () => {
    apiFetch.mockResolvedValue({});
    expect(await undoMarkedDone(["f1", "f2"])).toEqual({ kind: "undone", count: 2 });
    expect(apiFetch.mock.calls).toEqual([
      ["/follow-ups/f1", { method: "PATCH", body: JSON.stringify({ done: false }) }],
      ["/follow-ups/f2", { method: "PATCH", body: JSON.stringify({ done: false }) }],
    ]);
  });

  it("skips a note removed since", async () => {
    apiFetch.mockRejectedValueOnce(refusal(404, "No such follow-up.")).mockResolvedValueOnce({});
    expect(await undoMarkedDone(["gone", "f2"])).toEqual({ kind: "undone", count: 1 });
  });

  it("stops at a refusal with the server's reason", async () => {
    const reason = "Ann's suggestion for this door is waiting for an admin.";
    apiFetch.mockRejectedValueOnce(refusal(409, reason));
    expect(await undoMarkedDone(["f1", "f2"])).toEqual({ kind: "refused", reason });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps what is left when there is no answer, counting what was reopened", async () => {
    apiFetch.mockResolvedValueOnce({}).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await undoMarkedDone(["f1", "f2", "f3"])).toEqual({
      kind: "failed",
      left: ["f2", "f3"],
      reopened: 1,
    });
  });

  it("treats a server fault as no answer", async () => {
    apiFetch.mockRejectedValueOnce(refusal(503, "Try again."));
    expect(await undoMarkedDone(["f1"])).toMatchObject({ kind: "failed", left: ["f1"] });
  });

  it("counts a second try's reopens with the first's", async () => {
    apiFetch.mockResolvedValue({});
    expect(await undoMarkedDone(["f2", "f3"], 1)).toEqual({ kind: "undone", count: 3 });
  });
});
