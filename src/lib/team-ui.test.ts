import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import {
  canChangeTeam,
  defaultTeamName,
  describeTeamFailure,
  displayName,
  findMyTeam,
  firstName,
  hasJoined,
  isNetworkFailure,
  pickerCandidates,
} from "@/lib/team-ui";
import { checkTeamName } from "@/lib/team-name";

const user = (id: string, name: string | null = id) => ({ id, name, image: null });
const participant = (id: string, teamId: string | null = null, name: string | null = id) => ({
  user: user(id, name),
  teamId,
  joinedAt: "",
});
const error = (status: number, code: string) =>
  new ApiRequestError(status, { error: { code, message: "server words" } } as never);

describe("names", () => {
  it("takes the first word of a name", () => {
    expect(firstName("Ann Tan")).toBe("Ann");
    expect(firstName("  Ben  ")).toBe("Ben");
  });

  it("falls back for a person with no name", () => {
    expect(displayName(null)).toBe("Someone");
    expect(displayName("   ")).toBe("Someone");
    expect(firstName(null)).toBe("Someone");
  });

  it("builds 'Ann & Ben' from first names", () => {
    expect(defaultTeamName("Ann Tan", "Ben Lim")).toBe("Ann & Ben");
  });

  it("builds a default that the team-name rule accepts", () => {
    expect(checkTeamName(defaultTeamName(null, null)).ok).toBe(true);
  });
});

describe("pickerCandidates", () => {
  it("offers joined people who are free, never me or the teamed", () => {
    const list = [participant("me"), participant("a"), participant("b", "t1")];
    expect(pickerCandidates(list, "me").map(({ user: u }) => u.id)).toEqual(["a"]);
  });
});

describe("team lookups", () => {
  const team = { id: "t1", sessionId: "s", name: "N", members: [user("me")], createdAt: "" };

  it("finds the team the caller is a member of", () => {
    expect(findMyTeam([team], "me")).toBe(team);
    expect(findMyTeam([team], "other")).toBeUndefined();
  });

  it("knows whether the caller has joined", () => {
    expect(hasJoined([participant("me")], "me")).toBe(true);
    expect(hasJoined([participant("a")], "me")).toBe(false);
  });
});

describe("canChangeTeam", () => {
  it("needs a connection and a running outing", () => {
    expect(canChangeTeam(true, true)).toBe(true);
    expect(canChangeTeam(false, true)).toBe(false);
    expect(canChangeTeam(true, false)).toBe(false);
  });
});

describe("describeTeamFailure", () => {
  it("treats a fetch TypeError as offline", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(describeTeamFailure(new TypeError("x"))).toMatchObject({ network: true });
  });

  it.each([
    [409, "session_not_active", /not running/],
    [409, "conflict", /already on a team/],
    [403, "forbidden", /not allowed/],
    [404, "not_found", /no longer there/],
    [400, "bad_request", /not accepted/],
    [401, "unauthenticated", /Sign in again/],
    [403, "account_deactivated", /Sign in again/],
    [500, "internal_error", /Could not change/],
  ])("maps %s %s to friendly text", (status, code, text) => {
    const failure = describeTeamFailure(error(status, code));
    expect(failure.message).toMatch(text);
    expect(failure.network).toBe(false);
  });

  it("never shows raw server words", () => {
    expect(describeTeamFailure(error(409, "conflict")).message).not.toContain("server words");
  });

  it("falls back for anything else", () => {
    expect(describeTeamFailure("boom").message).toMatch(/Could not change/);
  });
});
