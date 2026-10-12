import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/../auth", () => ({ auth }));

const { GET: listParticipants } = await import("../sessions/[id]/participants/route");
const { POST: join } = await import("../sessions/[id]/join/route");
const { GET: listTeams, POST: createTeam } = await import("../sessions/[id]/teams/route");
const { PATCH: updateTeam, DELETE: deleteTeam } = await import("./[id]/route");
const { POST: addMember } = await import("./[id]/members/route");
const { DELETE: removeMember } = await import("./[id]/members/[userId]/route");

const pool = createTestPool();
const ADMIN = "74747474-0000-4000-8000-000000000001";
const ALICE = "74747474-0000-4000-8000-000000000002";
const BEN = "74747474-0000-4000-8000-000000000003";
const CARA = "74747474-0000-4000-8000-000000000004";
const DAN = "74747474-0000-4000-8000-000000000005";
const GONE = "74747474-0000-4000-8000-000000000006";
const NOBODY = "74747474-0000-4000-8000-0000000000ff";
const BLOCK = "74747474-0000-4000-8001-000000000001";
const ACTIVE = "74747474-0000-4000-8002-000000000001";
const DRAFT = "74747474-0000-4000-8002-000000000002";
const ENDED = "74747474-0000-4000-8002-000000000003";
const MISSING = "74747474-0000-4000-8002-0000000000ff";

const as = (id: string, role: "admin" | "member" = "member") =>
  auth.mockResolvedValue({ user: { id, role, deactivated: false } });
const asAdmin = () => as(ADMIN, "admin");

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(
  handler: unknown,
  method: string,
  params: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return (handler as Handler)(
    new Request("https://test.local/api", {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    }),
    { params: Promise.resolve(params as never) },
  );
}

type TeamBody = { id: string; sessionId: string; name: string; members: { id: string }[] };
type ErrorBody = { error: { code: string } };

const memberIds = (team: TeamBody) => team.members.map((m) => m.id).sort();
const errorCode = async (response: Response) => ((await response.json()) as ErrorBody).error.code;

async function makeTeam(
  sessionId: string,
  name: string,
  userIds: string[],
  at: Date = new Date(),
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO session_teams (session_id, name, created_by, created_at) VALUES ($1,$2,$3,$4) RETURNING id`,
    [sessionId, name, ADMIN, at],
  );
  const id = rows[0]?.id ?? "";
  for (const userId of userIds) {
    await pool.query(
      `INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3)`,
      [id, sessionId, userId],
    );
    await pool.query(
      `INSERT INTO session_participants (session_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [sessionId, userId],
    );
  }
  return id;
}

const participate = (sessionId: string, ...userIds: string[]) =>
  Promise.all(
    userIds.map((userId) =>
      pool.query(`INSERT INTO session_participants (session_id, user_id) VALUES ($1,$2)`, [
        sessionId,
        userId,
      ]),
    ),
  );

