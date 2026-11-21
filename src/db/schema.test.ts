import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  accounts,
  approvalEnum,
  authSessions,
  blocks,
  followUpStatusEnum,
  followUps,
  households,
  interestLevelEnum,
  outingSessions,
  religionEnum,
  roleEnum,
  sessionBlocks,
  sessionHouseholds,
  sessionKindEnum,
  sessionParticipants,
  sessionStatusEnum,
  sessionTeamMembers,
  sessionTeams,
  signIns,
  users,
  verificationTokens,
  visitTeammates,
  visits,
} from "@/db/schema";

type Table = Parameters<typeof getTableConfig>[0];

const config = (table: Table) => getTableConfig(table);
const columnNames = (table: Table) => config(table).columns.map((c) => c.name);
const column = (table: Table, name: string) => config(table).columns.find((c) => c.name === name);
const indexNames = (table: Table) => config(table).indexes.map((i) => i.config.name);
const uniqueNames = (table: Table) => config(table).uniqueConstraints.map((u) => u.name);

/*
 * Maps every foreign key to its ON DELETE action. Resolves all of them rather
 * than searching for one, so a table's whole delete-behaviour contract is
 * asserted in a single expectation.
 */
const deleteActions = (table: Table) =>
  Object.fromEntries(
    config(table).foreignKeys.map((fk) => [
      fk
        .reference()
        .columns.map((c) => c.name)
        .join("+"),
      fk.onDelete,
    ]),
  );

describe("enums", () => {
  it("religion matches the values the form offers", () => {
    expect(religionEnum.enumValues).toEqual([
      "buddhist",
      "christian",
      "hindu",
      "freethinker",
      "others",
    ]);
  });

  it("interest level includes no_response", () => {
    // Most knocks go unanswered; it is a real outcome, not a missing value.
    expect(interestLevelEnum.enumValues).toEqual(["low", "medium", "high", "no_response"]);
  });

  it("role has exactly the two roles the app defines", () => {
    expect(roleEnum.enumValues).toEqual(["admin", "member"]);
  });

  it("session status covers the lifecycle including reopen", () => {
    // reopen moves ended -> active, so no extra status is needed.
    expect(sessionStatusEnum.enumValues).toEqual(["draft", "active", "ended"]);
  });

  it("session kind is door-to-door or follow-up", () => {
    expect(sessionKindEnum.enumValues).toEqual(["regular", "follow_up"]);
  });

  it("follow-up status is a suggestion or a list entry", () => {
    expect(followUpStatusEnum.enumValues).toEqual(["suggested", "listed"]);
  });

  it("approval is waiting, approved or blocked", () => {
    expect(approvalEnum.enumValues).toEqual(["pending", "approved", "blocked"]);
  });
});

describe("users", () => {
  it("requires an email and keeps it unique", () => {
    expect(column(users, "email")?.notNull).toBe(true);
    expect(column(users, "email")?.isUnique).toBe(true);
  });

  it("allows a null password hash for SSO-only accounts", () => {
    expect(column(users, "password_hash")?.notNull).toBe(false);
  });

  it("defaults new users to member, not admin", () => {
    expect(column(users, "role")?.default).toBe("member");
  });

  it("deactivates rather than deletes, so records stay attributed", () => {
    expect(columnNames(users)).toContain("deactivated_at");
  });

  it("approves by default, so an account an admin adds needs no approval (#249)", () => {
    expect(column(users, "approval")?.default).toBe("approved");
    expect(column(users, "approval")?.notNull).toBe(true);
  });
});

describe("blocks", () => {
  it("treats name plus street as the natural key", () => {
    expect(uniqueNames(blocks)).toContain("blocks_name_street_unique");
  });
});

