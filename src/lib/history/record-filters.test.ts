import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/generated/types.gen";
import {
  EMPTY_FILTERS,
  hasAnyFilter,
  hasServerFilter,
  matchesSearch,
  parseFilters,
  toHistoryQuery,
  toSearchParams,
  type RecordFilters,
} from "@/lib/history/record-filters";

const filters = (overrides: Partial<RecordFilters> = {}): RecordFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
});

const AT = "2026-03-14T11:00:00.000Z";
const TEAM = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function entry(unitNumber: string, name: string | null = null, contact: string | null = null) {
  return {
    visit: {
      id: "v1",
      householdId: "h1",
      sessionId: "s1",
      member: { id: "u1", name: "Alice", image: null },
      interestLevel: "low",
      description: "",
      clientCreatedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    },
    household: {
      id: "h1",
      blockId: "b1",
      unitNumber,
      name,
      contact,
      religion: null,
      createdAt: AT,
      updatedAt: AT,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
    session: {
      id: "s1",
      title: "June outing",
      status: "active",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: AT,
    },
  } as HistoryEntry;
}

describe("parseFilters", () => {
  it("reads every filter from the URL, and never the search term", () => {
    // A name or a phone number in an old link is not taken up (#130).
    const parsed = parseFilters(
      new URLSearchParams("blockId=b1&memberId=u1&interestLevel=high&q=tan"),
    );
    expect(parsed).toEqual({
      blockId: "b1",
      memberId: "u1",
      teamId: "",
      interestLevel: "high",
      q: "",
    });
  });

  it("keeps a team id only when it is shaped like one", () => {
    expect(parseFilters(new URLSearchParams(`teamId=${TEAM}`)).teamId).toBe(TEAM);
    // An edited URL must not turn the whole list into a 400.
    expect(parseFilters(new URLSearchParams("teamId=north-pair")).teamId).toBe("");
    expect(parseFilters(new URLSearchParams(`teamId=${TEAM}x`)).teamId).toBe("");
  });

  it("returns empty filters for a bare URL", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(EMPTY_FILTERS);
  });

  it("drops an interest level the contract does not know", () => {
    // A URL is editable; sending it on would come back a 400, not an empty list.
    expect(parseFilters(new URLSearchParams("interestLevel=maybe")).interestLevel).toBe("");
  });

  it("accepts every level the contract does know", () => {
    for (const level of ["low", "medium", "high", "no_response"]) {
      expect(parseFilters(new URLSearchParams(`interestLevel=${level}`)).interestLevel).toBe(level);
    }
  });
});

describe("toSearchParams", () => {
  it("writes only the filters that are set", () => {
    expect(toSearchParams(filters({ blockId: "b1" }))).toBe("blockId=b1");
  });

  it("writes nothing when nothing is filtered", () => {
    expect(toSearchParams(EMPTY_FILTERS)).toBe("");
  });

  it("round-trips through parseFilters", () => {
    const original = filters({
      blockId: "b1",
      memberId: "u1",
      teamId: TEAM,
      interestLevel: "high",
    });
    expect(parseFilters(new URLSearchParams(toSearchParams(original)))).toEqual(original);
  });

  it("never writes the search term", () => {
    // A query string reaches the server, its logs and a sign-in's callbackUrl (#130).
    expect(toSearchParams(filters({ q: "Mr Tan 91234567" }))).toBe("");
    expect(toSearchParams(filters({ blockId: "b1", q: "tan" }))).toBe("blockId=b1");
  });
});

describe("toHistoryQuery", () => {
  it("always scopes to the outing", () => {
    expect(toHistoryQuery(EMPTY_FILTERS, "s1", 100)).toBe("sessionId=s1&limit=100");
  });

  it("passes the filters the API understands", () => {
    const query = toHistoryQuery(
      filters({ blockId: "b1", memberId: "u1", teamId: TEAM, interestLevel: "high" }),
      "s1",
      100,
    );
    expect(query).toBe(
      `sessionId=s1&limit=100&blockId=b1&memberId=u1&teamId=${TEAM}&interestLevel=high`,
    );
  });

  it("keeps the search term out of the request", () => {
    // /history has no text parameter; the page is already in memory.
    expect(toHistoryQuery(filters({ q: "tan" }), "s1", 100)).toBe("sessionId=s1&limit=100");
  });
});

describe("matchesSearch", () => {
  it("matches everything on an empty term", () => {
    expect(matchesSearch(entry("#05-123"), "  ")).toBe(true);
  });

  it("matches part of the unit number", () => {
    expect(matchesSearch(entry("#05-123"), "123")).toBe(true);
  });

  it("matches a unit typed without punctuation", () => {
    expect(matchesSearch(entry("#05-123"), "05123")).toBe(true);
  });

  it("matches the name and the contact, regardless of case", () => {
    expect(matchesSearch(entry("#05-123", "Mr Tan", "91234567"), "TAN")).toBe(true);
    expect(matchesSearch(entry("#05-123", "Mr Tan", "91234567"), "9123")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(matchesSearch(entry("#05-123"), "zzz")).toBe(false);
  });
});

describe("hasAnyFilter", () => {
  it("is false when nothing is set", () => {
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false);
  });

  it("is true once anything is", () => {
    expect(hasAnyFilter(filters({ memberId: "u1" }))).toBe(true);
  });

  it("counts a search term, which is not in the URL, and not one of spaces", () => {
    expect(hasAnyFilter(filters({ q: "tan" }))).toBe(true);
    expect(hasAnyFilter(filters({ q: "   " }))).toBe(false);
  });
});

describe("hasServerFilter", () => {
  it("counts what the server filters on, not the local search", () => {
    expect(hasServerFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasServerFilter(filters({ q: "tan" }))).toBe(false);
    for (const key of ["blockId", "memberId", "teamId"] as const) {
      expect(hasServerFilter(filters({ [key]: "x" }))).toBe(true);
    }
    expect(hasServerFilter(filters({ interestLevel: "high" }))).toBe(true);
  });
});
