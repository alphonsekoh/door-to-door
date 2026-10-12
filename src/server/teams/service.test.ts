import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { ConflictError } from "@/server/http/errors";
import { addTeamMember, createTeam, deleteTeam } from "@/server/teams/service";

/*
 * A lost race on a unique index cannot be provoked on demand against a real
 * database, so these feed the service the errors Postgres would raise. What
 * matters is the mapping: a named constraint becomes a conflict a client can
 * explain, and anything else is never swallowed.
 */

const ADMIN = { id: "u-admin", role: "admin" as const };

/* Every query-builder method returns the same awaitable, resolving to `run()`. */
function builder(run: () => Promise<unknown>): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === "then"
          ? (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              run().then(resolve, reject)
          : () => proxy,
    },
  );
  return proxy;
}

const raised = (constraint?: string) =>
  Object.assign(new Error("raised"), constraint === undefined ? {} : { constraint });

function stubDb(handlers: { select: unknown[]; transaction?: Error; delete?: Error }): Database {
  const queue = [...handlers.select];
  return {
    select: () => builder(() => Promise.resolve(queue.shift())),
    delete: () => builder(() => Promise.reject(handlers.delete ?? new Error("unexpected delete"))),
    transaction: () => Promise.reject(handlers.transaction ?? new Error("unexpected transaction")),
  } as unknown as Database;
}

const activeSession = [{ id: "s1", status: "active" }];

describe("creating a team when the database refuses the placement", () => {
  it.each(["session_team_members_session_user_unique", "session_team_members_team_id_user_id_pk"])(
    "reports %s as a conflict",
    async (constraint) => {
      const db = stubDb({ select: [activeSession], transaction: raised(constraint) });
      await expect(createTeam(db, ADMIN, "s1", { name: "Pair" })).rejects.toBeInstanceOf(
        ConflictError,
      );
    },
  );

  it("does not disguise an unrelated failure as a conflict", async () => {
    const failure = raised("something_else");
    const db = stubDb({ select: [activeSession], transaction: failure });
    await expect(createTeam(db, ADMIN, "s1", { name: "Pair" })).rejects.toBe(failure);
  });
});

describe("adding a member when the database refuses the placement", () => {
  const teamRow = [{ id: "t1", sessionId: "s1", status: "active" }];
  const person = [{ id: "u2", deactivatedAt: null }];

  it("reports a lost race as a conflict", async () => {
    const db = stubDb({
      select: [teamRow, person, []],
      transaction: raised("session_team_members_session_user_unique"),
    });
    await expect(addTeamMember(db, ADMIN, "t1", "u2")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("disbanding a team when the database refuses", () => {
  const teamRow = [{ id: "t1", sessionId: "s1", status: "active" }];

  it("reports stamped records as a conflict", async () => {
    const db = stubDb({ select: [teamRow], delete: raised("visits_team_id_session_teams_id_fk") });
    await expect(deleteTeam(db, ADMIN, "t1")).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not disguise an unrelated failure as a conflict", async () => {
    const failure = raised();
    const db = stubDb({ select: [teamRow], delete: failure });
    await expect(deleteTeam(db, ADMIN, "t1")).rejects.toBe(failure);
  });
});
