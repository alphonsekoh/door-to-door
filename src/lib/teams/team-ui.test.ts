import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import {
  adminCandidates,
  canChangeTeam,
  describeAdminTeamFailure,
  defaultTeamName,
  describeTeamFailure,
  findMyTeam,
  hasJoined,
  isNetworkFailure,
  pickerCandidates,
  suggestTeamName,
} from "@/lib/teams/team-ui";
import { checkTeamName } from "@/lib/teams/team-name";

const user = (id: string, name: string | null = id) => ({ id, name, image: null });
const participant = (id: string, teamId: string | null = null, name: string | null = id) => ({
  user: user(id, name),
  teamId,
  joinedAt: "",
});
const error = (status: number, code: string) =>
  new ApiRequestError(status, { error: { code, message: "server words" } });

describe("names", () => {
  it("builds 'Ann & Ben' from first names", () => {
    expect(defaultTeamName("Ann Tan", "Ben Lim")).toBe("Ann & Ben");
  });

  it("cuts a default that would pass the limit, by code point", () => {
    const long = "A".repeat(50);
    expect(Array.from(defaultTeamName(long, long))).toHaveLength(60);
    const emoji = "\u{1F600}".repeat(50);
    expect(Array.from(defaultTeamName(emoji, emoji))).toHaveLength(60);
    expect(checkTeamName(defaultTeamName(emoji, emoji)).ok).toBe(true);
  });

  it("falls back to 'Team' when the cut leaves something unshowable", () => {
    // A joiner (format character) where the cut lands is refused by the name rule.
    const joined = "\u200d".repeat(70);
    expect(defaultTeamName("A", joined)).toBe("Team");
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
    expect(describeTeamFailure(new TypeError("x"), "read")).toMatchObject({
      network: true,
      message: "You seem to be offline.",
    });
  });

  it("does not claim a failed change changed nothing", () => {
    const failure = describeTeamFailure(new TypeError("x"), "change");
    expect(failure.message).toBe("Could not confirm. Refresh to see whether it went through.");
    expect(failure.message).not.toMatch(/Nothing was changed/);
  });

  it("flags a lost sign-in", () => {
    expect(describeTeamFailure(error(401, "unauthenticated")).auth).toBe(true);
    expect(describeTeamFailure(error(409, "conflict")).auth).toBe(false);
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

describe("suggestTeamName", () => {
  it("names one, two or more people by first name", () => {
    expect(suggestTeamName(["Ann Tan"])).toBe("Ann");
    expect(suggestTeamName(["Ann Tan", "Ben Lim"])).toBe("Ann & Ben");
    expect(suggestTeamName(["Ann Tan", "Ben Lim", null])).toBe("Ann, Ben & Someone");
  });

  it("falls back to 'Team' when nobody is chosen", () => {
    expect(suggestTeamName([])).toBe("Team");
  });
});

describe("adminCandidates", () => {
  const account = (id: string) => ({
    id,
    email: `${id}@t.local`,
    name: id,
    role: "member" as const,
    deactivatedAt: null,
    lastRecordedAt: null,
    createdAt: "",
  });

  it("offers everyone not already on a team in this session, the admin included", () => {
    const teams = [{ id: "t1", sessionId: "s", name: "N", members: [user("ben")], createdAt: "" }];
    const offered = adminCandidates([account("admin"), account("ben"), account("cy")], teams);
    expect(offered.map((u) => u.id)).toEqual(["admin", "cy"]);
  });
});

describe("describeAdminTeamFailure", () => {
  it("says a team with records cannot be deleted, and what to do instead", () => {
    expect(describeAdminTeamFailure(error(409, "conflict"), "delete").message).toBe(
      "This team has records and cannot be removed; remove its members instead.",
    );
  });

  it("never asks an admin's people to join first", () => {
    const message = describeAdminTeamFailure(error(409, "conflict"), "add").message;
    expect(message).toMatch(/already on a team/);
    expect(message).not.toMatch(/joined/);
  });

  it.each([
    [403, "forbidden", /Only an admin/],
    [409, "session_not_active", /has ended/],
    [404, "not_found", /no longer there/],
    [400, "validation_failed", /not accepted/],
    [500, "internal_error", /Could not change the team/],
  ])("maps %s %s to admin wording", (status, code, text) => {
    expect(describeAdminTeamFailure(error(status, code), "create").message).toMatch(text);
  });

  it("keeps the sign-in and connection wording of the member card", () => {
    expect(describeAdminTeamFailure(error(403, "account_deactivated"), "rename")).toMatchObject({
      auth: true,
      message: "Your sign-in has ended. Sign in again.",
    });
    expect(describeAdminTeamFailure(new TypeError("x"), "remove")).toMatchObject({
      network: true,
      message: "Could not confirm. Refresh to see whether it went through.",
    });
  });
});
