import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase, resetDatabase } from "@/db/client";
import { createTestPool, signedInAs, testSignInId, truncateAll } from "@/db/testing";

/*
 * The token below never changes: it still says "admin, not deactivated", as a
 * real JWT does until it expires, and names the same sign-in. Only the
 * database rows move, and the handlers must follow them on the very next
 * request (#83, #125).
 */
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { notFound, redirect } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock("next/navigation", () => ({ notFound, redirect }));

const me = await import("./users/me/route");
const visits = await import("./visits/route");
const sync = await import("./visits/sync/route");
const mine = await import("./history/mine/route");
const allHistory = await import("./history/route");
const usersRoute = await import("./users/route");
const sessionsRoute = await import("./sessions/route");
const followUps = await import("./follow-ups/route");
const blocksRoute = await import("./blocks/route");
const blockRoute = await import("./blocks/[id]/route");
const households = await import("./households/route");
const household = await import("./households/[id]/route");
const attention = await import("./households/attention/route");
const visitRoute = await import("./visits/[id]/route");
const followUp = await import("./follow-ups/[id]/route");
const followUpRemove = await import("./follow-ups/[id]/remove/route");
const mineSessions = await import("./history/mine/sessions/route");
const sessionRoute = await import("./sessions/[id]/route");
const start = await import("./sessions/[id]/start/route");
const end = await import("./sessions/[id]/end/route");
const reopen = await import("./sessions/[id]/reopen/route");
const sessionBlocks = await import("./sessions/[id]/blocks/route");
const sessionBlock = await import("./sessions/[id]/blocks/[blockId]/route");
const sessionHouseholds = await import("./sessions/[id]/households/route");
const sessionHousehold = await import("./sessions/[id]/households/[householdId]/route");
const activeSession = await import("./sessions/active/route");
const userRoute = await import("./users/[id]/route");
const participantsRoute = await import("./sessions/[id]/participants/route");
const joinRoute = await import("./sessions/[id]/join/route");
const sessionTeamsRoute = await import("./sessions/[id]/teams/route");
const teamRoute = await import("./teams/[id]/route");
const teamMembersRoute = await import("./teams/[id]/members/route");
const teamMemberRoute = await import("./teams/[id]/members/[userId]/route");
const { requireAdminPage } = await import("@/server/auth/pages");
const { updateUser } = await import("@/server/users/service");

const pool = createTestPool();
const USER = "f1f1f1f1-0000-4000-8000-000000000001";
const SESSION = "f1f1f1f1-0000-4000-8002-000000000001";
const BLOCK = "f1f1f1f1-0000-4000-8001-000000000001";

