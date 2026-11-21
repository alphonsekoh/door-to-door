import { z } from "zod";
import {
  STAGE_ACTIVE_MEMBERS,
  STAGE_ADMIN_EMAIL,
  STAGE_MEMBER_EMAIL,
  STAGE_PASSWORD,
  stageMemberEmail,
} from "@/db/stage-seed-data";
import { uuidv7 } from "@/lib/uuid";
import type { RequestInit, StageClient } from "@/server/stage/http";
import { formatTable, summarise, type RouteSummary, type Sample } from "@/server/stage/stats";

/*
 * The stage check (#244): signs in as a seeded member and admin, and makes
 * the requests their busiest screens make, in the order a phone makes them,
 * one phone at a time. Pages are server-rendered shells that read their data
 * from the API after loading, so each screen is its page plus its API reads.
 * It measures latency, not throughput: nothing here runs concurrently.
 */

export type PerfOptions = {
  baseUrl: string;
  toxiproxyUrl: string;
  iterations: number;
  warmup: number;
  dbLatencyMs: number;
  json: string | undefined;
};

export const PERF_USAGE =
  "Usage: npm run stage:perf -- [--iterations 20] [--warmup 2] [--db-latency <ms>] [--json <file>]";

const FLAGS = {
  "--iterations": "iterations",
  "--warmup": "warmup",
  "--db-latency": "dbLatencyMs",
} as const;

/* Ports as docker-compose.stage.yml publishes them, from the same variables. */
export function parsePerfArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): PerfOptions {
  const options: PerfOptions = {
    baseUrl: `https://127.0.0.1:${env["STAGE_PORT"] ?? "3400"}`,
    toxiproxyUrl: `http://127.0.0.1:${env["STAGE_TOXIPROXY_PORT"] ?? "3401"}`,
    iterations: 20,
    warmup: 2,
    dbLatencyMs: 0,
    json: undefined,
  };
  for (let at = 0; at < argv.length; at += 2) {
    const flag = argv.slice(at, at + 1).join("");
    const value = argv.slice(at + 1, at + 2).join("");
    if (flag === "--json" && value !== "") {
      options.json = value;
      continue;
    }
    const key = Object.entries(FLAGS).find(([name]) => name === flag)?.[1];
    if (key === undefined || !/^\d+$/.test(value)) {
      throw new Error(`Cannot read "${[flag, value].join(" ").trim()}".\n${PERF_USAGE}`);
    }
    options[key] = Number(value);
  }
  if (options.iterations < 1) throw new Error(`--iterations must be at least 1.\n${PERF_USAGE}`);
  return options;
}

export type Step = { route: string; path: string; init?: RequestInit; status?: number };

type Recorder = (route: string, sample: Sample) => void;

const page = (path: string, route = `page ${path}`): Step => ({
  route,
  path,
  init: { headers: { accept: "text/html" } },
});
const api = (route: string, path: string): Step => ({ route, path });

const zCsrf = z.object({ csrfToken: z.string() });
/* At least one: [first, ...rest], so the first needs no undefined check. */
const nonEmpty = <T extends z.ZodType>(item: T) => z.tuple([item], item);
const zActive = z.object({
  session: z.object({ id: z.string() }),
  blocks: nonEmpty(z.object({ block: z.object({ id: z.string() }) })),
});
const zHouseholds = z.object({
  data: nonEmpty(z.object({ household: z.object({ id: z.string(), unitNumber: z.string() }) })),
});

/* As next-auth/react's signIn("credentials") does it; its time is both requests'. */
export async function signIn(
  client: StageClient,
  email: string,
  password: string,
): Promise<Sample> {
  const csrf = await client.request("/api/auth/csrf");
  const { csrfToken } = zCsrf.parse(JSON.parse(csrf.body.toString("utf8")));
  const callback = await client.request("/api/auth/callback/credentials", {
    method: "POST",
    body: new URLSearchParams({ email, password, csrfToken, callbackUrl: "/" }).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-auth-return-redirect": "1",
    },
  });
  if (!client.jar.names().some((name) => name.endsWith("authjs.session-token"))) {
    throw new Error(
      `Could not sign in as ${email} (HTTP ${String(callback.status)}). Is the stage database seeded? npm run stage:seed`,
    );
  }
  return {
    ms: csrf.ms + callback.ms,
    bytes: csrf.body.length + callback.body.length,
    wireBytes: csrf.wireBytes + callback.wireBytes,
    status: callback.status,
    ok: true,
  };
}

export type Target = {
  sessionId: string;
  blockId: string;
  householdId: string;
  unitNumber: string;
};

/* Where the member is working today: the active session, its first block, a unit in it. */
export async function findTarget(member: StageClient): Promise<Target> {
  const active = await member.request("/api/sessions/active");
  if (active.status !== 200) {
    throw new Error(
      `No active session to measure (HTTP ${String(active.status)}). Seed an empty stack: npm run stage:seed`,
    );
  }
  const { session, blocks } = zActive.parse(JSON.parse(active.body.toString("utf8")));
  const blockId = blocks[0].block.id;
  const units = await member.request(`/api/households?blockId=${blockId}&limit=100&offset=0`);
  const { household } = zHouseholds.parse(JSON.parse(units.body.toString("utf8"))).data[0];
  return {
    sessionId: session.id,
    blockId,
    householdId: household.id,
    unitNumber: household.unitNumber,
  };
}

