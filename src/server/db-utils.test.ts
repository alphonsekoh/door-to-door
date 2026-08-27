import { describe, expect, it } from "vitest";
import { firstOrThrow, isConstraintViolation } from "@/server/db-utils";
import { InternalError } from "@/server/http/errors";

describe("firstOrThrow", () => {
  it("returns the first row", () => {
    expect(firstOrThrow([{ total: 7 }], "the count")).toEqual({ total: 7 });
  });

  it("ignores anything after the first", () => {
    expect(firstOrThrow([1, 2, 3], "the query")).toBe(1);
  });

  it("throws when the query returned nothing", () => {
    expect(() => firstOrThrow([], "the count")).toThrow(InternalError);
  });

  it("names what was expected, so the log points somewhere", () => {
    expect(() => firstOrThrow([], "the session insert")).toThrow(/the session insert/);
  });
});

describe("isConstraintViolation", () => {
  const CONSTRAINT = "one_active_session_idx";

  it("recognises the constraint on the error itself", () => {
    expect(isConstraintViolation({ constraint: CONSTRAINT }, CONSTRAINT)).toBe(true);
  });

  it("finds it on a wrapped cause", () => {
    // Drizzle wraps the driver error, so it is never on top.
    expect(
      isConstraintViolation(
        Object.assign(new Error("Failed query"), { cause: { constraint: CONSTRAINT } }),
        CONSTRAINT,
      ),
    ).toBe(true);
  });

  it("finds it several causes deep", () => {
    expect(
      isConstraintViolation({ cause: { cause: { constraint: CONSTRAINT } } }, CONSTRAINT),
    ).toBe(true);
  });

  it("does not confuse one constraint with another", () => {
    expect(isConstraintViolation({ constraint: "blocks_name_street_unique" }, CONSTRAINT)).toBe(
      false,
    );
  });

  it.each([
    ["an error with no constraint", new Error("connection reset")],
    ["null", null],
    ["a string", "boom"],
    ["undefined", undefined],
  ])("does not claim %s", (_case, error) => {
    expect(isConstraintViolation(error, CONSTRAINT)).toBe(false);
  });
});