describe("outing sessions", () => {
  it("permits at most one active session app-wide", () => {
    const activeIndex = config(outingSessions).indexes.find(
      (i) => i.config.name === "one_active_session_idx",
    );
    expect(activeIndex?.config.unique).toBe(true);
    // Partial, or it would allow only one session ever.
    expect(activeIndex?.config.where).toBeDefined();
  });

  it("starts life as a draft", () => {
    expect(column(outingSessions, "status")?.default).toBe("draft");
  });

  it("is a door-to-door session unless created as a follow-up", () => {
    // Existing rows and clients that send no kind keep working as before.
    expect(column(outingSessions, "kind")?.default).toBe("regular");
    expect(column(outingSessions, "kind")?.notNull).toBe(true);
  });

  it("refuses to lose the admin who created it", () => {
    expect(deleteActions(outingSessions)).toEqual({ created_by: "restrict" });
  });
});

describe("session blocks", () => {
  it("keys on session plus block, so attaching twice is impossible", () => {
    expect(config(sessionBlocks).primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      "session_id",
      "block_id",
    ]);
  });

  it("cascades when a session is deleted but protects the block", () => {
    expect(deleteActions(sessionBlocks)).toEqual({
      session_id: "cascade",
      block_id: "restrict",
    });
  });
});

describe("session households", () => {
  it("keys on session plus household, so picking twice is impossible", () => {
    expect(config(sessionHouseholds).primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      "session_id",
      "household_id",
    ]);
  });

  it("goes with its session or its household", () => {
    expect(deleteActions(sessionHouseholds)).toEqual({
      session_id: "cascade",
      household_id: "cascade",
    });
  });

  it("finds a household's sessions without a scan", () => {
    expect(indexNames(sessionHouseholds)).toEqual(["session_households_household_idx"]);
  });
});

describe("households", () => {
  it("is identified by block plus unit number", () => {
    // This is what makes a unit the same household across sessions.
    expect(uniqueNames(households)).toContain("households_block_unit_unique");
  });

  it("keeps every identity field nullable", () => {
    // A member may learn nothing at the door, and that must be recordable.
    for (const name of ["name", "contact", "religion"]) {
      expect(column(households, name)?.notNull, `${name} should be nullable`).toBe(false);
    }
  });

  it("requires a unit number", () => {
    expect(column(households, "unit_number")?.notNull).toBe(true);
  });

  it("refuses to delete a block that still has households", () => {
    expect(deleteActions(households)).toEqual({ block_id: "restrict" });
  });
});

describe("visits", () => {
  it("has no database default on its id", () => {
    /*
     * The client generates the UUIDv7. A database default would silently
     * create a second row when an offline write is replayed - the exact
     * failure the offline queue exists to prevent.
     */
    expect(column(visits, "id")?.hasDefault).toBe(false);
    expect(column(visits, "id")?.primary).toBe(true);
  });

  it("requires an interest level", () => {
    expect(column(visits, "interest_level")?.notNull).toBe(true);
  });

  it("separates when the device recorded it from when we received it", () => {
    expect(columnNames(visits)).toEqual(
      expect.arrayContaining(["client_created_at", "created_at", "updated_at"]),
    );
  });

  it("indexes household history, the main read path", () => {
    expect(indexNames(visits)).toContain("visits_household_created_idx");
  });

  /* As All records orders them (#252). A plain DESC puts nulls first; an
     index that puts them last cannot be read in that order, and the planner
     goes back to sorting every visit. */
  it("indexes All records' order, newest first with the id settling a tie", () => {
    const index = config(visits).indexes.find((i) => i.config.name === "visits_created_id_idx");
    expect(
      index?.config.columns.map((c) =>
        "indexConfig" in c ? { name: c.name, ...c.indexConfig } : undefined,
      ),
    ).toEqual([
      expect.objectContaining({ name: "created_at", order: "desc", nulls: "first" }),
      expect.objectContaining({ name: "id", order: "desc", nulls: "first" }),
    ]);
  });

  it("protects the session and member, and follows the household", () => {
    // Deleting a session or member must never silently erase field records.
    expect(deleteActions(visits)).toEqual({
      household_id: "cascade",
      session_id: "restrict",
      member_id: "restrict",
      team_id: "restrict",
    });
  });

  it("starts with no team and indexes the column history filters on", () => {
    expect(column(visits, "team_id")?.notNull).toBe(false);
    expect(indexNames(visits)).toContain("visits_team_idx");
  });
});

