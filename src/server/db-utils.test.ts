import { describe, expect, it } from "vitest";
import { firstOrThrow, getOrThrow, isConstraintViolation, presentOrThrow } from "@/server/db-utils";
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

describe("presentOrThrow", () => {
  it("returns a value that is set", () => {
    expect(presentOrThrow(new Date(0), "a start")).toEqual(new Date(0));
  });

  it("fails loudly on null, naming what was missing", () => {
    expect(() => presentOrThrow(null, "a start")).toThrow(/a start/);
  });
});

describe("getOrThrow", () => {
  it("returns the value for a key that is there", () => {
    expect(getOrThrow(new Map([["a", 1]]), "a", "the entry")).toBe(1);
  });

  it("returns a falsy value rather than treating it as missing", () => {
    expect(getOrThrow(new Map([["a", 0]]), "a", "the entry")).toBe(0);
  });

  it("throws, naming what was expected, when the key is absent", () => {
    expect(() => getOrThrow(new Map<string, number>(), "a", "the team")).toThrow(/the team/);
  });
});