const count = async (table: string): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
};

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role, deactivated_at) VALUES
      ($1,'a@t.local','Admin','admin',null), ($2,'alice@t.local','Alice','member',null),
      ($3,'ben@t.local','Ben','member',null), ($4,'cara@t.local','Cara','member',null),
      ($5,'dan@t.local','Dan','member',null), ($6,'gone@t.local','Gone','member',now())`,
    [ADMIN, ALICE, BEN, CARA, DAN, GONE],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at) VALUES
      ($1,'Live','active',$4,now()), ($2,'Soon','draft',$4,null), ($3,'Over','ended',$4,now())`,
    [ACTIVE, DRAFT, ENDED, ADMIN],
  );
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("joining an outing", () => {
  it("lets a member join the active outing as themselves", async () => {
    as(ALICE);
    const response = await call(join, "POST", { id: ACTIVE });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: ALICE, name: "Alice" },
      teamId: null,
    });
  });

  it("is idempotent: joining twice keeps one row and the first join time", async () => {
    as(ALICE);
    const first = (await (await call(join, "POST", { id: ACTIVE })).json()) as { joinedAt: string };
    const second = (await (await call(join, "POST", { id: ACTIVE })).json()) as {
      joinedAt: string;
    };
    expect(await count("session_participants")).toBe(1);
    expect(second.joinedAt).toBe(first.joinedAt);
  });

  it("reports the team the caller is already on", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    as(ALICE);
    expect(await (await call(join, "POST", { id: ACTIVE })).json()).toMatchObject({ teamId: team });
  });

  it("refuses a member a draft outing, but not an admin", async () => {
    as(ALICE);
    const refused = await call(join, "POST", { id: DRAFT });
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe("session_not_active");
    expect(await count("session_participants")).toBe(0);

    asAdmin();
    expect((await call(join, "POST", { id: DRAFT })).status).toBe(200);
    expect(await count("session_participants")).toBe(1);
  });

  it("refuses everyone an ended outing", async () => {
    as(ALICE);
    expect(await errorCode(await call(join, "POST", { id: ENDED }))).toBe("session_not_active");
    asAdmin();
    expect(await errorCode(await call(join, "POST", { id: ENDED }))).toBe("session_not_active");
  });

  it("is 404 for an unknown outing and 401 when signed out", async () => {
    as(ALICE);
    expect((await call(join, "POST", { id: MISSING })).status).toBe(404);
    auth.mockResolvedValue(null);
    expect((await call(join, "POST", { id: ACTIVE })).status).toBe(401);
  });
});

describe("reading participants and teams", () => {
  it("shows a member the active outing's participants with their teams", async () => {
    await makeTeam(ACTIVE, "Pair", [ALICE, BEN]);
    await participate(ACTIVE, CARA);
    as(CARA);
    const response = await call(listParticipants, "GET", { id: ACTIVE });
    const body = (await response.json()) as {
      data: { user: { id: string }; teamId: string | null }[];
    };
    expect(response.status).toBe(200);
    expect(body.data.map((p) => [p.user.id, p.teamId !== null]).sort()).toEqual(
      [
        [ALICE, true],
        [BEN, true],
        [CARA, false],
      ].sort(),
    );
  });

  it("shows teams with their current members", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE, BEN]);
    as(CARA);
    const body = (await (await call(listTeams, "GET", { id: ACTIVE })).json()) as {
      data: TeamBody[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: team, name: "Pair", sessionId: ACTIVE });
    expect(body.data.map(memberIds)).toEqual([[ALICE, BEN].sort()]);
  });

  it("leaves a deactivated person out of participants and of a team's live members", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE, GONE]);
    as(ALICE);
    const people = (await (await call(listParticipants, "GET", { id: ACTIVE })).json()) as {
      data: { user: { id: string } }[];
    };
    expect(people.data.map((p) => p.user.id)).toEqual([ALICE]);

    const teams = (await (await call(listTeams, "GET", { id: ACTIVE })).json()) as {
      data: TeamBody[];
    };
    expect(teams.data.map(memberIds)).toEqual([[ALICE]]);

    const renamed = await call(updateTeam, "PATCH", { id: team }, { name: "Renamed" });
    expect(memberIds((await renamed.json()) as TeamBody)).toEqual([ALICE]);
  });

  it("lists no teams as an empty array", async () => {
    as(ALICE);
    expect(await (await call(listTeams, "GET", { id: ACTIVE })).json()).toEqual({ data: [] });
  });

  it.each([DRAFT, ENDED])("keeps outing %s from members (403)", async (id) => {
    as(ALICE);
    expect((await call(listParticipants, "GET", { id })).status).toBe(403);
    expect((await call(listTeams, "GET", { id })).status).toBe(403);
  });

  it("lets an admin read any outing", async () => {
    await makeTeam(ENDED, "Old", [ALICE]);
    asAdmin();
    expect((await call(listParticipants, "GET", { id: DRAFT })).status).toBe(200);
    const body = (await (await call(listTeams, "GET", { id: ENDED })).json()) as {
      data: TeamBody[];
    };
    expect(body.data.map((t) => t.name)).toEqual(["Old"]);
  });

  it("is 404 for an unknown outing", async () => {
    asAdmin();
    expect((await call(listParticipants, "GET", { id: MISSING })).status).toBe(404);
    expect((await call(listTeams, "GET", { id: MISSING })).status).toBe(404);
  });
});

