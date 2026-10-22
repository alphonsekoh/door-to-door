import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/generated/types.gen";
import { ownHistoryRequest, parseScope, scopeHref, vouchedTeamIds } from "@/lib/teams/team-view";

describe("parseScope", () => {
  it("reads the team view only from its exact value", () => {
    expect(parseScope(new URLSearchParams("view=team"))).toBe("team");
    expect(parseScope(new URLSearchParams("view=TEAM"))).toBe("me");
    expect(parseScope(new URLSearchParams("view=everyone"))).toBe("me");
    expect(parseScope(new URLSearchParams())).toBe("me");
  });
});

describe("scopeHref", () => {
  it("carries the team view into a link, and leaves 'me' bare", () => {
    expect(scopeHref("/history/s1", "team")).toBe("/history/s1?view=team");
    expect(scopeHref("/history/s1", "me")).toBe("/history/s1");
  });
});

describe("ownHistoryRequest", () => {
  it("asks for team records only in the team view", () => {
    const page = { limit: 20, offset: 40 };
    expect(ownHistoryRequest("me", {}, page)).toBe("limit=20&offset=40");
    expect(ownHistoryRequest("team", {}, page)).toBe("limit=20&offset=40&includeTeam=true");
  });

  it("passes only the filters that are set", () => {
    expect(
      ownHistoryRequest(
        "team",
        { sessionId: "s1", blockId: "", interestLevel: "high" },
        { limit: 50, offset: 0 },
      ),
    ).toBe("limit=50&offset=0&includeTeam=true&sessionId=s1&interestLevel=high");
  });
});

const entry = (memberId: string, teamId: string | null) =>
  ({
    visit: {
      member: { id: memberId, name: memberId, image: null },
      team: teamId === null ? null : { id: teamId, name: teamId, members: [] },
    },
  }) as HistoryEntry;

describe("vouchedTeamIds", () => {
  it("takes the teams of other people's records, once each", () => {
    const entries = [entry("ben", "t1"), entry("chris", "t1"), entry("me", "t-old")];
    expect(vouchedTeamIds(entries, "me")).toEqual(["t1"]);
  });

  it("ignores the viewer's own records, whose old team they may have left", () => {
    expect(vouchedTeamIds([entry("me", "t-old"), entry("ben", null)], "me")).toEqual([]);
  });

  it("vouches for nothing while the viewer is unknown", () => {
    expect(vouchedTeamIds([entry("ben", "t1")], undefined)).toEqual([]);
  });
});