const json = (method: string, path: string, body?: unknown) =>
  new Request(`https://test.local/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

let seq = 0;
const visitBody = () => ({
  id: `01960000-0000-7000-8090-${String(++seq).padStart(12, "0")}`,
  blockId: BLOCK,
  unitNumber: "#01-01",
  interestLevel: "low",
});

type Call = () => Promise<Response>;
const memberCalls: [string, Call][] = [
  ["GET /users/me", () => me.GET(json("GET", "/users/me"))],
  ["PATCH /users/me", () => me.PATCH(json("PATCH", "/users/me", { name: "New Name" }))],
  ["GET /visits", () => visits.GET(json("GET", "/visits"))],
  ["POST /visits", () => visits.POST(json("POST", "/visits", visitBody()))],
  [
    "POST /visits/sync",
    () => {
      const now = new Date().toISOString();
      const items = [{ ...visitBody(), clientCreatedAt: now, updatedAt: now }];
      return sync.POST(json("POST", "/visits/sync", { items, sentAt: now }));
    },
  ],
  ["GET /history/mine", () => mine.GET(json("GET", "/history/mine"))],
  ["GET /follow-ups", () => followUps.GET(json("GET", "/follow-ups"))],
  ["GET /blocks", () => blocksRoute.GET(json("GET", "/blocks"))],
];
const adminCalls: [string, Call][] = [
  ["GET /users", () => usersRoute.GET(json("GET", "/users"))],
  ["GET /history", () => allHistory.GET(json("GET", "/history"))],
  ["POST /sessions", () => sessionsRoute.POST(json("POST", "/sessions", { title: "Outing" }))],
];

const deleteUser = async () => {
  await pool.query("delete from session_blocks");
  await pool.query("delete from outing_sessions");
  await pool.query("delete from users where id = $1", [USER]);
};

const OTHER = "f1f1f1f1-0000-4000-8000-000000000002";
const withId = <T extends { id: string }>(id: string, extra?: Omit<T, "id">) => ({
  params: Promise.resolve({ id, ...extra }),
});

/* Minimal valid input, so validation (which runs first) cannot mask the guard. */
const extraMemberCalls: [string, Call][] = [
  ["GET /households", () => households.GET(json("GET", `/households?blockId=${BLOCK}`))],
  ["GET /households/{id}", () => household.GET(json("GET", `/households/${OTHER}`), withId(OTHER))],
  [
    "PATCH /visits/{id}",
    () => visitRoute.PATCH(json("PATCH", `/visits/${OTHER}`, { description: "x" }), withId(OTHER)),
  ],
  [
    "PATCH /follow-ups/{id}",
    () => followUp.PATCH(json("PATCH", `/follow-ups/${OTHER}`, { done: true }), withId(OTHER)),
  ],
  [
    "POST /follow-ups/{id}/remove",
    () =>
      followUpRemove.POST(
        json("POST", `/follow-ups/${OTHER}/remove`, { reason: "Moved away" }),
        withId(OTHER),
      ),
  ],
  ["GET /history/mine/sessions", () => mineSessions.GET(json("GET", "/history/mine/sessions"))],
  ["GET /sessions/active", () => activeSession.GET(json("GET", "/sessions/active"))],
  [
    "GET /sessions/{id}/blocks",
    () => sessionBlocks.GET(json("GET", `/sessions/${SESSION}/blocks`), withId(SESSION)),
  ],
];
const extraAdminCalls: [string, Call][] = [
  ["POST /blocks", () => blocksRoute.POST(json("POST", "/blocks", { name: "9", street: "Elm" }))],
  [
    "PATCH /blocks/{id}",
    () => blockRoute.PATCH(json("PATCH", `/blocks/${BLOCK}`, { name: "7" }), withId(BLOCK)),
  ],
  ["GET /households/attention", () => attention.GET(json("GET", "/households/attention"))],
  ["GET /sessions", () => sessionsRoute.GET(json("GET", "/sessions"))],
  [
    "GET /sessions/{id}",
    () => sessionRoute.GET(json("GET", `/sessions/${SESSION}`), withId(SESSION)),
  ],
  [
    "POST /sessions/{id}/start",
    () => start.POST(json("POST", `/sessions/${SESSION}/start`), withId(SESSION)),
  ],
  [
    "POST /sessions/{id}/end",
    () => end.POST(json("POST", `/sessions/${SESSION}/end`), withId(SESSION)),
  ],
  [
    "POST /sessions/{id}/reopen",
    () => reopen.POST(json("POST", `/sessions/${SESSION}/reopen`), withId(SESSION)),
  ],
  [
    "POST /sessions/{id}/blocks",
    () =>
      sessionBlocks.POST(
        json("POST", `/sessions/${SESSION}/blocks`, { blockIds: [BLOCK] }),
        withId(SESSION),
      ),
  ],
  [
    "DELETE /sessions/{id}/blocks/{blockId}",
    () =>
      sessionBlock.DELETE(json("DELETE", `/sessions/${SESSION}/blocks/${BLOCK}`), {
        params: Promise.resolve({ id: SESSION, blockId: BLOCK }),
      }),
  ],
  [
    "GET /sessions/{id}/households",
    () => sessionHouseholds.GET(json("GET", `/sessions/${SESSION}/households`), withId(SESSION)),
  ],
  [
    "POST /sessions/{id}/households",
    () =>
      sessionHouseholds.POST(
        json("POST", `/sessions/${SESSION}/households`, { householdIds: [OTHER] }),
        withId(SESSION),
      ),
  ],
  [
    "DELETE /sessions/{id}/households/{householdId}",
    () =>
      sessionHousehold.DELETE(json("DELETE", `/sessions/${SESSION}/households/${OTHER}`), {
        params: Promise.resolve({ id: SESSION, householdId: OTHER }),
      }),
  ],
  [
    "PATCH /users/{id}",
    () => userRoute.PATCH(json("PATCH", `/users/${OTHER}`, { deactivated: true }), withId(OTHER)),
  ],
  [
    "POST /users",
    () =>
      usersRoute.POST(
        json("POST", "/users", { email: "new@t.local", password: "correct-horse-1" }),
      ),
  ],
];

const TEAM = "f1f1f1f1-0000-4000-8004-000000000001";
const DRAFT = "f1f1f1f1-0000-4000-8002-000000000002";
const THIRD = "f1f1f1f1-0000-4000-8000-000000000003";

/* Valid input throughout, so validation (which runs first) cannot mask the guard. */
const teamCalls: [string, Call][] = [
  [
    "GET /sessions/{id}/participants",
    () => participantsRoute.GET(json("GET", `/sessions/${SESSION}/participants`), withId(SESSION)),
  ],
  [
    "POST /sessions/{id}/join",
    () => joinRoute.POST(json("POST", `/sessions/${SESSION}/join`), withId(SESSION)),
  ],
  [
    "GET /sessions/{id}/teams",
    () => sessionTeamsRoute.GET(json("GET", `/sessions/${SESSION}/teams`), withId(SESSION)),
  ],
  [
    "POST /sessions/{id}/teams",
    () =>
      sessionTeamsRoute.POST(
        json("POST", `/sessions/${SESSION}/teams`, { name: "New" }),
        withId(SESSION),
      ),
  ],
  [
    "PATCH /teams/{id}",
    () => teamRoute.PATCH(json("PATCH", `/teams/${TEAM}`, { name: "Renamed" }), withId(TEAM)),
  ],
  ["DELETE /teams/{id}", () => teamRoute.DELETE(json("DELETE", `/teams/${TEAM}`), withId(TEAM))],
  [
    "POST /teams/{id}/members",
    () =>
      teamMembersRoute.POST(
        json("POST", `/teams/${TEAM}/members`, { userId: THIRD }),
        withId(TEAM),
      ),
  ],
  [
    "DELETE /teams/{id}/members/{userId}",
    () =>
      teamMemberRoute.DELETE(json("DELETE", `/teams/${TEAM}/members/${OTHER}`), {
        params: Promise.resolve({ id: TEAM, userId: OTHER }),
      }),
  ],
];

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'u@t.local','User','admin')`,
    [USER],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'1','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Live','active',$2)`,
    [SESSION, USER],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  auth.mockReset();
  // Resolved once, as a real token: an ended sign-in stays ended.
  auth.mockResolvedValue(await signedInAs(pool, { id: USER, role: "admin" }));
});

const SECOND_ADMIN = "f1f1f1f1-0000-4000-8000-0000000000aa";

/* As an admin does on Team: through the service, which ends the sign-ins too. */
const setDeactivated = async (deactivated: boolean) => {
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES ($1,'a2@t.local','Second','admin')
     ON CONFLICT (id) DO NOTHING`,
    [SECOND_ADMIN],
  );
  await updateUser(getDatabase(), USER, { deactivated }, SECOND_ADMIN);
};

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("a deactivated account, holding the same token", () => {
  it.each([...memberCalls, ...adminCalls])(
    "%s works, then 403s once deactivated",
    async (_n, call) => {
      const first = await call();
      expect(first.status, await first.clone().text()).toBeLessThan(300);

      await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
      const response = await call();
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("account_deactivated");
    },
  );

  it("changes nothing when a deactivated account tries to write", async () => {
    await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
    await me.PATCH(json("PATCH", "/users/me", { name: "Hijack" }));
    await visits.POST(json("POST", "/visits", visitBody()));

    const { rows } = await pool.query<{ name: string; visits: string }>(
      "select name, (select count(*) from visits) as visits from users where id = $1",
      [USER],
    );
    expect(rows[0]).toEqual({ name: "User", visits: "0" });
  });

  it("is signed out once reactivated: deactivating ended its sign-in (#125)", async () => {
    await setDeactivated(true);
    const deactivated = await me.GET(json("GET", "/users/me"));
    expect(deactivated.status).toBe(403);
    expect(await errorCode(deactivated)).toBe("account_deactivated");

    await setDeactivated(false);
    const reactivated = await me.GET(json("GET", "/users/me"));
    expect(reactivated.status).toBe(401);
    expect(await errorCode(reactivated)).toBe("unauthenticated");
  });
});