describe("forming a team", () => {
  it("places the member who forms it, and anyone who has joined", async () => {
    await participate(ACTIVE, BEN);
    as(ALICE);
    const response = await call(
      createTeam,
      "POST",
      { id: ACTIVE },
      { name: " Pair 1 ", memberIds: [BEN] },
    );
    expect(response.status).toBe(201);
    const team = (await response.json()) as TeamBody;
    expect(team.name).toBe("Pair 1");
    expect(memberIds(team)).toEqual([ALICE, BEN].sort());
    // The creator became a participant by forming it.
    expect(await count("session_participants")).toBe(2);
  });

  it("places a member who names only themselves, once", async () => {
    as(ALICE);
    const response = await call(
      createTeam,
      "POST",
      { id: ACTIVE },
      { name: "Solo", memberIds: [ALICE] },
    );
    expect(memberIds((await response.json()) as TeamBody)).toEqual([ALICE]);
  });

  it("refuses a member someone who has not joined (409 conflict)", async () => {
    as(ALICE);
    const response = await call(
      createTeam,
      "POST",
      { id: ACTIVE },
      { name: "Pair", memberIds: [BEN] },
    );
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("conflict");
    expect(await count("session_teams")).toBe(0);
  });

  it("lets an admin form a team on a draft without placing themselves", async () => {
    asAdmin();
    const response = await call(
      createTeam,
      "POST",
      { id: DRAFT },
      { name: "Plan", memberIds: [ALICE] },
    );
    expect(response.status).toBe(201);
    expect(memberIds((await response.json()) as TeamBody)).toEqual([ALICE]);
    // Anyone an admin places becomes a participant, even if never joined.
    const { rows } = await pool.query(
      `SELECT user_id FROM session_participants WHERE session_id=$1`,
      [DRAFT],
    );
    expect(rows).toEqual([{ user_id: ALICE }]);
  });

  it("lets an admin form an empty team, and place themselves by listing themselves", async () => {
    asAdmin();
    const empty = await call(createTeam, "POST", { id: ACTIVE }, { name: "Empty" });
    expect(memberIds((await empty.json()) as TeamBody)).toEqual([]);
    const self = await call(
      createTeam,
      "POST",
      { id: ACTIVE },
      { name: "Mine", memberIds: [ADMIN] },
    );
    expect(memberIds((await self.json()) as TeamBody)).toEqual([ADMIN]);
  });

  it("refuses a member a draft outing (409 session_not_active)", async () => {
    as(ALICE);
    const response = await call(createTeam, "POST", { id: DRAFT }, { name: "Pair" });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("session_not_active");
  });

  it("refuses everyone an ended outing", async () => {
    as(ALICE);
    expect(await errorCode(await call(createTeam, "POST", { id: ENDED }, { name: "Pair" }))).toBe(
      "session_not_active",
    );
    asAdmin();
    expect(await errorCode(await call(createTeam, "POST", { id: ENDED }, { name: "Pair" }))).toBe(
      "session_not_active",
    );
  });

  it("refuses a deactivated person", async () => {
    asAdmin();
    const response = await call(
      createTeam,
      "POST",
      { id: ACTIVE },
      { name: "Pair", memberIds: [GONE] },
    );
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("conflict");
  });

  it("refuses someone already on a team that outing, and says so for the caller", async () => {
    await makeTeam(ACTIVE, "Taken", [BEN, ALICE]);
    await participate(ACTIVE, CARA);
    as(CARA);
    const other = await call(
      createTeam,
      "POST",
      { id: ACTIVE },
      { name: "Pair", memberIds: [BEN] },
    );
    expect(other.status).toBe(409);

    as(ALICE);
    const self = await call(createTeam, "POST", { id: ACTIVE }, { name: "Pair" });
    expect(self.status).toBe(409);
    expect(((await self.json()) as { error: { message: string } }).error.message).toMatch(
      /You are already/,
    );
    expect(await count("session_teams")).toBe(1);
  });

  it("lets someone be on a team in each of two outings", async () => {
    await makeTeam(ENDED, "Last time", [ALICE]);
    as(ALICE);
    expect((await call(createTeam, "POST", { id: ACTIVE }, { name: "Now" })).status).toBe(201);
  });

  it("is 404 for an unknown person or outing", async () => {
    asAdmin();
    expect(
      (await call(createTeam, "POST", { id: ACTIVE }, { name: "Pair", memberIds: [NOBODY] }))
        .status,
    ).toBe(404);
    expect((await call(createTeam, "POST", { id: MISSING }, { name: "Pair" })).status).toBe(404);
  });

  it.each([["   "], ["Pair​1"], ["..."], ["x".repeat(61)]])(
    "refuses the name %j (400)",
    async (name) => {
      as(ALICE);
      expect((await call(createTeam, "POST", { id: ACTIVE }, { name })).status).toBe(400);
      expect(await count("session_teams")).toBe(0);
    },
  );

  it("ends with one team and no stray rows when two requests race (the loser is refused by the pre-check or the index, depending on interleaving)", async () => {
    as(ALICE);
    const results = await Promise.all([
      call(createTeam, "POST", { id: ACTIVE }, { name: "One" }),
      call(createTeam, "POST", { id: ACTIVE }, { name: "Two" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await count("session_teams")).toBe(1);
    expect(await count("session_team_members")).toBe(1);
  });
});

describe("changing a team", () => {
  it("lets a member rename their own team", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE, BEN]);
    as(BEN);
    const response = await call(updateTeam, "PATCH", { id: team }, { name: " Renamed " });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Renamed" });
  });

  it("refuses a stranger every change (403), leaving the team as it was", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE, BEN]);
    await participate(ACTIVE, DAN);
    as(CARA);
    expect((await call(updateTeam, "PATCH", { id: team }, { name: "Mine" })).status).toBe(403);
    expect((await call(deleteTeam, "DELETE", { id: team })).status).toBe(403);
    expect((await call(addMember, "POST", { id: team }, { userId: DAN })).status).toBe(403);
    expect((await call(removeMember, "DELETE", { id: team, userId: ALICE })).status).toBe(403);
    expect((await call(removeMember, "DELETE", { id: team, userId: CARA })).status).toBe(403);
    const { rows } = await pool.query(`SELECT name FROM session_teams WHERE id=$1`, [team]);
    expect(rows).toEqual([{ name: "Pair" }]);
    expect(await count("session_team_members")).toBe(2);
  });

  it("is 404 for an unknown team, whoever asks", async () => {
    as(ALICE);
    expect((await call(updateTeam, "PATCH", { id: MISSING }, { name: "x" })).status).toBe(404);
    expect((await call(deleteTeam, "DELETE", { id: MISSING })).status).toBe(404);
    asAdmin();
    expect((await call(addMember, "POST", { id: MISSING }, { userId: ALICE })).status).toBe(404);
    expect((await call(removeMember, "DELETE", { id: MISSING, userId: ALICE })).status).toBe(404);
  });

  it("lets an admin fix a team on an ended outing, but not a member", async () => {
    const team = await makeTeam(ENDED, "Old", [ALICE]);
    as(ALICE);
    const refused = await call(updateTeam, "PATCH", { id: team }, { name: "New" });
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe("session_not_active");
    expect((await call(deleteTeam, "DELETE", { id: team })).status).toBe(409);
    expect((await call(removeMember, "DELETE", { id: team, userId: ALICE })).status).toBe(409);
    expect((await call(addMember, "POST", { id: team }, { userId: BEN })).status).toBe(409);

    asAdmin();
    expect((await call(updateTeam, "PATCH", { id: team }, { name: "New" })).status).toBe(200);
  });

  it("disbands an empty team, and its members' rows go with it", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    as(ALICE);
    expect((await call(deleteTeam, "DELETE", { id: team })).status).toBe(204);
    expect(await count("session_teams")).toBe(0);
    expect(await count("session_team_members")).toBe(0);
    // Having joined the outing is not undone by disbanding.
    expect(await count("session_participants")).toBe(1);
  });

  it("refuses to disband a team that has stamped records (409 conflict)", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    const household = await pool.query<{ id: string }>(
      `INSERT INTO households (block_id, unit_number) VALUES ($1,'#01-01') RETURNING id`,
      [BLOCK],
    );
    await pool.query(
      `INSERT INTO visits (id, household_id, session_id, member_id, team_id, interest_level)
       VALUES ('01960000-0000-7000-8000-000000000001',$1,$2,$3,$4,'low')`,
      [household.rows[0]?.id, ACTIVE, ALICE, team],
    );
    as(ALICE);
    const response = await call(deleteTeam, "DELETE", { id: team });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("conflict");
    expect(await count("session_teams")).toBe(1);
    expect(await count("session_team_members")).toBe(1);
  });

  it("lets an admin disband a team they are not on", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    asAdmin();
    expect((await call(deleteTeam, "DELETE", { id: team })).status).toBe(204);
  });

  it("refuses a blank rename (400)", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    as(ALICE);
    expect((await call(updateTeam, "PATCH", { id: team }, { name: "  " })).status).toBe(400);
  });
});

