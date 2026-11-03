import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import {
  type NotSavedField,
  REASONS,
  UNIT_REFUSAL,
  UNIT_TOO_LONG,
  notSavedByForm,
  notSavedFromServer,
  notSavedLine,
} from "@/lib/not-saved";

const VISIT: NotSavedField[] = ["unitNumber", "interestLevel"];
const ON_BEHALF: NotSavedField[] = ["memberId", "blockId", "unitNumber", "interestLevel"];

const invalid = (details?: { path: string; message: string }[]) =>
  new ApiRequestError(400, {
    error: {
      code: "validation_failed",
      message: "Invalid request body.",
      ...(details === undefined ? {} : { details }),
    },
  });

describe("notSavedByForm", () => {
  it("lists every reason in the form's order, and points at the first", () => {
    expect(notSavedByForm(["interestLevel", "unitNumber", "memberId"], ON_BEHALF)).toEqual({
      reasons: [
        "No member is chosen.",
        "The unit number is blank.",
        "No interest level is chosen.",
      ],
      field: "memberId",
    });
  });

  it("says a unit number is too long, and how long it may be", () => {
    expect(UNIT_TOO_LONG).toBe("The unit number is too long (32 characters at most).");
    expect(notSavedByForm(["interestLevel", "unitNumberTooLong"], VISIT)).toEqual({
      reasons: [UNIT_TOO_LONG, "No interest level is chosen."],
      field: "unitNumber",
    });
  });

  it("opens for a unit too long even when it is the only fault", () => {
    expect(notSavedByForm(["unitNumberTooLong"], ON_BEHALF)).toEqual({
      reasons: [UNIT_TOO_LONG],
      field: "unitNumber",
    });
  });

  it("names each fault of a unit number by its own reason", () => {
    expect(REASONS[UNIT_REFUSAL.blank]).toBe("The unit number is blank.");
    expect(REASONS[UNIT_REFUSAL.too_long]).toBe(UNIT_TOO_LONG);
  });

  it("names a blank note", () => {
    expect(notSavedByForm(["note"], ["note"])).toEqual({
      reasons: [REASONS.note],
      field: "note",
    });
  });

  it("opens nothing when only a choice is missing", () => {
    // The owner's scope is blank text; the line beside Save says the rest.
    expect(notSavedByForm(["interestLevel"], VISIT)).toBeNull();
    expect(notSavedByForm(["memberId", "interestLevel"], ON_BEHALF)).toBeNull();
  });

  it("opens nothing when nothing was refused", () => {
    expect(notSavedByForm([], VISIT)).toBeNull();
  });
});

describe("notSavedFromServer", () => {
  it("says what the form's own field broke, by the last segment of its path", () => {
    const refused = notSavedFromServer(
      invalid([
        { path: "/unitNumber", message: "Invalid string: must match pattern /\\S/" },
        { path: "/unitNumber", message: "Too small: expected string to have >=1 characters" },
      ]),
      VISIT,
    );
    expect(refused).toEqual({
      reasons: ["The unit number is blank or too long."],
      field: "unitNumber",
      fields: { unitNumber: "The unit number is blank or too long." },
    });
  });

  it("reads a sync item's path the same way", () => {
    expect(
      notSavedFromServer(invalid([{ path: "/items/0/note", message: "x" }]), ["note"])?.field,
    ).toBe("note");
  });

  it("keeps the server's words for a field the form does not have, after its own", () => {
    const refused = notSavedFromServer(
      invalid([
        { path: "/description", message: "Too big: expected string to have <=4000 characters" },
        { path: "/interestLevel", message: "Invalid option" },
        { path: "/name", message: "Too big: expected string to have <=4000 characters" },
      ]),
      VISIT,
    );
    expect(refused).toEqual({
      reasons: [
        "The interest level was not accepted.",
        "Too big: expected string to have <=4000 characters",
      ],
      field: "interestLevel",
      fields: { interestLevel: "The interest level was not accepted." },
    });
  });

  it("never calls a choice the server refused missing: one was sent", () => {
    const refused = notSavedFromServer(
      invalid([
        { path: "/memberId", message: "Invalid UUID" },
        { path: "/blockId", message: "Invalid UUID" },
        { path: "/interestLevel", message: "Invalid option" },
      ]),
      ON_BEHALF,
    );
    expect(refused?.reasons).toEqual([
      "The member was not accepted.",
      "The block was not accepted.",
      "The interest level was not accepted.",
    ]);
    for (const reason of refused?.reasons ?? []) {
      expect(Object.values(REASONS)).not.toContain(reason);
    }
  });

  it("points at nothing when the server named none of the form's fields", () => {
    expect(
      notSavedFromServer(invalid([{ path: "/description", message: "Too long" }]), VISIT),
    ).toEqual({ reasons: ["Too long"], field: null, fields: {} });
  });

  it("falls back to the server's message when it names no field", () => {
    expect(notSavedFromServer(invalid(), ["note"])).toEqual({
      reasons: ["Invalid request body."],
      field: null,
      fields: {},
    });
  });

  it("leaves every other failure to the form's own message", () => {
    const conflict = new ApiRequestError(409, { error: { code: "conflict", message: "Taken." } });
    const otherBadRequest = new ApiRequestError(400, {
      error: { code: "clock_skew", message: "Your clock is out." },
    });
    expect(notSavedFromServer(conflict, VISIT)).toBeNull();
    expect(notSavedFromServer(otherBadRequest, VISIT)).toBeNull();
    expect(notSavedFromServer(new TypeError("Failed to fetch"), VISIT)).toBeNull();
  });
});

describe("notSavedLine", () => {
  it("puts the same reasons on one line", () => {
    expect(notSavedLine({ reasons: ["The note is blank.", "Too long"], field: null })).toBe(
      "Not saved. The note is blank. Too long",
    );
  });
});
