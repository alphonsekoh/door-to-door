import { describe, expect, it, vi } from "vitest";
import {
  STAGE_ACTIVE_MEMBERS,
  STAGE_ADMIN_EMAIL,
  STAGE_MEMBER_EMAIL,
  STAGE_PASSWORD,
  stageMemberEmail,
} from "@/db/stage-seed-data";
import { createCookieJar, type RequestInit, type StageClient } from "@/server/stage/http";
import {
  adminSteps,
  findTarget,
  formatReport,
  memberSteps,
  parsePerfArgs,
  PERF_USAGE,
  runPerfCheck,
  signIn,
  type PerfDeps,
  type PerfOptions,
  type Target,
} from "@/server/stage/perf";

type Answer = { status?: number; body?: unknown; setCookie?: string[] };
type Handler = (path: string, init: RequestInit) => Answer | undefined;

/* A stand-in for the stack: Auth.js's two sign-in requests, the active session, a block. */
const stageApp: Handler = (path, init) => {
  if (path === "/api/auth/csrf") return { body: { csrfToken: "token" } };
  if (path === "/api/auth/callback/credentials") {
    const form = new URLSearchParams(init.body);
    const valid = form.get("password") === STAGE_PASSWORD && form.get("csrfToken") === "token";
    return valid
      ? {
          body: { url: "/" },
          setCookie: [`__Secure-authjs.session-token=${String(form.get("email"))}`],
        }
      : { body: { url: "/sign-in?error=CredentialsSignin" } };
  }
  if (path === "/api/sessions/active") {
    return {
      body: { session: { id: "session-1" }, blocks: [{ block: { id: "block-1" } }], picks: [] },
    };
  }
  if (path.startsWith("/api/households?blockId=block-1")) {
    return { body: { data: [{ household: { id: "household-1", unitNumber: "#05-123" } }] } };
  }
  if (path === "/api/visits") return { status: 201 };
  return undefined;
};

function fakeClient(handler: Handler, sent: string[] = []): StageClient {
  const jar = createCookieJar();
  return {
    jar,
    request: (path, init = {}) => {
      sent.push(`${init.method ?? "GET"} ${path}`);
      const {
        status = 200,
        body = {},
        setCookie,
      } = handler(path, init) ?? stageApp(path, init) ?? {};
      jar.store(setCookie);
      const text = Buffer.from(JSON.stringify(body));
      return Promise.resolve({ status, headers: {}, body: text, wireBytes: 4, ms: 10 });
    },
  };
}

const OPTIONS: PerfOptions = {
  baseUrl: "https://127.0.0.1:3400",
  toxiproxyUrl: "http://127.0.0.1:3401",
  iterations: 2,
  warmup: 1,
  dbLatencyMs: 220,
  json: undefined,
};
const NOW = new Date("2026-11-21T08:00:00Z");
const TARGET: Target = {
  sessionId: "session-1",
  blockId: "block-1",
  householdId: "household-1",
  unitNumber: "#05-123",
};

function deps(handler: Handler = () => undefined, sent: string[] = []) {
  const latency: number[] = [];
  const log = vi.fn<(message: string) => void>();
  const value: PerfDeps = {
    client: () => fakeClient(handler, sent),
    setLatency: (roundTripMs) => {
      latency.push(roundTripMs);
      return Promise.resolve();
    },
    now: () => NOW,
    log,
  };
  return { value, latency, log };
}

