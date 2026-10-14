import { describe, expect, it } from "vitest";
import type { ErrorCode, FollowUp, Visit } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import {
  addedByline,
  buildTimeline,
  describeFollowUpFailure,
  doneByline,
  dueDayToInstant,
  formatDay,
  instantToDueDay,
  isOverdue,
  mayEditFollowUp,
  sortOutstanding,
  startOfToday,
  unitLabel,
} from "@/lib/follow-ups";

/* Local-time constructors throughout, so these hold in any time zone. */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

function note(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "f1",
    householdId: "h1",
    blockName: "123",
    unitNumber: "#05-123",
    visitId: null,
    author: { id: "u1", name: "Alice Tan", image: null },
    note: "Bring the flyer.",
    dueDate: null,
    doneAt: null,
    doneBy: null,
    createdAt: "2026-03-03T04:00:00.000Z",
    ...overrides,
  };
}

function visit(id: string, createdAt: string): Visit {
  return {
    id,
    householdId: "h1",
    sessionId: "s1",
    member: { id: "u1", name: "Alice Tan", image: null },
    team: null,
    interestLevel: "high",
    description: "",
    clientCreatedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("due days", () => {
  it("stores a due day as the instant local midnight begins", () => {
    expect(dueDayToInstant("2026-10-14")).toBe(local(2026, 10, 14).toISOString());
  });

  it("reads a blank or malformed day as no due date", () => {
    expect(dueDayToInstant("")).toBeNull();
    expect(dueDayToInstant("14/10/2026")).toBeNull();
  });

  it("round-trips through the date input", () => {
    expect(instantToDueDay(dueDayToInstant("2026-01-05"))).toBe("2026-01-05");
  });

  it("clears the date input for an undated note", () => {
    expect(instantToDueDay(null)).toBe("");
  });

  it("starts today at local midnight", () => {
    expect(startOfToday(local(2026, 10, 14, 23, 59))).toBe(local(2026, 10, 14).toISOString());
  });
});

describe("isOverdue", () => {
  const dueOn = (y: number, m: number, d: number) =>
    note({ dueDate: local(y, m, d).toISOString() });

  it("is overdue once the whole due day has passed", () => {
    expect(isOverdue(dueOn(2026, 10, 13), local(2026, 10, 14, 0, 1))).toBe(true);
  });

  it("is not overdue on the due day itself, even late at night", () => {
    expect(isOverdue(dueOn(2026, 10, 14), local(2026, 10, 14, 23, 59))).toBe(false);
  });

  it("is not overdue just before midnight on the day before", () => {
    expect(isOverdue(dueOn(2026, 10, 13), local(2026, 10, 13, 23, 59))).toBe(false);
  });

  it("is never overdue once resolved", () => {
    const resolved = { ...dueOn(2026, 1, 1), doneAt: "2026-01-02T00:00:00.000Z" };
    expect(isOverdue(resolved, local(2026, 10, 14))).toBe(false);
  });

  it("is never overdue without a due date", () => {
    expect(isOverdue(note(), local(2030, 1, 1))).toBe(false);
  });
});

describe("sortOutstanding", () => {
  it("orders by due day, undated last, then oldest written first", () => {
    const notes = [
      note({ id: "undated-old", createdAt: "2026-01-01T00:00:00.000Z" }),
      note({ id: "late", dueDate: "2026-12-01T00:00:00.000Z" }),
      note({ id: "undated-new", createdAt: "2026-02-01T00:00:00.000Z" }),
      note({ id: "soon", dueDate: "2026-11-01T00:00:00.000Z" }),
    ];
    expect(sortOutstanding(notes).map((n) => n.id)).toEqual([
      "soon",
      "late",
      "undated-old",
      "undated-new",
    ]);
  });

  it("drops resolved notes", () => {
    const notes = [note({ id: "open" }), note({ id: "done", doneAt: "2026-03-04T00:00:00.000Z" })];
    expect(sortOutstanding(notes).map((n) => n.id)).toEqual(["open"]);
  });
});

describe("buildTimeline", () => {
  it("interleaves visits and notes, oldest first", () => {
    const timeline = buildTimeline(
      [visit("v1", "2026-01-01T00:00:00.000Z"), visit("v2", "2026-06-01T00:00:00.000Z")],
      [note({ id: "f1", createdAt: "2026-03-01T00:00:00.000Z" })],
    );
    expect(timeline.map((entry) => `${entry.kind}:${entry.item.id}`)).toEqual([
      "visit:v1",
      "note:f1",
      "visit:v2",
    ]);
  });

  it("puts a visit before a note written at the same moment", () => {
    const at = "2026-03-01T00:00:00.000Z";
    const timeline = buildTimeline([visit("v1", at)], [note({ id: "f1", createdAt: at })]);
    expect(timeline.map((entry) => entry.kind)).toEqual(["visit", "note"]);
  });

  it("is empty for a unit with nothing on record", () => {
    expect(buildTimeline([], [])).toEqual([]);
  });
});

describe("unitLabel", () => {
  it("names the block and the unit", () => {
    expect(unitLabel(note())).toBe("Blk 123 · #05-123");
  });
});

describe("mayEditFollowUp", () => {
  it("lets the author edit", () => {
    expect(mayEditFollowUp(note(), { userId: "u1", isAdmin: false })).toBe(true);
  });

  it("lets an admin edit anyone's note", () => {
    expect(mayEditFollowUp(note(), { userId: "u9", isAdmin: true })).toBe(true);
  });

  it("does not offer another member the edit", () => {
    expect(mayEditFollowUp(note(), { userId: "u2", isAdmin: false })).toBe(false);
  });

  it("does not offer it before the viewer is known", () => {
    expect(mayEditFollowUp(note(), { userId: undefined, isAdmin: false })).toBe(false);
  });
});

describe("bylines", () => {
  it("says who added it and when", () => {
    const added = note({ createdAt: local(2026, 3, 3, 12).toISOString() });
    expect(addedByline(added)).toBe("Added by Alice Tan · 3 Mar 2026");
  });

  it("calls a nameless author Someone", () => {
    expect(addedByline(note({ author: { id: "u1", name: null, image: null } }))).toMatch(
      /^Added by Someone · /,
    );
  });

  it("says who resolved it and when", () => {
    const done = note({
      doneAt: local(2026, 6, 9, 12).toISOString(),
      doneBy: { id: "u2", name: "Ben Lim", image: null },
    });
    expect(doneByline(done)).toBe("Done by Ben Lim · 9 Jun 2026");
  });

  it("calls a resolver it cannot name Someone", () => {
    const done = note({ doneAt: local(2026, 6, 9, 12).toISOString(), doneBy: null });
    expect(doneByline(done)).toBe("Done by Someone · 9 Jun 2026");
  });

  it("has no resolver line while outstanding", () => {
    expect(doneByline(note())).toBeNull();
  });

  it("formats a day with the day first", () => {
    expect(formatDay(local(2026, 10, 14, 12).toISOString())).toBe("14 Oct 2026");
  });
});

describe("describeFollowUpFailure", () => {
  it("never claims nothing happened when no answer came back", () => {
    expect(describeFollowUpFailure(new TypeError("Failed to fetch"))).toBe(
      "Could not confirm. Refresh to see whether it went through.",
    );
  });

  it.each<[number, ErrorCode, string]>([
    [400, "validation_failed", "That note was not accepted. Check it is not empty."],
    [401, "unauthenticated", "Your sign-in has ended. Sign in again."],
    [403, "account_deactivated", "Your sign-in has ended. Sign in again."],
    [403, "forbidden", "Only the person who wrote this note, or an admin, can change it."],
    [404, "not_found", "That note or unit is no longer there. Refresh to see the latest."],
    [500, "internal_error", "Could not save the follow-up. Try again."],
  ])("words a %i (%s) without the server's text", (status, code, message) => {
    const error = new ApiRequestError(status, { error: { code, message: "raw server text" } });
    expect(describeFollowUpFailure(error)).toBe(message);
  });

  it("falls back for anything else thrown", () => {
    expect(describeFollowUpFailure(new Error("boom"))).toBe(
      "Could not save the follow-up. Try again.",
    );
  });
});