/* Home, a block's units, a household's history, recording a visit, follow-ups. */
export function memberSteps(target: Target, now: Date): Step[] {
  return [
    page("/", "page / (active session)"),
    api("GET /api/sessions/active", "/api/sessions/active"),
    page(`/blocks/${target.blockId}`, "page /blocks/{id}"),
    api(
      "GET /api/households?blockId",
      `/api/households?blockId=${target.blockId}&limit=100&offset=0`,
    ),
    api("GET /api/sessions/{id}/teams", `/api/sessions/${target.sessionId}/teams`),
    page(`/households/${target.householdId}`, "page /households/{id}"),
    api("GET /api/households/{id}", `/api/households/${target.householdId}?limit=20&offset=0`),
    {
      route: "POST /api/visits",
      path: "/api/visits",
      status: 201,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: uuidv7(now.getTime()),
          blockId: target.blockId,
          unitNumber: target.unitNumber,
          interestLevel: "low",
          description: "Recorded by the stage check.",
          clientCreatedAt: now.toISOString(),
        }),
      },
    },
    page("/follow-ups"),
    api(
      "GET /api/follow-ups (list)",
      "/api/follow-ups?status=listed&outstanding=true&limit=20&offset=0",
    ),
  ];
}

/* Admin sessions with its notices, All records with its pickers, Needs a return visit. */
export function adminSteps(now: Date): Step[] {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return [
    page("/admin/sessions"),
    api("GET /api/sessions", "/api/sessions?limit=25"),
    api("GET /api/follow-ups (to review)", "/api/follow-ups?status=suggested&limit=1"),
    api(
      "GET /api/follow-ups (overdue)",
      `/api/follow-ups?status=listed&outstanding=true&dueBefore=${encodeURIComponent(today.toISOString())}&limit=5`,
    ),
    page("/admin/history"),
    api("GET /api/history", "/api/history?limit=100&offset=0"),
    api("GET /api/blocks", "/api/blocks?limit=100"),
    api("GET /api/sessions (picker)", "/api/sessions?limit=100"),
    api("GET /api/users", "/api/users?limit=100&offset=0"),
    page("/admin/attention"),
    api("GET /api/households/attention", "/api/households/attention?limit=50"),
    api(
      "GET /api/households/attention (medium)",
      "/api/households/attention?limit=50&minimumInterest=medium",
    ),
  ];
}

export async function runSteps(client: StageClient, steps: readonly Step[], record: Recorder) {
  for (const step of steps) {
    const answer = await client.request(step.path, step.init);
    record(step.route, {
      ms: answer.ms,
      bytes: answer.body.length,
      wireBytes: answer.wireBytes,
      status: answer.status,
      ok: answer.status === (step.status ?? 200),
    });
  }
}

export type PerfReport = {
  startedAt: string;
  baseUrl: string;
  dbLatencyMs: number;
  iterations: number;
  warmup: number;
  routes: RouteSummary[];
};

export type PerfDeps = {
  client: () => StageClient;
  setLatency: (roundTripMs: number) => Promise<void>;
  now: () => Date;
  log: (message: string) => void;
};

export async function runPerfCheck(options: PerfOptions, deps: PerfDeps): Promise<PerfReport> {
  const startedAt = deps.now().toISOString();
  await deps.setLatency(options.dbLatencyMs);
  try {
    const finder = deps.client();
    await signIn(finder, STAGE_MEMBER_EMAIL, STAGE_PASSWORD);
    const target = await findTarget(finder);
    const samples = new Map<string, Sample[]>();
    const keep: Recorder = (route, sample) => {
      samples.set(route, [...(samples.get(route) ?? []), sample]);
    };
    const rounds = options.warmup + options.iterations;
    for (let round = 1; round <= rounds; round += 1) {
      const record: Recorder = round > options.warmup ? keep : () => undefined;
      deps.log(
        `round ${String(round)} of ${String(rounds)}${round > options.warmup ? "" : " (warm-up)"}`,
      );
      /* A different member each round: one would meet the 30 saves a minute a member may make. */
      const member = deps.client();
      const email = stageMemberEmail(((round - 1) % STAGE_ACTIVE_MEMBERS) + 1);
      record("sign-in (member)", await signIn(member, email, STAGE_PASSWORD));
      await runSteps(member, memberSteps(target, deps.now()), record);
      const admin = deps.client();
      record("sign-in (admin)", await signIn(admin, STAGE_ADMIN_EMAIL, STAGE_PASSWORD));
      await runSteps(admin, adminSteps(deps.now()), record);
    }
    return {
      startedAt,
      baseUrl: options.baseUrl,
      dbLatencyMs: options.dbLatencyMs,
      iterations: options.iterations,
      warmup: options.warmup,
      routes: [...samples].map(([route, kept]) => summarise(route, kept)),
    };
  } finally {
    await deps.setLatency(0);
  }
}

export function formatReport(report: PerfReport): string {
  return [
    `Stage check, ${report.startedAt}, ${report.baseUrl}`,
    `Database round trip added: ${String(report.dbLatencyMs)} ms. ` +
      `${String(report.iterations)} rounds after ${String(report.warmup)} warm-up, one phone at a time.`,
    "",
    formatTable(report.routes),
  ].join("\n");
}
