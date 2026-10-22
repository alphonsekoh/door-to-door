import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { createTestPool, truncateAll } from "@/db/testing";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { GET: listVisits, POST: createVisit } = await import("./route");
const { PATCH: updateVisit } = await import("./[id]/route");
const { POST: syncVisits } = await import("./sync/route");
const { GET: listHistory } = await import("../history/route");
const { GET: ownHistory } = await import("../history/mine/route");
const { GET: listHouseholds } = await import("../households/route");
const { GET: householdHistory } = await import("../households/[id]/route");
const { GET: attention } = await import("../households/attention/route");

/*
 * `team` is required by the generated schema, so a visit-bearing endpoint that
 * forgot to populate it fails its own response validation. These pin that it
 * is also the RIGHT team, on every one of them.
 */

const pool = createTestPool();
const ADMIN = "76767676-0000-4000-8000-000000000001";
const ALICE = "76767676-0000-4000-8000-000000000002";
const BEN = "76767676-0000-4000-8000-000000000003";
const CARA = "76767676-0000-4000-8000-000000000004";
const BLOCK = "76767676-0000-4000-8001-000000000001";
const SESSION = "76767676-0000-4000-8002-000000000001";
const TEAM = "76767676-0000-4000-8004-000000000001";
const HOUSEHOLD = "76767676-0000-4000-8003-000000000001";
const STAMPED = "01960000-0000-7000-8000-00000000ccc1";
const NEW_ID = "01960000-0000-7000-8000-00000000ccc2";

const as = (id: string, role: "admin" | "member" = "member") =>
  auth.mockResolvedValue({ user: { id, role, deactivated: false } });

const json = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});
const url = (path: string) => `https://test.local/api${path}`;

