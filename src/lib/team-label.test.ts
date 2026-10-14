import { describe, expect, it } from "vitest";
import { teamName, teammateNames, visitByline } from "@/lib/team-label";

const person = (id: string, name: string | null) => ({ id, name, image: null });

describe("visitByline", () => {
  it("names only the author when the record has no team", () => {
    expect(visitByline({ member: person("a", "Alice Tan"), team: null })).toBe("Alice Tan");
  });

  it("puts the author first, then the snapshot teammates", () => {
    const visit = {
      member: person("a", "Alice Tan"),
      team: {
        id: "t1",
        name: "Alice & Ben",
        members: [person("b", "Ben Lim"), person("c", "Chris Ong")],
      },
    };
    expect(visitByline(visit)).toBe("Alice Tan with Ben Lim, Chris Ong");
  });

  it("says 'Someone' for a person with no name, author or teammate", () => {
    const visit = {
      member: person("a", null),
      team: { id: "t1", name: "Solo", members: [person("b", "  ")] },
    };
    expect(visitByline(visit)).toBe("Someone with Someone");
  });

  it("is just the author on a team that had no one else on it", () => {
    const visit = { member: person("a", "Alice"), team: { id: "t1", name: "Solo", members: [] } };
    expect(visitByline(visit)).toBe("Alice");
    expect(teammateNames(visit)).toEqual([]);
  });
});

describe("teamName", () => {
  it("is the stamped team's current name, or null", () => {
    expect(teamName({ member: person("a", "A"), team: null })).toBeNull();
    expect(
      teamName({ member: person("a", "A"), team: { id: "t1", name: "North", members: [] } }),
    ).toBe("North");
  });
});
