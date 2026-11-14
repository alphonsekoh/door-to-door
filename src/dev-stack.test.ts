import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { parseConfig, resolveAuthSecrets } from "@/lib/config";

/*
 * The dev stack stays on the developer's machine (#124). Compose cannot run in
 * CI's unit job, so its file, the npm scripts and the Dockerfile's dev stage
 * are held to that here.
 */

const read = (path: string): string => readFileSync(path, "utf8");

const Service = z.object({
  command: z.union([z.string(), z.array(z.string())]).optional(),
  ports: z.array(z.string()).optional(),
  depends_on: z.record(z.string(), z.object({ condition: z.string() })).optional(),
  environment: z.record(z.string(), z.string()).optional(),
});
const { services } = z
  .object({ services: z.record(z.string(), Service) })
  // Compose resolves `<<:` merge keys; so must this, or migrate and seed look empty.
  .parse(parse(read("docker-compose.yml"), { merge: true }));

const service = (name: string) => {
  const found = services[name];
  if (found === undefined) throw new Error(`docker-compose.yml has no ${name} service`);
  return found;
};

const commandOf = (name: string): string => {
  const { command } = service(name);
  return Array.isArray(command) ? command.join(" ") : (command ?? "");
};

const { scripts } = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(read("package.json")));

describe("docker-compose.yml", () => {
  it("publishes every port on this machine's loopback, never the LAN", () => {
    const published = Object.entries(services).flatMap(([name, { ports }]) =>
      (ports ?? []).map((port) => `${name} ${port}`),
    );

    expect(published).toEqual([
      "db 127.0.0.1:5432:5432",
      "db-test 127.0.0.1:5433:5432",
      "web 127.0.0.1:3000:3000",
    ]);
  });

  it("has migrate only migrate, so pointing it at production adds no demo login", () => {
    expect(commandOf("migrate")).toBe("npm run db:migrate");
    expect(commandOf("migrate")).not.toMatch(/seed/);
  });

  it("seeds from its own service alone, once migrate has finished", () => {
    const seeding = Object.keys(services).filter((name) => commandOf(name).includes("db:seed"));

    expect(seeding).toEqual(["seed"]);
    expect(commandOf("seed")).toBe("npm run db:seed -- --demo");
    expect(service("seed").depends_on).toEqual({
      migrate: { condition: "service_completed_successfully" },
    });
  });

  it("never holds web back on the seed, which refuses a database with real users", () => {
    expect(service("web").depends_on).toEqual({
      migrate: { condition: "service_completed_successfully" },
    });
  });

  it("runs web on the Dockerfile's dev command", () => {
    expect(service("web").command).toBeUndefined();
  });

  describe("web's default AUTH_SECRET", () => {
    const declared = service("web").environment?.["AUTH_SECRET"] ?? "";
    const literal = /^\$\{AUTH_SECRET:-(?<value>[^}]+)\}$/.exec(declared)?.groups?.["value"] ?? "";
    const config = parseConfig(read("config.docker.yaml"), "config.docker.yaml");

    it("is a literal the shell can override", () => {
      expect(literal).not.toBe("");
    });

    it("is refused by a production start", () => {
      expect(() =>
        resolveAuthSecrets(config, { AUTH_SECRET: literal, NODE_ENV: "production" }, () => ""),
      ).toThrow(/^AUTH_SECRET is a public development value/);
    });

    it("is accepted by next dev, as Compose runs it", () => {
      expect(
        resolveAuthSecrets(config, { AUTH_SECRET: literal, NODE_ENV: "development" }, () => "")
          .authSecret,
      ).toBe(literal);
    });
  });
});

describe("npm scripts", () => {
  it("never pass --demo: whoever seeds types it", () => {
    const passing = Object.entries(scripts).filter(([, command]) => command.includes("--demo"));
    expect(passing).toEqual([]);
  });

  it("run the dev server on loopback only", () => {
    expect(scripts["dev"]).toBe("next dev -H 127.0.0.1");
  });
});

describe("the Dockerfile's dev stage", () => {
  it("runs the installed next, never one from the registry, on every interface of its container", () => {
    const stage = /^FROM \S+ AS dev$(?<body>[\s\S]*?)(?=^FROM )/m.exec(read("Dockerfile"))
      ?.groups?.["body"];
    const cmd = /^CMD (?<args>\[.*\])$/m.exec(stage ?? "")?.groups?.["args"];

    expect(JSON.parse(cmd ?? "null")).toEqual(["node_modules/.bin/next", "dev", "-H", "0.0.0.0"]);
  });
});

describe("README.md", () => {
  const readme = read("README.md");

  it("never gives the demo's docker compose up the settings file production migrates with", () => {
    const filesFor = (command: RegExp): string[] => {
      const files = new Set<string>();
      for (const text of [readme, read("config.docker.yaml"), read("docker-compose.yml")]) {
        // A shell line continuation is still the same command.
        const joined = text.replace(/\\\n\s*/g, " ");
        for (const { groups } of joined.matchAll(/CONFIG_FILE=(?<file>\S+)(?<rest>[^\n`]*)/g)) {
          const file = groups?.["file"];
          if (file !== undefined && command.test(groups?.["rest"] ?? "")) files.add(file);
        }
      }
      return [...files];
    };

    expect(filesFor(/docker compose run --rm --no-deps migrate/)).toEqual(["./config.yaml"]);
    expect(filesFor(/docker compose up/)).toEqual(["./config.demo.yaml"]);
  });

  it("warns, wherever it serves the app to the LAN, that the seeded logins can be reached there", () => {
    const sections = readme.split(/^(?=#{2,3} )/m);
    const exposing = sections.filter((section) => section.includes("HOSTNAME=0.0.0.0"));

    expect(exposing).not.toEqual([]);
    for (const section of exposing) {
      expect(section).toContain("(#seeded-logins)");
      expect(section).toContain("network you trust");
      expect(section).toContain("database without the seed users");
    }
  });
});
