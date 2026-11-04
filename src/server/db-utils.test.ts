import { describe, expect, it } from "vitest";
import {
  MAX_IDS_PER_STATEMENT,
  appendTo,
  chunked,
  firstOrThrow,
  getOrThrow,
  isConstraintViolation,
  presentOrThrow,
  selectInChunks,
} from "@/server/db-utils";
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

describe("chunked", () => {
  it("splits a list into runs of the size, in order, with the remainder last", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("keeps a list that fits as one chunk", () => {
    expect(chunked(["a", "b"], 2)).toEqual([["a", "b"]]);
  });

  it("makes no chunk of an empty list, so no statement runs", () => {
    expect(chunked([], 2)).toEqual([]);
  });

  it("stays under Postgres's bind limit by default, even for three columns a row", () => {
    const ids = Array.from({ length: MAX_IDS_PER_STATEMENT * 2 + 1 }, (_, i) => i);
    expect(chunked(ids).map((chunk) => chunk.length)).toEqual([
      MAX_IDS_PER_STATEMENT,
      MAX_IDS_PER_STATEMENT,
      1,
    ]);
    expect(MAX_IDS_PER_STATEMENT * 3).toBeLessThanOrEqual(65_535);
  });
});

describe("selectInChunks", () => {
  it("runs one select per chunk, one at a time, and returns every row in order", async () => {
    const asked: number[][] = [];
    let running = 0;
    const rows = await selectInChunks(
      Array.from({ length: MAX_IDS_PER_STATEMENT + 2 }, (_, i) => i),
      async (chunk) => {
        running += 1;
        expect(running).toBe(1);
        asked.push(chunk);
        await Promise.resolve();
        running -= 1;
        return chunk.filter((id) => id % 5_000 === 0).map((id) => ({ id }));
      },
    );
    expect(asked.map((chunk) => chunk.length)).toEqual([MAX_IDS_PER_STATEMENT, 2]);
    expect(rows).toEqual([{ id: 0 }, { id: 5_000 }, { id: 10_000 }]);
  });

  it("asks nothing for no ids", async () => {
    let calls = 0;
    expect(
      await selectInChunks([], () => {
        calls += 1;
        return Promise.resolve([]);
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("appendTo", () => {
  it("starts a group for a new key and adds to it after, in order", () => {
    const groups = new Map<string, number[]>();
    appendTo(groups, "a", 1);
    appendTo(groups, "b", 2);
    appendTo(groups, "a", 3);
    expect([...groups]).toEqual([
      ["a", [1, 3]],
      ["b", [2]],
    ]);
  });
});
