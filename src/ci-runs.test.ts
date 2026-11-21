import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import {
  WORKFLOW_FILES,
  evaluate,
  runsFor,
  type PullRequest,
  type PullRequestEvent,
} from "../test/github-actions";

/*
 * CI spends a run only where it can catch something (#248). GitHub cannot run
 * here, so each event is played through the workflows themselves. A skipped job
 * passes a ruleset's required check, and the latest check of a name counts, so
 * nothing that changes no code may start a run that skips one under that name.
 */

const read = (path: string): string => readFileSync(path, "utf8");

// The checks the dev and stage rulesets require (D-244-2).
const REQUIRED = [
  "Lint, types and format",
  "Tests and coverage",
  "End-to-end smoke",
  "Production build",
];

const CODE = ["src/app/page.tsx", "docs/tasks/248-ci-runs.md"];
const DOCS = ["docs/tasks/248-ci-runs.md", "CLAUDE.md", ".claude/agents/builder.md"];

const pr = (changes: Partial<PullRequest> = {}): PullRequest => ({
  draft: false,
  base: "dev",
  labels: [],
  changed: CODE,
  ...changes,
});
const on = (action: string, pullRequest: PullRequest, label?: string): PullRequestEvent =>
  label === undefined ? { action, pullRequest } : { action, pullRequest, label };

const checksOf = (event: PullRequestEvent, failing: readonly string[] = []) =>
  runsFor(event, failing).flatMap((run) => run.checks);
const ran = (event: PullRequestEvent): string[] =>
  checksOf(event)
    .filter((check) => check.result !== "skipped")
    .map((check) => check.name);
const requiredOf = (event: PullRequestEvent) =>
  checksOf(event).filter((check) => REQUIRED.includes(check.name));

const CODE_ACTIONS = ["opened", "synchronize", "reopened", "ready_for_review"];
const BASES = ["dev", "stage", "main", "chore/244-stage-stack"];

describe("a pull request's runs", () => {
  it("run no job while it is a draft", () => {
    for (const action of ["opened", "synchronize", "reopened"]) {
      for (const base of BASES) {
        expect(ran(on(action, pr({ draft: true, base, labels: ["e2e"] })))).toEqual([]);
      }
    }
    expect(runsFor(on("converted_to_draft", pr({ draft: true })))).toEqual([]);
  });

  it("run once when it is marked ready, everything its base calls for", () => {
    const runs = runsFor(on("ready_for_review", pr({ base: "stage" })));

    expect(runs.map((run) => run.workflow)).toEqual(["CI"]);
    expect(ran(on("ready_for_review", pr({ base: "stage" })))).toEqual(REQUIRED);
  });

  it("stop at a lint failure, before tests, E2E and the build start", () => {
    const checks = checksOf(on("synchronize", pr({ base: "main" })), ["static"]);

    expect(checks.map((check) => [check.name, check.result])).toEqual([
      ["Lint, types and format", "failure"],
      ["Tests and coverage", "skipped"],
      ["End-to-end smoke", "skipped"],
      ["Production build", "skipped"],
    ]);
  });

  it("report every required check, run or skipped, so each can merge", () => {
    for (const action of CODE_ACTIONS) {
      for (const base of BASES) {
        for (const changed of [CODE, DOCS]) {
          for (const labels of [[], ["e2e"], ["type:chore"]]) {
            const names = requiredOf(on(action, pr({ base, changed, labels }))).map((c) => c.name);
            expect(names.toSorted()).toEqual(REQUIRED.toSorted());
          }
        }
      }
    }
  });

  it("run only the first job when only docs change", () => {
    expect(ran(on("synchronize", pr({ changed: DOCS })))).toEqual(["Lint, types and format"]);
    // Tests read README.md's sections, so it is code.
    expect(ran(on("synchronize", pr({ changed: ["README.md"] })))).toEqual([
      "Lint, types and format",
      "Tests and coverage",
      "Production build",
    ]);
  });

  it("skip E2E into dev or a feature branch, unless labelled e2e", () => {
    for (const base of ["dev", "chore/244-stage-stack"]) {
      expect(ran(on("synchronize", pr({ base })))).not.toContain("End-to-end smoke");
      expect(ran(on("synchronize", pr({ base, labels: ["type:chore"] })))).not.toContain(
        "End-to-end smoke",
      );
      expect(ran(on("synchronize", pr({ base, labels: ["e2e"] })))).toContain("End-to-end smoke");
    }
  });

  it("always run E2E into stage or main, docs only included", () => {
    for (const base of ["stage", "main"]) {
      for (const changed of [CODE, DOCS]) {
        expect(ran(on("synchronize", pr({ base, changed })))).toContain("End-to-end smoke");
      }
    }
  });

  it("start nothing when one merges", () => {
    expect(runsFor(on("closed", pr()))).toEqual([]);
    for (const path of WORKFLOW_FILES) {
      expect(
        Object.keys(
          z.object({ on: z.record(z.string(), z.unknown()) }).parse(parse(read(path))).on,
        ),
      ).toEqual(["pull_request"]);
    }
  });
});

