import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { parseConfig } from "@/lib/config";
import { STAGE_DATABASE } from "@/db/stage-seed";

/*
 * The stage stack (#244) is production's shape on this machine. Compose
 * cannot run in CI's unit job, so the file is held here to what makes it
 * production-like and keeps it apart from the dev stack and production.
 */

const read = (path: string): string => readFileSync(path, "utf8");

const Service = z.object({
  image: z.string().optional(),
  build: z.object({ context: z.string(), target: z.string() }).optional(),
  command: z.array(z.string()).optional(),
  ports: z.array(z.string()).optional(),
  profiles: z.array(z.string()).optional(),
  depends_on: z.record(z.string(), z.object({ condition: z.string() })).optional(),
  environment: z.record(z.string(), z.string()).optional(),
});
const Compose = z.object({
  name: z.string().optional(),
  services: z.record(z.string(), Service),
  volumes: z.record(z.string(), z.unknown()).optional(),
});
const stage = Compose.parse(parse(read("docker-compose.stage.yml"), { merge: true }));
const dev = Compose.parse(parse(read("docker-compose.yml"), { merge: true }));

const service = (name: string) => {
  const found = stage.services[name];
  if (found === undefined) throw new Error(`docker-compose.stage.yml has no ${name} service`);
  return found;
};
const env = (name: string, key: string): string => service(name).environment?.[key] ?? "";
const settings = (name: string) => parseConfig(env(name, "CONFIG_YAML"), `${name} CONFIG_YAML`);

const { scripts } = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(read("package.json")));

describe("docker-compose.stage.yml", () => {
  it("is its own Compose project, never the dev stack's", () => {
    expect(stage.name).toBe("door-to-door-stage");
    expect(dev.name).toBe("door-to-door");
  });

  it("publishes only the edge and toxiproxy's API, on loopback, clear of the dev stack and the test ports", () => {
    const published = Object.entries(stage.services).flatMap(([name, { ports }]) =>
      (ports ?? []).map((port) => `${name} ${port}`),
    );

    expect(published).toEqual([
      "toxiproxy 127.0.0.1:${STAGE_TOXIPROXY_PORT:-3401}:8474",
      "edge 127.0.0.1:${STAGE_PORT:-3400}:443",
    ]);
  });

  it("runs the production build, as the image runs it, never next dev", () => {
    expect(service("app").build).toEqual({ context: ".", target: "runner" });
    expect(service("app").command).toBeUndefined();
  });

  it("gives the app production's settings, from CONFIG_YAML as Vercel does", () => {
    const config = settings("app");

    expect(config.auth).toMatchObject({ secureCookies: true, trustHost: true });
    expect(config.rateLimit.trustedProxyHops).toBe(1);
    expect(config.auth.google).toBeUndefined();
    expect(new URL(config.database.url).host).toBe("toxiproxy:15432");
    // The image's CONFIG_PATH beside CONFIG_YAML refuses to start (D-241-2).
    expect(service("app").environment?.["CONFIG_PATH"]).toBe("");
  });

  it("never carries an AUTH_SECRET of its own: one is made at start or taken from the shell", () => {
    expect(service("app").environment?.["AUTH_SECRET"]).toBeUndefined();
    expect(env("app", "AUTH_SECRET_FILE")).toBe("/run/stage/auth_secret");
    expect(env("secret", "STAGE_AUTH_SECRET")).toBe("${STAGE_AUTH_SECRET:-}");
    expect(read("docker-compose.stage.yml")).not.toMatch(/not.?for.?production/i);
  });

  it("starts the app only once migrations are applied and its secret is made", () => {
    expect(service("app").depends_on).toMatchObject({
      migrate: { condition: "service_completed_successfully" },
      secret: { condition: "service_completed_successfully" },
    });
    expect(service("migrate").command).toEqual(["npm", "run", "db:migrate"]);
    expect(service("migrate").build?.target).toBe("dev");
  });

  it("migrates and seeds its own database, straight past the injected delay", () => {
    for (const name of ["migrate", "seed"]) {
      const url = new URL(settings(name).database.url);
      expect(url.host).toBe("db:5432");
      expect(url.pathname).toBe(`/${STAGE_DATABASE}`);
    }
    expect(service("db").environment?.["POSTGRES_DB"]).toBe(STAGE_DATABASE);
    expect(new URL(settings("app").database.url).pathname).toBe(`/${STAGE_DATABASE}`);
  });

  it("seeds only when asked, from the installed tsx", () => {
    expect(service("seed").profiles).toEqual(["seed"]);
    expect(service("seed").command).toEqual(["node_modules/.bin/tsx", "scripts/stage-seed.ts"]);
    expect(service("seed").depends_on).toEqual({
      migrate: { condition: "service_completed_successfully" },
    });
  });

  it("runs the dev stack's PostgreSQL 17, so the two move together", () => {
    const image = service("db").image ?? "";

    expect(image).toMatch(/^postgres:17-alpine@sha256:/);
    expect(image).toBe(dev.services["db"]?.image);
  });

  it("keeps its data in volumes of its own", () => {
    expect(Object.keys(stage.volumes ?? {})).toEqual(["pgdata", "secret", "caddy"]);
  });
});

describe("the stage npm scripts", () => {
  const COMPOSE = "docker compose -p door-to-door-stage -f docker-compose.stage.yml";

  it("always name the stage project and file, never the dev stack's", () => {
    const composing = Object.entries(scripts).filter(([, command]) =>
      command.includes("docker compose"),
    );

    expect(composing.map(([name]) => name).sort()).toEqual(
      ["stage:down", "stage:logs", "stage:psql", "stage:seed", "stage:up"].sort(),
    );
    for (const [, command] of composing) expect(command.startsWith(`${COMPOSE} `)).toBe(true);
  });

  it("bring the stack up built and healthy, and take it down with its data", () => {
    expect(scripts["stage:up"]).toBe(`${COMPOSE} up -d --build --wait`);
    expect(scripts["stage:seed"]).toBe(`${COMPOSE} run --rm --build seed`);
    expect(scripts["stage:down"]).toBe(`${COMPOSE} down -v`);
    expect(scripts["stage:perf"]).toBe("tsx scripts/stage-perf.ts");
  });
});

describe("README.md", () => {
  const readme = read("README.md");
  const section =
    readme.split(/^(?=## )/m).find((part) => part.startsWith("## Stage environment")) ?? "";

  it("says how to run the stage stack and what it leaves out", () => {
    for (const script of ["stage:up", "stage:seed", "stage:perf", "stage:down"]) {
      expect(section).toContain(`npm run ${script}`);
    }
    expect(section).toMatch(/cold start/i);
  });

  it("gives the branch flow: features into dev, promotions by merge commit", () => {
    const branches = readme.split(/^(?=## )/m).find((part) => part.startsWith("## Branches")) ?? "";
    // Prettier rewraps prose, so a sentence is matched whatever its line breaks.
    const flat = branches.replace(/\s+/g, " ");

    expect(flat).toContain("Feature pull requests target `dev`, never `stage` or `main`.");
    expect(flat).toContain("Promotions are the only merge commits.");
  });
});