describe("parsePerfArgs", () => {
  it("measures 20 rounds after 2 warm-up, with no delay, at the stack's default ports", () => {
    expect(parsePerfArgs([], {})).toEqual({
      baseUrl: "https://127.0.0.1:3400",
      toxiproxyUrl: "http://127.0.0.1:3401",
      iterations: 20,
      warmup: 2,
      dbLatencyMs: 0,
      json: undefined,
    });
  });

  it("follows the ports Compose was given", () => {
    const options = parsePerfArgs([], { STAGE_PORT: "3500", STAGE_TOXIPROXY_PORT: "3501" });

    expect(options.baseUrl).toBe("https://127.0.0.1:3500");
    expect(options.toxiproxyUrl).toBe("http://127.0.0.1:3501");
  });

  it("reads every flag", () => {
    const options = parsePerfArgs(
      ["--iterations", "5", "--warmup", "0", "--db-latency", "220", "--json", "stage.json"],
      {},
    );

    expect(options).toMatchObject({
      iterations: 5,
      warmup: 0,
      dbLatencyMs: 220,
      json: "stage.json",
    });
  });

  it.each([
    [["--iterations"], 'Cannot read "--iterations"'],
    [["--iterations", "ten"], 'Cannot read "--iterations ten"'],
    [["--db-latency", "-5"], 'Cannot read "--db-latency -5"'],
    [["--json"], 'Cannot read "--json"'],
    [["--rounds", "5"], 'Cannot read "--rounds 5"'],
    [["--iterations", "0"], "--iterations must be at least 1"],
  ])("refuses %j with the usage line", (argv, message) => {
    expect(() => parsePerfArgs(argv, {})).toThrow(message);
    expect(() => parsePerfArgs(argv, {})).toThrow(PERF_USAGE);
  });
});

describe("signIn", () => {
  it("fetches a CSRF token and posts the credentials as next-auth/react does, timing both", async () => {
    const sent: string[] = [];
    const client = fakeClient(() => undefined, sent);

    const sample = await signIn(client, STAGE_MEMBER_EMAIL, STAGE_PASSWORD);

    expect(sent).toEqual(["GET /api/auth/csrf", "POST /api/auth/callback/credentials"]);
    expect(sample).toEqual({ ms: 20, bytes: 32, wireBytes: 8, status: 200, ok: true });
    expect(client.jar.names()).toEqual(["__Secure-authjs.session-token"]);
  });

  it("stops the check when no session cookie comes back, pointing at the seed", async () => {
    const client = fakeClient(() => undefined);

    await expect(signIn(client, STAGE_MEMBER_EMAIL, "wrong")).rejects.toThrow(
      `Could not sign in as ${STAGE_MEMBER_EMAIL} (HTTP 200). Is the stage database seeded? npm run stage:seed`,
    );
  });
});

describe("findTarget", () => {
  it("takes the active session, its first block and a unit in it", async () => {
    await expect(findTarget(fakeClient(() => undefined))).resolves.toEqual(TARGET);
  });

  it("stops the check when no session is active", async () => {
    const client = fakeClient((path) =>
      path === "/api/sessions/active" ? { status: 404 } : undefined,
    );

    await expect(findTarget(client)).rejects.toThrow(
      "No active session to measure (HTTP 404). Seed an empty stack: npm run stage:seed",
    );
  });
});

describe("the steps", () => {
  it("record a new visit at the member's unit on every round", () => {
    const [first, second] = [memberSteps(TARGET, NOW), memberSteps(TARGET, NOW)].map((steps) =>
      steps.find((step) => step.route === "POST /api/visits"),
    );
    const visit = JSON.parse(first?.init?.body ?? "{}") as Record<string, unknown>;

    expect(first?.status).toBe(201);
    expect(visit).toMatchObject({
      blockId: "block-1",
      unitNumber: "#05-123",
      interestLevel: "low",
      clientCreatedAt: NOW.toISOString(),
    });
    expect(visit["id"]).not.toBe(
      (JSON.parse(second?.init?.body ?? "{}") as Record<string, unknown>)["id"],
    );
  });

  it("ask for pages as a browser does, and for overdue notes before today", () => {
    const steps = adminSteps(new Date("2026-11-21T23:30:00Z"));

    expect(steps.find((step) => step.route === "page /admin/history")?.init).toEqual({
      headers: { accept: "text/html" },
    });
    expect(steps.find((step) => step.route === "GET /api/follow-ups (overdue)")?.path).toContain(
      "dueBefore=2026-11-21T00%3A00%3A00.000Z",
    );
  });
});