describe("labelling a pull request", () => {
  it("with e2e runs E2E at once, under the required name, and nothing else", () => {
    const event = on("labeled", pr({ labels: ["e2e"] }), "e2e");

    expect(runsFor(event).map((run) => run.workflow)).toEqual(["E2E on label"]);
    expect(checksOf(event)).toEqual([{ job: "e2e", name: "End-to-end smoke", result: "success" }]);
  });

  it("with anything else runs no job and reports no required check", () => {
    for (const base of BASES) {
      for (const label of ["type:chore", "area:ci", "priority:P1"]) {
        const event = on("labeled", pr({ base, labels: [label] }), label);
        expect(ran(event)).toEqual([]);
        expect(requiredOf(event)).toEqual([]);
      }
    }
  });

  it("never replaces a required check with a skipped one", () => {
    for (const base of BASES) {
      for (const draft of [false, true]) {
        for (const label of ["e2e", "E2E", "type:chore"]) {
          const event = on("labeled", pr({ base, draft, labels: [label] }), label);
          for (const check of requiredOf(event)) expect(check.result).not.toBe("skipped");
        }
      }
    }
    // A draft's e2e label takes effect when it is marked ready.
    expect(ran(on("labeled", pr({ draft: true, labels: ["e2e"] }), "e2e"))).toEqual([]);
    expect(ran(on("ready_for_review", pr({ labels: ["e2e"] })))).toContain("End-to-end smoke");
  });

  it("cancels nothing CI is running, and one label's run cancels no other's", () => {
    const [ci] = runsFor(on("synchronize", pr()));
    const [chore] = runsFor(on("labeled", pr(), "type:chore"));
    const [e2e] = runsFor(on("labeled", pr(), "e2e"));

    expect(ci?.concurrency).toBeTruthy();
    expect(new Set([ci?.concurrency, chore?.concurrency, e2e?.concurrency]).size).toBe(3);
  });
});