describe("participants and teams", () => {
  it("keeps participants with the outing, and the user protected", () => {
    expect(deleteActions(sessionParticipants)).toEqual({
      session_id: "cascade",
      user_id: "restrict",
    });
  });

  it("cannot lose a team that has an outing or author, nor an outing its teams", () => {
    expect(deleteActions(sessionTeams)).toEqual({
      session_id: "restrict",
      created_by: "restrict",
    });
  });

  it("follows the team on delete, and ties every member row to the team's own outing", () => {
    expect(deleteActions(sessionTeamMembers)).toEqual({
      user_id: "restrict",
      "team_id+session_id": "cascade",
    });
  });

  it("allows one team per member per outing", () => {
    expect(uniqueNames(sessionTeamMembers)).toContain("session_team_members_session_user_unique");
  });

  it("snapshots teammates with the visit and protects the user", () => {
    expect(deleteActions(visitTeammates)).toEqual({ visit_id: "cascade", user_id: "restrict" });
  });
});

describe("follow ups", () => {
  it("survives across sessions and outlives its originating visit", () => {
    /*
     * Attached to the household, so a note written in January is still there
     * in August. The visit link is set null rather than cascade: losing a
     * visit must not lose the promise made at the door.
     */
    expect(deleteActions(followUps)).toEqual({
      household_id: "cascade",
      visit_id: "set null",
      author_id: "restrict",
      done_by: "set null",
      done_visit_id: "set null",
      listed_by: "set null",
      deleted_by: "set null",
    });
  });

  it("indexes the outstanding-notes query", () => {
    expect(indexNames(followUps)).toContain("follow_ups_outstanding_idx");
  });

  it("indexes the notes a visit marked done, which its answer reads back", () => {
    expect(indexNames(followUps)).toContain("follow_ups_done_visit_idx");
  });

  it("reads notes written before suggestions existed as listed", () => {
    expect(column(followUps, "status")?.default).toBe("listed");
  });

  it("removes softly, keeping who removed it and why", () => {
    expect(columnNames(followUps)).toEqual(
      expect.arrayContaining(["deleted_at", "deleted_by", "delete_reason"]),
    );
  });

  it("allows one pending suggestion per household", () => {
    const pending = config(followUps).indexes.find(
      (i) => i.config.name === "follow_ups_one_open_suggestion_idx",
    );
    expect(pending?.config.unique).toBe(true);
    // Partial, or a household could never be suggested again after a review.
    expect(pending?.config.where).toBeDefined();
  });
});

describe("Auth.js adapter tables", () => {
  it("keys accounts on provider plus provider account id", () => {
    expect(config(accounts).primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      "provider",
      "provider_account_id",
    ]);
  });

  it("removes a user's linked accounts with the user", () => {
    expect(deleteActions(accounts)).toEqual({ user_id: "cascade" });
  });

  it("keeps the auth_sessions table the adapter contract requires", () => {
    /*
     * Unused at runtime - sessions are JWTs, because the Credentials provider
     * cannot use database sessions. The Drizzle adapter still requires it.
     */
    expect(columnNames(authSessions)).toEqual(
      expect.arrayContaining(["session_token", "user_id", "expires"]),
    );
    expect(deleteActions(authSessions)).toEqual({ user_id: "cascade" });
  });

  it("keys verification tokens on identifier plus token", () => {
    expect(config(verificationTokens).primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      "identifier",
      "token",
    ]);
  });
});

describe("sign-ins (#125)", () => {
  it("go with their user", () => {
    expect(deleteActions(signIns)).toEqual({ user_id: "cascade" });
  });

  it("are found by user, for the admin's list and the ends", () => {
    expect(indexNames(signIns)).toContain("sign_ins_user_idx");
  });

  it("let the server pick the id, which the token then names", () => {
    expect(column(signIns, "id")?.hasDefault).toBe(true);
    expect(column(signIns, "user_agent")?.notNull).toBe(false);
  });
});
