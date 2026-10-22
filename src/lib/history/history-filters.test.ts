import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/generated/types.gen";
import {
  EMPTY_HISTORY_FILTERS,
  groupByHousehold,
  hasHistoryFilter,
  matchesHistorySearch,
  parseHistoryFilters,
  toHistoryRequest,
  toHistorySearch,
  type HistoryFilters,
} from "@/lib/history/history-filters";

const filters = (overrides: Partial<HistoryFilters> = {}): HistoryFilters => ({
  ...EMPTY_HISTORY_FILTERS,
  ...overrides,
});

function entry(
  householdId: string,
  createdAt: string,
  options: { unitNumber?: string; name?: string | null } = {},
): HistoryEntry {
  const { unitNumber = "#05-123", name = null } = options;
  return {
    visit: {
      id: `v-${createdAt}`,
      householdId,
      sessionId: "s1",
      member: { id: "u1", name: "Alice", image: null },
      team: null,
      interestLevel: "low",
      description: "",
      clientCreatedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    },
    household: {
      id: householdId,
      blockId: "b1",
      unitNumber,
      name,
      contact: null,
      religion: null,
      createdAt,
      updatedAt: createdAt,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt },
    session: {
      id: "s1",
      title: "March outing",
      status: "ended",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt,
    },
  };
}

describe("parseHistoryFilters", () => {
  it("reads every filter from the URL", () => {
    const parsed = parseHistoryFilters(
      new URLSearchParams(
        "blockId=b1&sessionId=s1&memberId=u1&teamId=0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b&interestLevel=high&religion=buddhist&from=2026-03-01&to=2026-03-31&q=tan",
      ),
    );
    expect(parsed).toEqual({
      blockId: "b1",
      sessionId: "s1",
      memberId: "u1",
      teamId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      interestLevel: "high",
      religion: "buddhist",
      from: "2026-03-01",
      to: "2026-03-31",
      q: "tan",
    });
  });

  it("returns empty filters for a bare URL", () => {
    expect(parseHistoryFilters(new URLSearchParams())).toEqual(EMPTY_HISTORY_FILTERS);
  });

  it("drops values the contract does not know", () => {
    const parsed = parseHistoryFilters(
      new URLSearchParams("interestLevel=warm&religion=pastafarian"),
    );
    expect(parsed.interestLevel).toBe("");
    expect(parsed.religion).toBe("");
  });

  it("keeps a team only inside its outing, and only a well-formed id", () => {
    const team = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    expect(parseHistoryFilters(new URLSearchParams(`sessionId=s1&teamId=${team}`)).teamId).toBe(
      team,
    );
    // Two outings can each have an "Ann & Ben"; a team without its outing is dropped.
    expect(parseHistoryFilters(new URLSearchParams(`teamId=${team}`)).teamId).toBe("");
    expect(parseHistoryFilters(new URLSearchParams("sessionId=s1&teamId=north")).teamId).toBe("");
  });

  it("drops a date that is not a date", () => {
    // A hand-edited URL must not reach the API as an unparseable instant.
    const parsed = parseHistoryFilters(new URLSearchParams("from=yesterday&to=2026-13-99x"));
    expect(parsed.from).toBe("");
    expect(parsed.to).toBe("");
  });
});

describe("toHistorySearch", () => {
  it("writes only what is set", () => {
    expect(toHistorySearch(filters({ religion: "hindu" }))).toBe("religion=hindu");
  });

  it("writes nothing when nothing is filtered", () => {
    expect(toHistorySearch(EMPTY_HISTORY_FILTERS)).toBe("");
  });

  it("round-trips through parseHistoryFilters", () => {
    const original = filters({
      blockId: "b1",
      sessionId: "s1",
      memberId: "u1",
      teamId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      interestLevel: "medium",
      religion: "christian",
      from: "2026-03-01",
      to: "2026-03-31",
      q: "tan",
    });
    expect(parseHistoryFilters(new URLSearchParams(toHistorySearch(original)))).toEqual(original);
  });
});

