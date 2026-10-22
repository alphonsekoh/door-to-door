import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import { amendRoute, describeAmendFailure, mayAmendVisit } from "@/lib/history/amend";

const person = (id: string) => ({ id, name: id, image: null });
const teamVisit = { member: person("alice"), team: { id: "t1", name: "A & B", members: [] } };
const soloVisit = { member: person("alice"), team: null };
const member = (userId: string | undefined, teamIds: string[] = []) => ({
  userId,
  isAdmin: false,
  teamIds,
});
const error = (status: number, code: string) =>
  new ApiRequestError(status, { error: { code, message: "server words" } } as never);

describe("mayAmendVisit", () => {
  it("lets an admin amend anything", () => {
    expect(mayAmendVisit(soloVisit, { userId: "x", isAdmin: true, teamIds: [] })).toBe(true);
  });

  it("lets the author amend their own record", () => {
    expect(mayAmendVisit(soloVisit, member("alice"))).toBe(true);
  });

  it("lets a current teammate the server vouched for amend", () => {
    expect(mayAmendVisit(teamVisit, member("ben", ["t1"]))).toBe(true);
  });

  it("refuses someone on another team, or none", () => {
    expect(mayAmendVisit(teamVisit, member("ben", ["t2"]))).toBe(false);
    expect(mayAmendVisit(teamVisit, member("ben"))).toBe(false);
    expect(mayAmendVisit(soloVisit, member("ben", ["t1"]))).toBe(false);
  });

  it("refuses while the viewer is still unknown", () => {
    expect(mayAmendVisit(soloVisit, member(undefined))).toBe(false);
  });
});

describe("amendRoute", () => {
  it("names the right the viewer holds", () => {
    expect(amendRoute(teamVisit, { userId: "x", isAdmin: true, teamIds: ["t1"] })).toBe("admin");
    expect(amendRoute(teamVisit, member("alice", ["t1"]))).toBe("author");
    expect(amendRoute(teamVisit, member("ben", ["t1"]))).toBe("team");
    expect(amendRoute(teamVisit, member("ben"))).toBeNull();
  });
});

describe("describeAmendFailure", () => {
  it("never claims a lost connection changed nothing", () => {
    expect(describeAmendFailure(new TypeError("Failed to fetch"))).toBe(
      "Could not confirm. Refresh to see whether it went through.",
    );
  });

  it("explains a refusal after leaving the team instead of showing server text", () => {
    const message = describeAmendFailure(error(403, "forbidden"), "team");
    expect(message).toMatch(/not on this record's team any more/);
    expect(message).not.toContain("server words");
  });

  it.each(["admin", "author", null] as const)(
    "does not blame the team when the right came as %s",
    (route) => {
      const message = describeAmendFailure(error(403, "forbidden"), route);
      expect(message).toBe("You can no longer amend this record.");
    },
  );

  it("tells a deactivated account to sign in again", () => {
    expect(describeAmendFailure(error(403, "account_deactivated"))).toBe(
      "Your sign-in has ended. Sign in again.",
    );
  });

  it("keeps the server's explanation for anything else", () => {
    expect(describeAmendFailure(error(409, "session_not_active"))).toBe("server words");
    expect(describeAmendFailure("boom")).toBe("Could not save this change.");
  });
});