describe("the workflows", () => {
  const Workflow = z.object({
    env: z.record(z.string(), z.string()),
    jobs: z.record(z.string(), z.record(z.string(), z.unknown())),
  });
  const workflows = WORKFLOW_FILES.map((path) => ({ path, ...Workflow.parse(parse(read(path))) }));

  const workflow = (name: string) =>
    workflows.find((found) => found.path === join(".github/workflows", name));

  it("give every job a timeout", () => {
    for (const { path, jobs } of workflows) {
      for (const [id, job] of Object.entries(jobs)) {
        expect(job["timeout-minutes"], `${path}: ${id}`).toBeGreaterThan(0);
      }
    }
  });

  it("run CI's own E2E job on a label", () => {
    // All but what decides whether it runs and what it is called.
    const e2eJob = (name: string) => {
      const found = workflow(name);
      const job = Object.entries(found?.jobs["e2e"] ?? {}).filter(
        ([key]) => !["name", "if", "needs"].includes(key),
      );
      return { env: found?.env, job: Object.fromEntries(job) };
    };

    expect(e2eJob("e2e-label.yml")).toEqual(e2eJob("ci.yml"));
    expect(e2eJob("ci.yml").job["steps"]).toEqual(expect.any(Array));
  });

  it("find the changes on the test merge commit, against its base", () => {
    const ci = workflow("ci.yml");
    const Static = z.object({
      steps: z.array(
        z.object({
          id: z.string().optional(),
          shell: z.string().optional(),
          run: z.string().optional(),
          with: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    });
    const { steps } = Static.parse(ci?.jobs["static"]);

    expect(steps[0]?.with?.["fetch-depth"]).toBe(2);
    expect(steps.find((step) => step.id === "changes")).toEqual({
      id: "changes",
      shell: "bash",
      run: 'git diff --no-renames --name-only HEAD^1 HEAD | scripts/ci-changes.sh >> "$GITHUB_OUTPUT"',
    });
  });
});

describe("scripts/ci-changes.sh", () => {
  const code = (changed: readonly string[]): string =>
    execFileSync("bash", ["scripts/ci-changes.sh"], {
      input: changed.join("\n"),
      encoding: "utf8",
    });

  it("counts docs/, .claude/ and top-level Markdown as docs", () => {
    expect(code(DOCS)).toBe("code=false\n");
    expect(code(["AGENTS.md"])).toBe("code=false\n");
    expect(code(["docs/tasks/README.md"])).toBe("code=false\n");
  });

  it("counts anything else as code, and an empty list fails closed", () => {
    for (const changed of [
      ["README.md"],
      ["public/README.md"],
      ["e2e/notes.md"],
      ["docsy/a.md"],
      ["docs"],
      [...DOCS, "package.json"],
      [],
    ]) {
      expect(code(changed)).toBe("code=true\n");
    }
  });

  it("counts every Markdown file a test reads as code", () => {
    const tests = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((name) => /\.test\.tsx?$/.test(name) && name !== "ci-runs.test.ts")
      .map((name) => read(join("src", name)));
    const named = tests.flatMap((text) =>
      Array.from(text.matchAll(/["'`]([\w./-]+\.md)["'`]/g), ([, path]) => path ?? ""),
    );
    const files = [...new Set(named)].filter((path) => existsSync(path));

    expect(files).toContain("README.md");
    for (const path of files)
      expect({ path, out: code([path]) }).toEqual({ path, out: "code=true\n" });
  });
});

describe("the expression model", () => {
  const github = { event: { pull_request: { labels: [{ name: "e2e" }], draft: false } } };

  it("reads GitHub's operators as GitHub does", () => {
    expect(evaluate("contains(github.event.pull_request.labels.*.name, 'E2E')", { github })).toBe(
      true,
    );
    expect(evaluate("!github.event.pull_request.draft && 'yes' || 'no'", { github })).toBe("yes");
    expect(evaluate("github.event.pull_request.draft && 'yes' || 'no'", { github })).toBe("no");
    expect(evaluate("github.missing == 'true'", { github })).toBe(false);
    expect(evaluate("(false || 'it''s')", { github })).toBe("it's");
  });

  it("refuses what it does not model", () => {
    expect(() => evaluate("always()", { github })).toThrow(/no always\(\)/);
    expect(() => evaluate("vars.X == 'y'", { github })).toThrow(/no "vars" context/);
    expect(() => evaluate("github.a ==", { github })).toThrow(/ends too soon/);
  });
});

describe(".github/dependabot.yml", () => {
  it("opens version updates monthly against dev, and never rebases them unasked", () => {
    const Dependabot = z.object({
      updates: z.array(
        z.object({
          "package-ecosystem": z.string(),
          "target-branch": z.string(),
          "rebase-strategy": z.string(),
          schedule: z.object({ interval: z.string() }),
        }),
      ),
    });
    const { updates } = Dependabot.parse(parse(read(".github/dependabot.yml")));

    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update).toMatchObject({
        "target-branch": "dev",
        "rebase-strategy": "disabled",
        schedule: { interval: "monthly" },
      });
    }
  });
});