describe("toHistoryRequest", () => {
  it("always carries the page", () => {
    expect(toHistoryRequest(EMPTY_HISTORY_FILTERS, { limit: 100, offset: 0 })).toBe(
      "limit=100&offset=0",
    );
  });

  it("passes the filters the API understands", () => {
    const query = toHistoryRequest(
      filters({
        blockId: "b1",
        sessionId: "s1",
        memberId: "u1",
        teamId: "t1",
        interestLevel: "high",
      }),
      { limit: 50, offset: 50 },
    );
    expect(query).toBe(
      "limit=50&offset=50&blockId=b1&sessionId=s1&memberId=u1&teamId=t1&interestLevel=high",
    );
  });

  it("turns a day into an instant at each end", () => {
    const query = toHistoryRequest(filters({ from: "2026-03-01", to: "2026-03-01" }), {
      limit: 100,
      offset: 0,
    });
    // Without pushing `to` to the end of its day, a one-day range would match
    // nothing recorded after midnight.
    expect(query).toContain("from=2026-03-01T00%3A00%3A00.000Z");
    expect(query).toContain("to=2026-03-01T23%3A59%3A59.999Z");
  });

  it("keeps the search term out of the request", () => {
    expect(toHistoryRequest(filters({ q: "tan" }), { limit: 100, offset: 0 })).toBe(
      "limit=100&offset=0",
    );
  });
});

describe("matchesHistorySearch", () => {
  it("matches everything on an empty term", () => {
    expect(matchesHistorySearch(entry("h1", "2026-03-01T10:00:00.000Z"), " ")).toBe(true);
  });

  it("matches a unit typed with or without punctuation", () => {
    const row = entry("h1", "2026-03-01T10:00:00.000Z");
    expect(matchesHistorySearch(row, "123")).toBe(true);
    expect(matchesHistorySearch(row, "05123")).toBe(true);
  });

  it("matches the name regardless of case", () => {
    const row = entry("h1", "2026-03-01T10:00:00.000Z", { name: "Mr Tan" });
    expect(matchesHistorySearch(row, "TAN")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(matchesHistorySearch(entry("h1", "2026-03-01T10:00:00.000Z"), "zzz")).toBe(false);
  });
});

describe("hasHistoryFilter", () => {
  it("is false when nothing is set", () => {
    expect(hasHistoryFilter(EMPTY_HISTORY_FILTERS)).toBe(false);
  });

  it("is true once anything is", () => {
    expect(hasHistoryFilter(filters({ from: "2026-03-01" }))).toBe(true);
  });
});

describe("groupByHousehold", () => {
  it("puts every visit to one door on one row", () => {
    const groups = groupByHousehold([
      entry("h1", "2026-03-01T10:00:00.000Z"),
      entry("h2", "2026-03-01T11:00:00.000Z", { unitNumber: "#05-124" }),
      entry("h1", "2026-08-01T10:00:00.000Z"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.entries).toHaveLength(2);
  });

  it("heads each row with its door, so the row never needs a visit to name it", () => {
    const groups = groupByHousehold([
      entry("h2", "2026-03-01T11:00:00.000Z", { unitNumber: "#05-124", name: "Tan" }),
    ]);
    expect(groups[0]?.household).toMatchObject({ id: "h2", unitNumber: "#05-124", name: "Tan" });
    expect(groups[0]?.block).toMatchObject({ id: "b1", name: "123" });
  });

  it("reads the trajectory oldest first", () => {
    // Interest moves over time; the direction is the point of the row.
    const groups = groupByHousehold([
      entry("h1", "2026-08-01T10:00:00.000Z"),
      entry("h1", "2026-03-01T10:00:00.000Z"),
    ]);
    expect(groups[0]?.entries.map((e) => e.visit.createdAt)).toEqual([
      "2026-03-01T10:00:00.000Z",
      "2026-08-01T10:00:00.000Z",
    ]);
  });

  it("keeps the order the API returned the doors in", () => {
    const groups = groupByHousehold([
      entry("h2", "2026-03-01T11:00:00.000Z"),
      entry("h1", "2026-03-01T10:00:00.000Z"),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["h2", "h1"]);
  });

  it("returns nothing for an empty page", () => {
    expect(groupByHousehold([])).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const rows = [entry("h1", "2026-08-01T10:00:00.000Z"), entry("h1", "2026-03-01T10:00:00.000Z")];
    groupByHousehold(rows);
    expect(rows[0]?.visit.createdAt).toBe("2026-08-01T10:00:00.000Z");
  });
});