describe("adding to a team", () => {
  it("lets a member add someone who has joined, and they become a member", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    await participate(ACTIVE, BEN);
    as(ALICE);
    const response = await call(addMember, "POST", { id: team }, { userId: BEN });
    expect(response.status).toBe(200);
    expect(memberIds((await response.json()) as TeamBody)).toEqual([ALICE, BEN].sort());
  });

  it("refuses a member someone who has not joined", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    as(ALICE);
    const response = await call(addMember, "POST", { id: team }, { userId: BEN });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("conflict");
  });

  it("refuses someone on another team, on this one already, or deactivated", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    await makeTeam(ACTIVE, "Other", [BEN]);
    await participate(ACTIVE, GONE);
    as(ALICE);
    for (const userId of [BEN, ALICE, GONE]) {
      const response = await call(addMember, "POST", { id: team }, { userId });
      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("conflict");
    }
    expect(await count("session_team_members")).toBe(2);
  });

  it("is 404 for an unknown person", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    as(ALICE);
    expect((await call(addMember, "POST", { id: team }, { userId: NOBODY })).status).toBe(404);
  });

  it("lets an admin add anyone active, making them a participant", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    asAdmin();
    const response = await call(addMember, "POST", { id: team }, { userId: CARA });
    expect(memberIds((await response.json()) as TeamBody)).toEqual([ALICE, CARA].sort());
    const { rows } = await pool.query(`SELECT 1 FROM session_participants WHERE user_id=$1`, [
      CARA,
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("leaving a team", () => {
  it("lets a member remove themselves", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE, BEN]);
    as(ALICE);
    const response = await call(removeMember, "DELETE", { id: team, userId: ALICE });
    expect(response.status).toBe(200);
    expect(memberIds((await response.json()) as TeamBody)).toEqual([BEN]);
  });

  it("refuses a member removing a teammate (403), naming the rule", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE, BEN]);
    as(ALICE);
    const response = await call(removeMember, "DELETE", { id: team, userId: BEN });
    expect(response.status).toBe(403);
    expect(await count("session_team_members")).toBe(2);
  });

  it("lets an admin remove anyone, and 404s on someone not on the team", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE, BEN]);
    asAdmin();
    expect((await call(removeMember, "DELETE", { id: team, userId: BEN })).status).toBe(200);
    expect((await call(removeMember, "DELETE", { id: team, userId: BEN })).status).toBe(404);
    expect((await call(removeMember, "DELETE", { id: team, userId: CARA })).status).toBe(404);
  });

  it("frees the person to join another team that outing", async () => {
    const team = await makeTeam(ACTIVE, "Pair", [ALICE]);
    await makeTeam(ACTIVE, "Other", []);
    as(ALICE);
    await call(removeMember, "DELETE", { id: team, userId: ALICE });
    expect((await call(createTeam, "POST", { id: ACTIVE }, { name: "Again" })).status).toBe(201);
  });
});