describe("runPerfCheck", () => {
  it("measures every route after the warm-up, and takes the delay off afterwards", async () => {
    const sent: string[] = [];
    const { value, latency, log } = deps(() => undefined, sent);

    const report = await runPerfCheck(OPTIONS, value);

    const routes = [
      "sign-in (member)",
      ...memberSteps(TARGET, NOW).map((step) => step.route),
      "sign-in (admin)",
      ...adminSteps(NOW).map((step) => step.route),
    ];
    expect(report.routes.map((row) => row.route)).toEqual(routes);
    expect(report.routes.every((row) => row.count === 2 && row.failures === 0)).toBe(true);
    expect(report).toMatchObject({
      startedAt: NOW.toISOString(),
      baseUrl: OPTIONS.baseUrl,
      dbLatencyMs: 220,
      iterations: 2,
      warmup: 1,
    });
    expect(latency).toEqual([220, 0]);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "round 1 of 3 (warm-up)",
      "round 2 of 3",
      "round 3 of 3",
    ]);
    expect(sent.filter((line) => line === "POST /api/auth/callback/credentials")).toHaveLength(7);
  });

  it("signs the admin in as the admin", async () => {
    const emails: string[] = [];
    const { value } = deps((path, init) => {
      if (path === "/api/auth/callback/credentials")
        emails.push(String(new URLSearchParams(init.body).get("email")));
      return undefined;
    });

    await runPerfCheck({ ...OPTIONS, iterations: 1, warmup: 0 }, value);

    expect(emails).toEqual([STAGE_MEMBER_EMAIL, STAGE_MEMBER_EMAIL, STAGE_ADMIN_EMAIL]);
  });

  it("signs in a different member each round, round the members who can", async () => {
    const emails: string[] = [];
    const { value } = deps((path, init) => {
      if (path === "/api/auth/callback/credentials") {
        emails.push(String(new URLSearchParams(init.body).get("email")));
      }
      return undefined;
    });

    await runPerfCheck({ ...OPTIONS, iterations: STAGE_ACTIVE_MEMBERS + 1, warmup: 0 }, value);

    const members = emails.filter((email) => email !== STAGE_ADMIN_EMAIL).slice(1);
    expect(members.slice(0, 2)).toEqual([stageMemberEmail(1), stageMemberEmail(2)]);
    expect(members.at(-2)).toBe(stageMemberEmail(STAGE_ACTIVE_MEMBERS));
    expect(members.at(-1)).toBe(stageMemberEmail(1));
  });

  it("counts an answer other than the expected one as a failure, and carries on", async () => {
    const { value } = deps((path) => (path === "/api/visits" ? { status: 409 } : undefined));

    const report = await runPerfCheck(OPTIONS, value);

    expect(report.routes.find((row) => row.route === "POST /api/visits")).toMatchObject({
      failures: 2,
      failedWith: [409],
    });
    expect(report.routes.find((row) => row.route === "GET /api/history")?.failures).toBe(0);
  });

  it("takes the delay off even when the check cannot start", async () => {
    const { value, latency } = deps((path) =>
      path === "/api/sessions/active" ? { status: 404 } : undefined,
    );

    await expect(runPerfCheck(OPTIONS, value)).rejects.toThrow(/No active session/);
    expect(latency).toEqual([220, 0]);
  });
});

describe("formatReport", () => {
  it("heads the table with when, where, the delay and the rounds", async () => {
    const { value } = deps();
    const report = await runPerfCheck({ ...OPTIONS, iterations: 1 }, value);

    const lines = formatReport(report).split("\n");

    expect(lines.slice(0, 3)).toEqual([
      `Stage check, ${NOW.toISOString()}, https://127.0.0.1:3400`,
      "Database round trip added: 220 ms. 1 rounds after 1 warm-up, one phone at a time.",
      "",
    ]);
    expect(lines[3]).toMatch(/^\| Route \|/);
    expect(lines).toHaveLength(3 + 2 + report.routes.length);
  });
});
