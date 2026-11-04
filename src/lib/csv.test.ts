import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/generated/types.gen";
import { escapeCell, historyToCsv, toCsv } from "@/lib/csv";

const AT = "2026-03-14T11:00:00.000Z";

function entry(overrides: {
  unitNumber?: string;
  name?: string | null;
  description?: string;
  member?: string | null;
  team?: HistoryEntry["visit"]["team"];
}): HistoryEntry {
  const {
    unitNumber = "#05-123",
    name = null,
    description = "",
    member = "Alice",
    team = null,
  } = overrides;
  return {
    visit: {
      id: "v1",
      householdId: "h1",
      sessionId: "s1",
      member: { id: "u1", name: member, image: null },
      team,
      interestLevel: "high",
      description,
      clientCreatedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    },
    household: {
      id: "h1",
      blockId: "b1",
      unitNumber,
      name,
      contact: null,
      religion: "buddhist",
      createdAt: AT,
      updatedAt: AT,
    },
    block: { id: "b1", name: "123", street: "Test Ave", postalCode: null, createdAt: AT },
    session: {
      id: "s1",
      title: "March outing",
      kind: "regular",
      status: "ended",
      startedAt: null,
      endedAt: null,
      createdBy: { id: "admin", name: "Admin", image: null },
      createdAt: AT,
    },
  };
}

describe("escapeCell", () => {
  it("leaves an ordinary value alone", () => {
    expect(escapeCell("Mr Tan")).toBe("Mr Tan");
  });

  it("quotes a value holding a comma", () => {
    expect(escapeCell("Tan, Mr")).toBe('"Tan, Mr"');
  });

  it("doubles an embedded quote", () => {
    expect(escapeCell('He said "come back"')).toBe('"He said ""come back"""');
  });

  it("quotes a value holding a newline", () => {
    expect(escapeCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("defuses a value a spreadsheet would run as a formula", () => {
    // Notes are free text typed at a door; =cmd|... is a real attack on CSV.
    expect(escapeCell("=1+1")).toBe('"\'=1+1"');
    expect(escapeCell("+44 7700")).toBe('"\'+44 7700"');
    expect(escapeCell("-5")).toBe('"\'-5"');
    expect(escapeCell("@handle")).toBe('"\'@handle"');
    expect(escapeCell("\tcmd")).toBe('"\'\tcmd"');
    expect(escapeCell("\rcmd")).toBe('"\'\rcmd"');
  });

  /* Stored as typed (#130): a spreadsheet that skips what leads the value, or
     takes a carriage return as a formula start, would still run it. */
  it.each([
    ["a carriage return", '\r=HYPERLINK("http://evil.example","Tan")'],
    ["a space", " =1+1"],
    ["a no-break space", "\u00a0=1"],
    ["a zero-width space", "\u200b=1"],
    ["a line feed", "\n-1"],
    ["a control character", "\u0000@x"],
  ])("defuses a formula behind %s", (_, value) => {
    expect(escapeCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
  });

  it.each(["a=b", "Mr Tan", "Blk 5 - #05-12", "tan@example.com"])(
    "leaves %j alone, with nothing but text before its sign",
    (value) => {
      expect(escapeCell(value)).toBe(value);
    },
  );
});

describe("toCsv", () => {
  it("joins cells with commas and rows with CRLF", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a,b\r\nc,d");
  });

  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("historyToCsv", () => {
  it("writes a header row even when nothing matched", () => {
    // A file with no header is not obviously an empty export.
    const csv = historyToCsv([]);
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(csv).toContain("Block,Street,Unit");
  });

  it("writes one row per visit", () => {
    const csv = historyToCsv([entry({}), entry({ unitNumber: "#05-124" })]);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("carries the household, the visit and the outing", () => {
    const csv = historyToCsv([entry({ name: "Mr Tan", description: "Come back Sunday" })]);
    const row = csv.split("\r\n")[1] ?? "";
    expect(row).toContain("#05-123");
    expect(row).toContain("Mr Tan");
    expect(row).toContain("buddhist");
    expect(row).toContain("high");
    expect(row).toContain("Come back Sunday");
    expect(row).toContain("March outing");
  });

  it("writes an empty cell rather than null for what is not known", () => {
    const row = historyToCsv([entry({ name: null, member: null })]).split("\r\n")[1] ?? "";
    expect(row).not.toContain("null");
  });

  it("names a nameless recorder the way it names a nameless teammate", () => {
    const team = { id: "t1", name: "North", members: [{ id: "u2", name: null, image: null }] };
    const row = historyToCsv([entry({ member: null, team })]).split("\r\n")[1] ?? "";
    expect(row).toContain("Someone,North,Someone,March outing");
  });

  it("names the team and the teammates who were on it", () => {
    const team = {
      id: "t1",
      name: "North pair",
      members: [
        { id: "u2", name: "Ben Lim", image: null },
        { id: "u3", name: null, image: null },
      ],
    };
    const [header, row] = historyToCsv([entry({ team })]).split("\r\n");
    expect(header).toContain("Recorded by,Team,Teammates,Session");
    expect(row).toContain("Alice,North pair,Ben Lim; Someone,March outing");
  });

  it("leaves the team cells empty for a record made without a team", () => {
    const row = historyToCsv([entry({})]).split("\r\n")[1] ?? "";
    expect(row).toContain("Alice,,,March outing");
  });

  /* Team and member names are free text anyone on the team can type. */
  it.each(["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "\tx"])(
    "defuses a team name starting %j",
    (risky) => {
      const team = { id: "t1", name: risky, members: [] };
      const row = historyToCsv([entry({ team })]).split("\r\n")[1] ?? "";
      expect(row).toContain(`Alice,"'${risky}",,March outing`);
    },
  );

  /* A tab cannot lead a teammate cell: display names are trimmed first. */
  it.each(["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)"])(
    "defuses a teammate name starting %j",
    (risky) => {
      const team = { id: "t1", name: "North", members: [{ id: "u2", name: risky, image: null }] };
      const row = historyToCsv([entry({ team })]).split("\r\n")[1] ?? "";
      expect(row).toContain(`Alice,North,"'${risky}",March outing`);
    },
  );
});