describe("an ended sign-in, holding the same token (#125)", () => {
  const endIt = () => pool.query("delete from sign_ins where id = $1", [testSignInId(USER)]);

  it.each([...memberCalls, ...adminCalls, ...extraMemberCalls, ...extraAdminCalls])(
    "%s is 401 unauthenticated",
    async (_n, call) => {
      await endIt();
      const response = await call();
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("unauthenticated");
    },
  );

  it("changes nothing when an ended sign-in tries to write", async () => {
    await endIt();
    await me.PATCH(json("PATCH", "/users/me", { name: "Hijack" }));
    await visits.POST(json("POST", "/visits", visitBody()));

    const { rows } = await pool.query<{ name: string; visits: string }>(
      "select name, (select count(*) from visits) as visits from users where id = $1",
      [USER],
    );
    expect(rows[0]).toEqual({ name: "User", visits: "0" });
  });

  it("leaves the member's other sign-ins working", async () => {
    const other = await pool.query<{ id: string }>(
      "insert into sign_ins (user_id) values ($1) returning id",
      [USER],
    );
    await endIt();
    // The same member, on their other phone.
    auth.mockResolvedValueOnce({
      user: { id: USER, role: "admin", deactivated: false },
      signInId: other.rows[0]?.id,
    });
    expect((await me.GET(json("GET", "/users/me"))).status).toBe(200);
    expect((await me.GET(json("GET", "/users/me"))).status).toBe(401);
  });

  it("is sent from the admin pages to sign in", async () => {
    await endIt();
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT /sign-in?reason=signed-out");
  });
});

