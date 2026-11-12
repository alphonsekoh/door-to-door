import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

/*
 * CI and the images run what a pin names by content, not a tag its owner can
 * move, and CI's token can read the repository and nothing more (#131).
 * Dependabot keeps the pins current; this keeps every new line pinned.
 */

const read = (path: string): string => readFileSync(path, "utf8");

const WORKFLOWS = readdirSync(".github/workflows").map((name) => join(".github/workflows", name));

const Workflow = z.object({
  permissions: z.unknown(),
  jobs: z.record(
    z.string(),
    z.object({
      services: z.record(z.string(), z.object({ image: z.string() })).optional(),
      steps: z.array(
        z.object({
          uses: z.string().optional(),
          with: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    }),
  ),
});
const workflow = (path: string) => Workflow.parse(parse(read(path)));

const Compose = z.object({
  services: z.record(z.string(), z.object({ image: z.string().optional() })),
});

const PINNED_ACTION = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;
const PINNED_IMAGE = /^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/;

describe("GitHub Actions workflows", () => {
  it.each(WORKFLOWS)("%s pins every action by commit and names its release", (path) => {
    const uses = Array.from(read(path).matchAll(/^\s*(?:- )?uses: (.*)$/gm), ([, use]) => use);

    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(PINNED_ACTION);
  });

  it.each(WORKFLOWS)("%s may only read, and keeps the token out of .git/config", (path) => {
    const { permissions, jobs } = workflow(path);
    const checkouts = Object.values(jobs)
      .flatMap((job) => job.steps)
      .filter((step) => step.uses?.startsWith("actions/checkout@"));

    expect(permissions).toEqual({ contents: "read" });
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
  });
});

describe("container images", () => {
  const ciImages = WORKFLOWS.flatMap((path) =>
    Object.values(workflow(path).jobs).flatMap((job) =>
      Object.values(job.services ?? {}).map((service) => service.image),
    ),
  );
  const composeImages = Object.values(
    Compose.parse(parse(read("docker-compose.yml"))).services,
  ).flatMap((service) => service.image ?? []);
  const dockerfile = read("Dockerfile");
  const stages = new Set(Array.from(dockerfile.matchAll(/^FROM .+ AS (\S+)$/gm), ([, s]) => s));
  const baseImages = Array.from(dockerfile.matchAll(/^FROM (\S+)/gm), ([, image]) => image).filter(
    (image) => !stages.has(image),
  );

  it("are pinned by digest, wherever they run", () => {
    for (const found of [ciImages, composeImages, baseImages]) expect(found).not.toEqual([]);
    for (const image of [...ciImages, ...composeImages, ...baseImages]) {
      expect(image).toMatch(PINNED_IMAGE);
    }
  });

  it("in CI are ones docker-compose.yml runs, the copy Dependabot updates", () => {
    expect(ciImages.filter((image) => !composeImages.includes(image))).toEqual([]);
  });
});

describe("package.json", () => {
  it("pins every prerelease exactly: a range would take any later beta", () => {
    const Package = z.object({
      dependencies: z.record(z.string(), z.string()),
      devDependencies: z.record(z.string(), z.string()),
    });
    const { dependencies, devDependencies } = Package.parse(JSON.parse(read("package.json")));
    const ranged = Object.entries({ ...dependencies, ...devDependencies }).filter(
      ([, version]) => version.includes("-") && !/^\d/.test(version),
    );

    expect(ranged).toEqual([]);
  });
});