type Team = { id: string; name: string; members: { id: string; name: string }[] } | null;
const BEN_ONLY = { id: TEAM, name: "Pair", members: [{ id: BEN, name: "Ben", image: null }] };

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query(
    `INSERT INTO users (id, email, name, role) VALUES
      ($1,'a@t.local','Admin','admin'), ($2,'alice@t.local','Alice','member'),
      ($3,'ben@t.local','Ben','member'), ($4,'cara@t.local','Cara','member')`,
    [ADMIN, ALICE, BEN, CARA],
  );
  await pool.query(`INSERT INTO blocks (id, name, street) VALUES ($1,'123','Test Ave')`, [BLOCK]);
  await pool.query(
    `INSERT INTO outing_sessions (id, title, status, created_by, started_at) VALUES ($1,'Outing','active',$2,now() - interval '1 hour')`,
    [SESSION, ADMIN],
  );
  await pool.query(`INSERT INTO session_blocks (session_id, block_id) VALUES ($1,$2)`, [
    SESSION,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO session_teams (id, session_id, name, created_by) VALUES ($1,$2,'Pair',$3)`,
    [TEAM, SESSION, ADMIN],
  );
  await pool.query(
    `INSERT INTO session_team_members (team_id, session_id, user_id) VALUES ($1,$2,$3), ($1,$2,$4)`,
    [TEAM, SESSION, ALICE, BEN],
  );
  await pool.query(`INSERT INTO households (id, block_id, unit_number) VALUES ($1,$2,'#05-123')`, [
    HOUSEHOLD,
    BLOCK,
  ]);
  await pool.query(
    `INSERT INTO visits (id, household_id, session_id, member_id, team_id, interest_level)
     VALUES ($1,$2,$3,$4,$5,'high')`,
    [STAMPED, HOUSEHOLD, SESSION, ALICE, TEAM],
  );
  await pool.query(`INSERT INTO visit_teammates (visit_id, user_id) VALUES ($1,$2)`, [
    STAMPED,
    BEN,
  ]);
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await resetDatabase();
});

describe("team on every visit-bearing response", () => {
  it("POST /visits stamps the caller's team", async () => {
    as(ALICE);
    const response = await createVisit(
      new Request(
        url("/visits"),
        json("POST", { id: NEW_ID, blockId: BLOCK, unitNumber: "#06-201", interestLevel: "low" }),
      ),
    );
    expect(response.status).toBe(201);
    expect(((await response.json()) as { team: Team }).team).toEqual(BEN_ONLY);
  });

  it("PATCH /visits/{id} lets a teammate amend and returns the author's team", async () => {
    as(BEN);
    const response = await updateVisit(
      new Request(url(`/visits/${STAMPED}`), json("PATCH", { interestLevel: "low" })),
      { params: Promise.resolve({ id: STAMPED }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { team: Team; member: { id: string } };
    expect(body.member.id).toBe(ALICE);
    expect(body.team).toEqual(BEN_ONLY);
  });

  it("PATCH /visits/{id} refuses a stranger with 403", async () => {
    as(CARA);
    const response = await updateVisit(
      new Request(url(`/visits/${STAMPED}`), json("PATCH", { interestLevel: "low" })),
      { params: Promise.resolve({ id: STAMPED }) },
    );
    expect(response.status).toBe(403);
  });

  it("POST /visits still refuses a member naming a teammate as the author (403)", async () => {
    as(ALICE);
    const response = await createVisit(
      new Request(
        url("/visits"),
        json("POST", {
          id: NEW_ID,
          blockId: BLOCK,
          unitNumber: "#06-201",
          interestLevel: "low",
          memberId: BEN,
        }),
      ),
    );
    expect(response.status).toBe(403);
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM visits`);
    expect(rows).toEqual([{ n: "1" }]);
  });

  it("GET /visits lists a member's own visits only, with their team", async () => {
    as(ALICE);
    const own = (await (await listVisits(new Request(url("/visits")))).json()) as {
      data: { team: Team }[];
    };
    expect(own.data.map((v) => v.team)).toEqual([BEN_ONLY]);

    as(BEN);
    const theirs = (await (await listVisits(new Request(url("/visits")))).json()) as {
      data: unknown[];
    };
    expect(theirs.data).toEqual([]);
  });

  it("POST /visits/sync returns the team on an applied item and on a teammate's amend", async () => {
    as(BEN);
    const sentAt = new Date().toISOString();
    const response = await syncVisits(
      new Request(
        url("/visits/sync"),
        json("POST", {
          sentAt,
          items: [
            {
              id: NEW_ID,
              blockId: BLOCK,
              unitNumber: "#06-201",
              interestLevel: "low",
              clientCreatedAt: sentAt,
              updatedAt: sentAt,
            },
            {
              id: STAMPED,
              blockId: BLOCK,
              unitNumber: "#05-123",
              interestLevel: "low",
              clientCreatedAt: sentAt,
              updatedAt: sentAt,
            },
          ],
        }),
      ),
    );
    const body = (await response.json()) as {
      results: { status: string; visit: { team: Team; member: { id: string } } }[];
    };
    expect(body.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(body.results[0]?.visit.team).toEqual({
      id: TEAM,
      name: "Pair",
      members: [{ id: ALICE, name: "Alice", image: null }],
    });
    expect(body.results[1]?.visit.team).toEqual(BEN_ONLY);
    expect(body.results[1]?.visit.member.id).toBe(ALICE);
  });

  it("GET /history carries the team and filters by it for an admin", async () => {
    as(ADMIN, "admin");
    const body = (await (
      await listHistory(new Request(url(`/history?teamId=${TEAM}`)))
    ).json()) as {
      data: { visit: { team: Team } }[];
    };
    expect(body.data.map((e) => e.visit.team)).toEqual([BEN_ONLY]);

    const none = (await (
      await listHistory(new Request(url(`/history?teamId=${SESSION}`)))
    ).json()) as { data: unknown[] };
    expect(none.data).toEqual([]);
  });

  it("GET /history?teamId stays admin-only", async () => {
    as(BEN);
    expect((await listHistory(new Request(url(`/history?teamId=${TEAM}`)))).status).toBe(403);
  });

  it("GET /history/mine shows a teammate's record only when includeTeam is set", async () => {
    as(BEN);
    const without = (await (await ownHistory(new Request(url("/history/mine")))).json()) as {
      data: unknown[];
    };
    expect(without.data).toEqual([]);

    const withTeam = (await (
      await ownHistory(new Request(url("/history/mine?includeTeam=true")))
    ).json()) as {
      data: { visit: { team: Team; member: { id: string } } }[];
    };
    expect(withTeam.data.map((e) => [e.visit.member.id, e.visit.team])).toEqual([
      [ALICE, BEN_ONLY],
    ]);
  });

  it("GET /history/mine?includeTeam cannot reach a team the caller is not on", async () => {
    as(CARA);
    const body = (await (
      await ownHistory(
        new Request(url(`/history/mine?includeTeam=true&teamId=${TEAM}&memberId=${ALICE}`)),
      )
    ).json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("GET /households carries the team on the latest visit", async () => {
    as(ALICE);
    const body = (await (
      await listHouseholds(new Request(url(`/households?blockId=${BLOCK}`)))
    ).json()) as {
      data: { latestVisit: { team: Team } }[];
    };
    expect(body.data.map((h) => h.latestVisit.team)).toEqual([BEN_ONLY]);
  });

  it("GET /households/{id} carries the team on each visit in the timeline", async () => {
    as(CARA);
    const body = (await (
      await householdHistory(new Request(url(`/households/${HOUSEHOLD}`)), {
        params: Promise.resolve({ id: HOUSEHOLD }),
      })
    ).json()) as { visits: { team: Team }[] };
    expect(body.visits.map((v) => v.team)).toEqual([BEN_ONLY]);
  });

  it("GET /households/attention carries the team on the latest visit", async () => {
    as(ADMIN, "admin");
    const body = (await (await attention(new Request(url("/households/attention")))).json()) as {
      data: { latestVisit: { team: Team } }[];
    };
    expect(body.data.map((h) => h.latestVisit.team)).toEqual([BEN_ONLY]);
  });
});