describe("a token from before sign-ins were recorded (#125)", () => {
  it("is 401: everyone signs in once more", async () => {
    auth.mockResolvedValue({ user: { id: USER, role: "admin", deactivated: false } });
    const response = await me.GET(json("GET", "/users/me"));
    expect(response.status).toBe(401);
  });

  it("still tells a deactivated member so, rather than signed out", async () => {
    auth.mockResolvedValue({ user: { id: USER, role: "admin", deactivated: false } });
    await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
    const response = await me.GET(json("GET", "/users/me"));
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("account_deactivated");
  });
});

describe("a demoted admin, holding the same token", () => {
  it.each(adminCalls)("%s is 403 forbidden once demoted", async (_n, call) => {
    const first = await call();
    expect(first.status, await first.clone().text()).toBeLessThan(300);

    await pool.query("update users set role = 'member' where id = $1", [USER]);
    const response = await call();
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
  });

  it("is a member for scoped listings too", async () => {
    await pool.query("update users set role = 'member' where id = $1", [USER]);
    const other = "f1f1f1f1-0000-4000-8000-000000000002";
    expect((await visits.GET(json("GET", `/visits?memberId=${other}`))).status).toBe(403);
  });

  it("is hidden the admin pages", async () => {
    await expect(requireAdminPage()).resolves.toBeUndefined();

    await pool.query("update users set role = 'member' where id = $1", [USER]);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("hides the admin pages from a deactivated admin, and sends them to sign in once reactivated", async () => {
    await setDeactivated(true);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await setDeactivated(false);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT /sign-in?reason=signed-out");
  });
});

describe("a promoted member, holding the same token", () => {
  it("gains admin rights immediately", async () => {
    await pool.query("update users set role = 'member' where id = $1", [USER]);
    expect((await usersRoute.GET(json("GET", "/users"))).status).toBe(403);
    await pool.query("update users set role = 'admin' where id = $1", [USER]);
    expect((await usersRoute.GET(json("GET", "/users"))).status).toBe(200);
  });
});

describe("a deleted account, holding the same token", () => {
  it.each([...memberCalls, ...adminCalls])("%s is 401 unauthenticated", async (_n, call) => {
    await deleteUser();
    const response = await call();
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthenticated");
  });

  it("is sent from the admin pages to sign in", async () => {
    await deleteUser();
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT /sign-in?reason=signed-out");
  });
});

describe("when the database lookup fails", () => {
  it("answers 500, never allowed", async () => {
    const { getPool } = await import("@/db/client");
    const live = getPool();
    const broken = vi.spyOn(live, "query").mockRejectedValue(new Error("connection lost"));
    try {
      const response = await usersRoute.GET(json("GET", "/users"));
      expect(response.status).toBe(500);
    } finally {
      broken.mockRestore();
    }
  });
});

describe("every remaining handler, holding the same token", () => {
  beforeEach(async () => {
    await pool.query(
      `INSERT INTO users (id, email, name, role) VALUES ($1,'o@t.local','Other','member')`,
      [OTHER],
    );
  });

  it.each([...extraMemberCalls, ...extraAdminCalls])(
    "%s is 403 account_deactivated once deactivated",
    async (_n, call) => {
      await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
      const response = await call();
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("account_deactivated");
    },
  );

  it.each([...extraMemberCalls, ...extraAdminCalls])(
    "%s is 401 once the account is deleted",
    async (_n, call) => {
      await deleteUser();
      const response = await call();
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("unauthenticated");
    },
  );

  it.each(extraAdminCalls)("%s is 403 forbidden once demoted", async (_n, call) => {
    await pool.query("update users set role = 'member' where id = $1", [USER]);
    const response = await call();
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
  });

  it("stops a just-demoted admin changing anyone before the service runs", async () => {
    await pool.query("update users set role = 'member' where id = $1", [USER]);
    const response = await userRoute.PATCH(
      json("PATCH", `/users/${OTHER}`, { deactivated: true }),
      withId(OTHER),
    );
    expect(response.status).toBe(403);
    const { rows } = await pool.query<{ deactivated_at: Date | null }>(
      "select deactivated_at from users where id = $1",
      [OTHER],
    );
    expect(rows[0]?.deactivated_at).toBeNull();
  });

  it("still refuses an admin demoting or deactivating themselves (D-31-5)", async () => {
    for (const body of [{ role: "member" }, { deactivated: true }]) {
      const response = await userRoute.PATCH(json("PATCH", `/users/${USER}`, body), withId(USER));
      expect(response.status).toBe(409);
    }
    const { rows } = await pool.query<{ role: string }>("select role from users where id = $1", [
      USER,
    ]);
    expect(rows[0]?.role).toBe("admin");
  });
});

describe("cost of resolving the caller", () => {
  async function usersQueries(call: Call): Promise<number> {
    const { getPool } = await import("@/db/client");
    const spy = vi.spyOn(getPool(), "query");
    try {
      await call();
      return spy.mock.calls.filter(([q]) => {
        const text = typeof q === "string" ? q : (q as { text?: string }).text;
        return text?.includes('from "users"') === true;
      }).length;
    } finally {
      spy.mockRestore();
    }
  }

  it("is one primary-key lookup for a handler that does not load the user", async () => {
    expect(await usersQueries(() => blocksRoute.GET(json("GET", "/blocks")))).toBe(1);
  });

  it("is two on GET /users/me, which also loads the profile", async () => {
    expect(await usersQueries(() => me.GET(json("GET", "/users/me")))).toBe(2);
  });
});

describe("teams and participants, holding the same token", () => {
  beforeEach(async () => {
    await pool.query(
      `INSERT INTO users (id, email, name, role) VALUES
        ($1,'o@t.local','Other','member'), ($2,'t@t.local','Third','member')`,
      [OTHER, THIRD],
    );
    await pool.query(
      `INSERT INTO outing_sessions (id, title, status, created_by) VALUES ($1,'Soon','draft',$2)`,
      [DRAFT, USER],
    );
    await pool.query(
      `INSERT INTO session_teams (id, session_id, name, created_by) VALUES ($1,$2,'Pair',$3)`,
      [TEAM, SESSION, USER],
    );
    await pool.query(
      `INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3)`,
      [TEAM, SESSION, OTHER],
    );
  });

  it.each(teamCalls)("%s works, then 403s once deactivated", async (_n, call) => {
    const first = await call();
    expect(first.status, await first.clone().text()).toBeLessThan(300);

    await pool.query("update users set deactivated_at = now() where id = $1", [USER]);
    const response = await call();
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("account_deactivated");
  });

  it("is signed out once reactivated (#125)", async () => {
    await setDeactivated(true);
    expect((await teamCalls[0]?.[1]())?.status).toBe(403);
    await setDeactivated(false);
    expect((await teamCalls[0]?.[1]())?.status).toBe(401);
  });

  it.each(teamCalls)("%s is 401 once the account is deleted", async (_n, call) => {
    await pool.query("delete from session_team_members");
    await pool.query("delete from session_teams");
    await deleteUser();
    const response = await call();
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthenticated");
  });

  it("stops a demoted admin reading a draft outing, and joining or forming on it", async () => {
    const read = () =>
      participantsRoute.GET(json("GET", `/sessions/${DRAFT}/participants`), withId(DRAFT));
    const joinDraft = () => joinRoute.POST(json("POST", `/sessions/${DRAFT}/join`), withId(DRAFT));
    const formOnDraft = () =>
      sessionTeamsRoute.POST(
        json("POST", `/sessions/${DRAFT}/teams`, { name: "Plan" }),
        withId(DRAFT),
      );

    expect((await read()).status).toBe(200);
    await pool.query("update users set role = 'member' where id = $1", [USER]);

    expect((await read()).status).toBe(403);
    for (const attempt of [joinDraft, formOnDraft]) {
      const response = await attempt();
      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("session_not_active");
    }
    const { rows } = await pool.query<{ n: string }>(
      "select (select count(*) from session_participants where session_id = $1) as n",
      [DRAFT],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it.each(teamCalls.filter(([name]) => name.includes("/teams/{id}")))(
    "%s is 403 forbidden for a demoted admin who is not on the team, changing nothing",
    async (_n, call) => {
      await pool.query("update users set role = 'member' where id = $1", [USER]);
      const response = await call();
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("forbidden");

      const { rows } = await pool.query<{ name: string; members: string }>(
        "select name, (select count(*) from session_team_members) as members from session_teams",
      );
      expect(rows).toEqual([{ name: "Pair", members: "1" }]);
    },
  );
});
