import { describe, expect, it } from "vitest";
import {
  hasAttentionFilter,
  parseAttentionFilters,
  toAttentionRequest,
  toAttentionSearch,
  type AttentionFilters,
} from "@/lib/follow-ups/attention-filters";

const BLOCK = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const NONE: AttentionFilters = { blockId: "", includeMedium: false };

const parse = (query: string) => parseAttentionFilters(new URLSearchParams(query));

describe("parseAttentionFilters", () => {
  it("reads nothing set as the whole list, high interest only", () => {
    expect(parse("")).toEqual(NONE);
  });

  it("reads the block and the medium toggle", () => {
    expect(parse(`blockId=${BLOCK}&minimumInterest=medium`)).toEqual({
      blockId: BLOCK,
      includeMedium: true,
    });
  });

  it("drops a malformed block, which the API would refuse with a 400", () => {
    expect(parse("blockId=123").blockId).toBe("");
  });

  it.each(["high", "low", "no_response", "warm"])(
    "reads minimumInterest=%s as high interest only",
    (level) => {
      expect(parse(`minimumInterest=${level}`).includeMedium).toBe(false);
    },
  );

  it("never reads the search term", () => {
    // It is a name or a phone number, and the screen holds it (D-129-7).
    expect(parse("q=Tan")).toEqual(NONE);
  });
});

describe("toAttentionSearch", () => {
  it("is empty when nothing is set", () => {
    expect(toAttentionSearch(NONE)).toBe("");
  });

  it("writes the block, then the toggle", () => {
    expect(toAttentionSearch({ blockId: BLOCK, includeMedium: true })).toBe(
      `blockId=${BLOCK}&minimumInterest=medium`,
    );
  });

  it("writes each one alone", () => {
    expect(toAttentionSearch({ blockId: BLOCK, includeMedium: false })).toBe(`blockId=${BLOCK}`);
    expect(toAttentionSearch({ blockId: "", includeMedium: true })).toBe("minimumInterest=medium");
  });

  it("round-trips through the parser", () => {
    const filters = { blockId: BLOCK, includeMedium: true };
    expect(parse(toAttentionSearch(filters))).toEqual(filters);
  });
});

describe("toAttentionRequest", () => {
  it("asks for a page and nothing else by default", () => {
    expect(toAttentionRequest(NONE, { limit: 50, offset: 0 })).toBe("limit=50&offset=0");
  });

  it("adds the toggle, then the block", () => {
    expect(
      toAttentionRequest({ blockId: BLOCK, includeMedium: true }, { limit: 50, offset: 100 }),
    ).toBe(`limit=50&offset=100&minimumInterest=medium&blockId=${BLOCK}`);
  });

  it("sends the block without the toggle", () => {
    expect(
      toAttentionRequest({ blockId: BLOCK, includeMedium: false }, { limit: 50, offset: 0 }),
    ).toBe(`limit=50&offset=0&blockId=${BLOCK}`);
  });
});

describe("hasAttentionFilter", () => {
  it("is false with nothing set", () => {
    expect(hasAttentionFilter(NONE, "")).toBe(false);
  });

  it("is false for the medium toggle alone, which widens the list", () => {
    expect(hasAttentionFilter({ blockId: "", includeMedium: true }, "")).toBe(false);
  });

  it("is false for a blank search", () => {
    expect(hasAttentionFilter(NONE, "   ")).toBe(false);
  });

  it("is true for a block or a search", () => {
    expect(hasAttentionFilter({ blockId: BLOCK, includeMedium: false }, "")).toBe(true);
    expect(hasAttentionFilter(NONE, "tan")).toBe(true);
  });
});
