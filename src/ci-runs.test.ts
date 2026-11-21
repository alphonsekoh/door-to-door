import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import {
  WORKFLOW_FILES,
  evaluate,
  play,
  runsFor,
  type Moment,
  type Played,
  type PullRequest,
  type PullRequestEvent,
} from "../test/github-actions";

/*
 * CI spends a run only where it can catch something (#248). GitHub cannot run
 * here, so each event is played through the workflows themselves. A skipped job
 * passes a ruleset's required check, and the newest check of a name counts, so
 * no label or edit may start a run that skips one under that name, no draft's
 * run may report Lint, no run may report one late enough to outrank a later
 * event's run, and no re-run, which replays its event, may skip one the pull
 * request now needs. A draft's run that GitHub starts after the ready one is
 * the exception, pinned below, that README's draft rule works around.
 */

const read = (path: string): string => readFileSync(path, "utf8");

// The checks the dev, stage and main rulesets require (D-244-2, D-244-30).
const LINT = "Lint, types and format";
const E2E = "End-to-end smoke";
const REQUIRED = [LINT, "Tests and coverage", E2E, "Production build"];

const CODE = ["src/app/page.tsx", "docs/tasks/248-ci-runs.md"];
const DOCS = ["docs/tasks/248-ci-runs.md", "CLAUDE.md", ".claude/agents/builder.md"];

const pr = (changes: Partial<PullRequest> = {}): PullRequest => ({
  draft: false,
  base: "dev",
  labels: [],
  changed: CODE,
  ...changes,
});
const on = (
  action: string,
  pullRequest: PullRequest,
  more: Omit<PullRequestEvent, "action" | "pullRequest"> = {},
): PullRequestEvent => ({ action, pullRequest, ...more });
const labelled = (label: string, pullRequest: PullRequest = pr({ labels: [label] })) =>
  on("labeled", pullRequest, { label });
const retargeted = (previousBase: string, pullRequest: PullRequest) =>
  on("edited", pullRequest, { previousBase });
// Re-run all jobs of an event's run, once the pull request has the base and labels given.
const rerun = (
  event: PullRequestEvent,
  now: Pick<PullRequest, "base" | "labels">,
): PullRequestEvent => ({
  ...event,
  now,
  attempt: 2,
});

const checksOf = (event: PullRequestEvent, failing: readonly string[] = []) =>
  runsFor(event, failing).flatMap((run) => run.checks);
const ran = (event: PullRequestEvent): string[] =>
  checksOf(event)
    .filter((check) => check.result !== "skipped")
    .map((check) => check.name);
const requiredOf = (event: PullRequestEvent) =>
  checksOf(event).filter((check) => REQUIRED.includes(check.name));

/*
 * What the merge box reads after events on one head commit: the newest check
 * of each required name. A run's checks are created at its event's moment plus
 * their stage, so an event at 0.5 comes while the first run's lint job runs.
 */
function counted(...moments: Moment[]): Record<string, Played | undefined> {
  const checks = play(...moments).toSorted((a, b) => a.at - b.at);
  return Object.fromEntries(
    REQUIRED.map((name) => [name, checks.findLast((check) => check.name === name)]),
  );
}
const resultsOf = (found: Record<string, Played | undefined>) =>
  REQUIRED.map((name) => found[name]?.result);

const CODE_ACTIONS = ["opened", "synchronize", "reopened", "ready_for_review"];
const BASES = ["dev", "stage", "main", "chore/244-stage-stack"];
const LABELS = [[], ["e2e"], ["type:chore"]];

// Every event either workflow starts on, for every kind of pull request.
const EVENTS: PullRequestEvent[] = BASES.flatMap((base) =>
  [false, true].flatMap((draft) =>
    LABELS.flatMap((labels) =>
      [CODE, DOCS].flatMap((changed) => {
        const pullRequest = pr({ base, draft, labels, changed });
        return [
          ...CODE_ACTIONS.map((action) => on(action, pullRequest)),
          ...["e2e", "type:chore"].map((label) =>
            labelled(label, { ...pullRequest, labels: [...labels, label] }),
          ),
          on("edited", pullRequest),
          retargeted(base === "dev" ? "stage" : "dev", pullRequest),
        ];
      }),
    ),
  ),
);
// Every base and set of labels a pull request can have by the time a run is re-run.
const NOW = BASES.flatMap((base) => LABELS.map((labels) => ({ base, labels })));

describe("a pull request's runs", () => {
  it("run no job while it is a draft", () => {
    for (const action of ["opened", "synchronize", "reopened"]) {
      for (const base of BASES) {
        expect(ran(on(action, pr({ draft: true, base, labels: ["e2e"] })))).toEqual([]);
      }
    }
    expect(runsFor(on("converted_to_draft", pr({ draft: true })))).toEqual([]);
  });

  it("report no Lint check while it is a draft, so a draft's skips never pass for a run", () => {
    // All the merge box has from marking a draft ready until the ready run's checks appear.
    for (const action of ["opened", "synchronize", "reopened"]) {
      for (const base of BASES) {
        for (const changed of [CODE, DOCS]) {
          for (const labels of LABELS) {
            const found = counted({
              at: 0,
              event: on(action, pr({ draft: true, base, changed, labels })),
            });
            expect(found[LINT], `${action} into ${base}`).toBeUndefined();
          }
        }
      }
    }
  });

  it("leave Lint cancelled when a draft's run cancels the ready run while its lint job runs", () => {
    // The push came first, but its run began after the ready run's, while lint ran.
    for (const base of BASES) {
      for (const changed of [CODE, DOCS]) {
        for (const at of [0, 0.5, 0.99]) {
          const ready = on("ready_for_review", pr({ base, changed }));
          const draftPush = on("synchronize", pr({ base, changed, draft: true }));
          const found = counted({ at: 0, event: ready }, { at, event: draftPush });

          expect(found[LINT], `into ${base}, at ${String(at)}`).toMatchObject({
            workflow: "CI",
            job: "static",
            result: "cancelled",
          });
          // Re-running either run all over runs lint, and whatever the pull request calls for.
          for (const again of [
            rerun(draftPush, { base, labels: [] }),
            rerun(ready, { base, labels: [] }),
          ]) {
            const after = counted(
              { at: 0, event: ready },
              { at, event: draftPush },
              { at: 5, event: again, failing: ["test"] },
            );
            expect(after[LINT]).toMatchObject({ job: "static", result: "success" });
            expect(after["Tests and coverage"]?.result).toBe(
              changed === CODE ? "failure" : "skipped",
            );
          }
        }
      }
    }
  });

  it("let a draft's run that begins after the ready lint pass the other three, so ready waits for the push's run", () => {
    // The limit README's draft rule covers: the other three skips keep their required names.
    const failing = ["test", "e2e", "build"];
    const failed = ["success", "failure", "failure", "failure"];
    for (const base of BASES) {
      const pullRequest = pr({ base, labels: ["e2e"] });
      const ready = on("ready_for_review", pullRequest);
      const draftPush = on("synchronize", { ...pullRequest, draft: true });

      for (const at of [0.01, 0.5, 3]) {
        const found = counted({ at: 0, event: draftPush }, { at, event: ready, failing });
        expect(resultsOf(found), `into ${base}, ready at ${String(at)}`).toEqual(failed);
      }
      for (const at of [1, 1.5, 3, 10]) {
        const found = counted({ at: 0, event: ready, failing }, { at, event: draftPush });
        expect(resultsOf(found), `into ${base}, draft's run at ${String(at)}`).toEqual([
          "success",
          "skipped",
          "skipped",
          "skipped",
        ]);
        for (const again of [rerun(draftPush, pullRequest), rerun(ready, pullRequest)]) {
          const after = counted(
            { at: 0, event: ready, failing },
            { at, event: draftPush },
            { at: at + 5, event: again, failing },
          );
          expect(resultsOf(after)).toEqual(failed);
        }
      }
    }
  });

  it("let a reopen as a draft pass the other three, until it is marked ready again", () => {
    // Only the draft state stops a merge, and then only until the new run's checks appear.
    const failing = ["test", "e2e", "build"];
    for (const base of BASES) {
      const pullRequest = pr({ base, labels: ["e2e"] });
      const reopened: Moment[] = [
        { at: 0, event: on("ready_for_review", pullRequest), failing },
        { at: 5, event: on("reopened", { ...pullRequest, draft: true }) },
      ];

      expect(resultsOf(counted(...reopened)), base).toEqual([
        "success",
        "skipped",
        "skipped",
        "skipped",
      ]);
      const readyAgain = { at: 6, event: on("ready_for_review", pullRequest), failing };
      expect(resultsOf(counted(...reopened, readyAgain))).toEqual([
        "success",
        "failure",
        "failure",
        "failure",
      ]);
    }
  });

  it("run once when it is marked ready, everything its base calls for", () => {
    const runs = runsFor(on("ready_for_review", pr({ base: "stage" })));

    expect(runs.map((run) => run.workflow)).toEqual(["CI"]);
    expect(ran(on("ready_for_review", pr({ base: "stage" })))).toEqual(REQUIRED);
  });

  it("stop at a lint failure, before tests, E2E and the build start", () => {
    const event = on("synchronize", pr({ base: "main" }));
    const checks = checksOf(event, ["static"]);

    expect(checks.filter((check) => check.result !== "skipped").map((check) => check.job)).toEqual([
      "static",
    ]);
    expect(counted({ at: 0, event, failing: ["static"] })[LINT]).toMatchObject({
      result: "failure",
    });
  });

  it("report every required check, run or skipped, so each can merge", () => {
    for (const action of CODE_ACTIONS) {
      for (const base of BASES) {
        for (const changed of [CODE, DOCS]) {
          for (const labels of LABELS) {
            const found = counted({ at: 0, event: on(action, pr({ base, changed, labels })) });
            for (const name of REQUIRED) {
              expect(found[name]?.result, `${action} into ${base}: ${name}`).toMatch(
                /^(success|skipped)$/,
              );
            }
          }
        }
      }
    }
  });

  it("run only the first job when only docs change", () => {
    expect(ran(on("synchronize", pr({ changed: DOCS })))).toEqual([LINT]);
    // Tests read README.md's sections, so it is code.
    expect(ran(on("synchronize", pr({ changed: ["README.md"] })))).toEqual([
      LINT,
      "Tests and coverage",
      "Production build",
    ]);
  });

  it("skip E2E into dev or a feature branch, unless labelled e2e", () => {
    for (const base of ["dev", "chore/244-stage-stack"]) {
      expect(ran(on("synchronize", pr({ base })))).not.toContain(E2E);
      expect(ran(on("synchronize", pr({ base, labels: ["type:chore"] })))).not.toContain(E2E);
      expect(ran(on("synchronize", pr({ base, labels: ["e2e"] })))).toContain(E2E);
    }
  });

  it("always run E2E into stage or main, docs only included", () => {
    for (const base of ["stage", "main"]) {
      for (const changed of [CODE, DOCS]) {
        expect(ran(on("synchronize", pr({ base, changed })))).toContain(E2E);
        expect(counted({ at: 0, event: on("synchronize", pr({ base, changed })) })[E2E]).toEqual(
          expect.objectContaining({ job: "e2e", result: "success" }),
        );
      }
    }
  });

  it("report E2E skipped as the run begins, and later only a run of it", () => {
    for (const action of CODE_ACTIONS) {
      for (const base of BASES) {
        for (const labels of LABELS) {
          // A failed lint job may have set its outputs before it failed.
          for (const failing of [[], ["static"]]) {
            const checks = checksOf(on(action, pr({ base, labels })), failing)
              .filter((check) => check.name === E2E)
              .toSorted((a, b) => a.stage - b.stage);

            expect(checks[0]).toEqual({
              job: "e2e-placeholder",
              name: E2E,
              result: "skipped",
              stage: 0,
            });
            for (const check of checks.slice(1)) expect(check.result).toBe("success");
          }
        }
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

describe("a label or a retarget while CI runs, or after", () => {
  it("with the e2e label runs E2E at once, under the required name, and nothing else", () => {
    const event = labelled("e2e");

    expect(runsFor(event).map((run) => run.workflow)).toEqual(["E2E catch-up"]);
    expect(checksOf(event)).toEqual([{ job: "e2e", name: E2E, result: "success", stage: 0 }]);
  });

  it("with the e2e label counts over CI's skip, even when added while lint runs", () => {
    // gh pr create --label, and Dependabot, add labels just after opening.
    for (const action of CODE_ACTIONS) {
      for (const base of ["dev", "chore/244-stage-stack"]) {
        for (const at of [0.5, 3]) {
          const found = counted(
            { at: 0, event: on(action, pr({ base })) },
            { at, event: labelled("e2e", pr({ base, labels: ["e2e"] })), failing: ["e2e"] },
          );
          expect(found[E2E], `${action} into ${base}, label at ${String(at)}`).toMatchObject({
            workflow: "E2E catch-up",
            result: "failure",
          });
        }
      }
    }
  });

  it("with the e2e label before lint reads it runs E2E in CI too, whichever check comes first", () => {
    // The labeled event's run may even be created before CI's, placeholder and all.
    for (const action of CODE_ACTIONS) {
      for (const base of ["dev", "chore/244-stage-stack"]) {
        for (const at of [-0.1, 0, 0.05, 0.5]) {
          const labels = ["e2e"];
          const found = counted(
            { at: 0, event: on(action, pr({ base }), { now: { base, labels } }), failing: ["e2e"] },
            { at, event: labelled("e2e", pr({ base, labels })), failing: ["e2e"] },
          );
          expect(found[E2E], `${action} into ${base}, label at ${String(at)}`).toMatchObject({
            workflow: "CI",
            job: "e2e",
            result: "failure",
          });
        }
      }
    }
  });

  it("retargeted to stage or main runs E2E at once, and it counts", () => {
    for (const base of ["stage", "main"]) {
      for (const previousBase of ["dev", "chore/244-stage-stack"]) {
        expect(ran(retargeted(previousBase, pr({ base })))).toEqual([E2E]);
        for (const at of [0.5, 3]) {
          const found = counted(
            { at: 0, event: on("synchronize", pr({ base: previousBase })) },
            { at, event: retargeted(previousBase, pr({ base })), failing: ["e2e"] },
          );
          expect(found[E2E]).toMatchObject({ workflow: "E2E catch-up", result: "failure" });
        }
        // Retargeted before lint reads the base, CI runs E2E itself, after its placeholder.
        for (const at of [-0.1, 0.05]) {
          const found = counted(
            {
              at: 0,
              event: on("synchronize", pr({ base: previousBase }), { now: { base, labels: [] } }),
              failing: ["e2e"],
            },
            { at, event: retargeted(previousBase, pr({ base })), failing: ["e2e"] },
          );
          expect(found[E2E]).toMatchObject({ workflow: "CI", job: "e2e", result: "failure" });
        }
      }
    }
  });

  it("with any other label, any other edit, or as a draft, runs nothing and reports no required check", () => {
    const quiet: PullRequestEvent[] = [
      ...BASES.flatMap((base) => [
        ...["type:chore", "area:ci", "priority:P1"].map((label) =>
          labelled(label, pr({ base, labels: [label] })),
        ),
        labelled("e2e", pr({ base, draft: true, labels: ["e2e"] })),
        // A title or body edit.
        on("edited", pr({ base })),
      ]),
      retargeted("stage", pr({ base: "dev" })),
      retargeted("main", pr({ base: "chore/244-stage-stack" })),
      retargeted("dev", pr({ base: "stage", draft: true })),
      retargeted("dev", pr({ base: "main", draft: true })),
    ];

    for (const event of quiet) {
      expect(ran(event)).toEqual([]);
      expect(requiredOf(event)).toEqual([]);
    }
  });

  it("never replaces a required check with a skipped one", () => {
    for (const event of EVENTS.filter((e) => ["labeled", "edited"].includes(e.action))) {
      for (const check of requiredOf(event)) expect(check.result).not.toBe("skipped");
    }
    // A draft's e2e label takes effect when it is marked ready.
    expect(ran(labelled("e2e", pr({ draft: true, labels: ["e2e"] })))).toEqual([]);
    expect(ran(on("ready_for_review", pr({ labels: ["e2e"] })))).toContain(E2E);
  });

  it("cancel nothing, not CI's run nor each other's", () => {
    const [ci] = runsFor(on("synchronize", pr()));
    const later = [labelled("e2e"), labelled("type:chore"), on("edited", pr())];

    expect(ci?.concurrency).toBeTruthy();
    for (const event of later) {
      expect(runsFor(event).map((run) => [run.workflow, run.concurrency])).toEqual([
        ["E2E catch-up", null],
      ]);
    }
    // A title edit while a retarget's E2E runs, and a label while CI's lint runs.
    const played = play(
      { at: 0, event: on("synchronize", pr({ base: "dev" })) },
      { at: 0.2, event: retargeted("dev", pr({ base: "stage" })) },
      { at: 0.5, event: on("edited", pr({ base: "stage" })) },
      { at: 0.7, event: labelled("type:chore", pr({ base: "stage", labels: ["type:chore"] })) },
    );
    expect(played.filter((check) => check.result === "cancelled")).toEqual([]);
    expect(played.filter((check) => check.name === E2E && check.result === "success")).toEqual([
      expect.objectContaining({ workflow: "E2E catch-up", at: 0.2 }),
    ]);
  });
});

describe("a re-run, which replays the event that started its run", () => {
  it("skips no check that a ready run of the pull request as it is now would run", () => {
    for (const event of EVENTS) {
      for (const now of NOW) {
        const again = counted({ at: 0, event: rerun(event, now) });
        const fresh = counted({
          at: 0,
          event: on("synchronize", { ...event.pullRequest, ...now, draft: false }),
        });
        for (const name of REQUIRED) {
          if (again[name]?.result !== "skipped") continue;
          expect(fresh[name]?.result, `${event.action} re-run: ${name}`).toBe("skipped");
        }
      }
    }
  });

  it("of CI after a failed E2E catch-up runs E2E again, and its result counts", () => {
    const base = "dev";
    for (const failing of [["e2e"], []]) {
      const found = counted(
        { at: 0, event: on("ready_for_review", pr({ base })) },
        { at: 5, event: labelled("e2e", pr({ base, labels: ["e2e"] })), failing: ["e2e"] },
        {
          at: 10,
          event: rerun(on("ready_for_review", pr({ base })), { base, labels: ["e2e"] }),
          failing,
        },
      );
      expect(found[E2E]).toMatchObject({
        workflow: "CI",
        job: "e2e",
        result: failing.length > 0 ? "failure" : "success",
      });
    }
  });

  it("of CI from before a retarget to stage or main runs E2E", () => {
    for (const base of ["stage", "main"]) {
      const found = counted(
        { at: 0, event: on("synchronize", pr()) },
        { at: 5, event: retargeted("dev", pr({ base })), failing: ["e2e"] },
        { at: 10, event: rerun(on("synchronize", pr()), { base, labels: [] }), failing: ["e2e"] },
      );
      expect(found[E2E]).toMatchObject({ workflow: "CI", job: "e2e", result: "failure" });
    }
  });

  it("of a draft's run, after it was marked ready on the same commit, runs every job", () => {
    const draft = on("synchronize", pr({ base: "stage", draft: true }));
    const jobs = {
      static: LINT,
      test: "Tests and coverage",
      e2e: E2E,
      build: "Production build",
    };
    for (const [job, name] of Object.entries(jobs)) {
      const found = counted(
        { at: 0, event: draft },
        { at: 5, event: on("ready_for_review", pr({ base: "stage" })), failing: [job] },
        { at: 15, event: rerun(draft, { base: "stage", labels: [] }), failing: [job] },
      );
      expect(found[name], job).toMatchObject({ job, result: "failure" });
    }
  });
});

describe("Dependabot's pull requests", () => {
  // Its commits never pass .githooks/pre-push, so CI is the first to run E2E on them.
  it("carry the e2e label, so E2E runs on them into dev", () => {
    const Dependabot = z.object({ updates: z.array(z.object({ labels: z.array(z.string()) })) });
    const { updates } = Dependabot.parse(parse(read(".github/dependabot.yml")));
    const labels = ["type:chore", "e2e"];

    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) expect(update.labels).toContain("e2e");
    // Labelled about a second after it opens, then rebased with "@dependabot rebase". A
    // label from before CI's run began is one its lint job reads.
    for (const { at, seen } of [
      { at: -0.1, seen: labels },
      { at: 0.1, seen: labels },
      { at: 0.1, seen: [] },
    ]) {
      const found = counted(
        {
          at: 0,
          event: on("opened", pr(), { now: { base: "dev", labels: seen } }),
          failing: ["e2e"],
        },
        { at, event: labelled("e2e", pr({ labels })), failing: ["e2e"] },
      );
      expect(found[E2E], `label at ${String(at)}`).toMatchObject({ result: "failure" });
    }
    expect(ran(on("synchronize", pr({ labels })))).toContain(E2E);
  });
});

describe("the workflows", () => {
  const Workflow = z.object({
    name: z.string(),
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

  it("run CI's own E2E job when it falls due later", () => {
    // All but what decides whether it runs and what it is called.
    const e2eJob = (name: string) => {
      const found = workflow(name);
      const job = Object.entries(found?.jobs["e2e"] ?? {}).filter(
        ([key]) => !["name", "if", "needs"].includes(key),
      );
      return { env: found?.env, job: Object.fromEntries(job) };
    };

    expect(e2eJob("e2e-catch-up.yml")).toEqual(e2eJob("ci.yml"));
    expect(e2eJob("ci.yml").job["steps"]).toEqual(expect.any(Array));
  });

  it("skip a required check only under a fixed name", () => {
    // GitHub shows a skipped job's name expression as written (#260's runs), and
    // documents neither way, so no required check may rest on evaluating it.
    const Named = z.object({ name: z.string() });
    const nameOf = (run: string, job: string) =>
      Named.parse(workflows.find((found) => found.name === run)?.jobs[job]).name;

    const replayed = EVENTS.flatMap((event) => NOW.map((now) => rerun(event, now)));
    const skipped = [...EVENTS, ...replayed].flatMap((event) =>
      runsFor(event).flatMap((run) =>
        run.checks
          .filter((check) => check.result === "skipped" && REQUIRED.includes(check.name))
          .map((check) => ({ ...check, fixed: nameOf(run.workflow, check.job) })),
      ),
    );

    expect(skipped.length).toBeGreaterThan(0);
    for (const check of skipped) expect(check.fixed).toBe(check.name);
  });

  const Steps = z.object({
    steps: z.array(
      z.object({
        name: z.string().optional(),
        id: z.string().optional(),
        uses: z.string().optional(),
        shell: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
        run: z.string().optional(),
        with: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  });
  const staticSteps = () => Steps.parse(workflow("ci.yml")?.jobs["static"]).steps;

  it("find the changes on the test merge commit, against its base", () => {
    const steps = staticSteps();

    expect(steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with).toEqual({
      "persist-credentials": false,
      "fetch-depth": 2,
    });
    expect(steps.find((step) => step.id === "changes")).toEqual({
      name: "Find what this pull request changes",
      id: "changes",
      shell: "bash",
      run: 'git diff --no-renames --name-only HEAD^1 HEAD | scripts/ci-changes.sh >> "$GITHUB_OUTPUT"',
    });
  });

  it("decide E2E from the pull request as the API lists it, base first, then each label", () => {
    const steps = staticSteps();

    expect(steps[0]).toEqual({
      name: "Read the pull request as it is now",
      env: {
        GH_TOKEN: "${{ github.token }}",
        PR: "${{ github.event.pull_request.number }}",
      },
      run: `gh api "repos/$GITHUB_REPOSITORY/pulls/$PR" --jq '.base.ref, .labels[].name' > "$RUNNER_TEMP/pull-request"`,
    });
    expect(steps.find((step) => step.id === "e2e")).toEqual({
      name: "Decide whether E2E runs",
      id: "e2e",
      shell: "bash",
      run: 'scripts/ci-e2e.sh < "$RUNNER_TEMP/pull-request" >> "$GITHUB_OUTPUT"',
    });
  });

  it("hand the token to one step, before any code from the pull request or npm runs", () => {
    const withToken = workflows.flatMap(({ path, jobs }) =>
      Object.entries(jobs).flatMap(([id, job]) =>
        Steps.parse(job).steps.flatMap((step, at) =>
          JSON.stringify(step).includes("github.token") ? [{ path, id, at }] : [],
        ),
      ),
    );

    expect(withToken).toEqual([{ path: ".github/workflows/ci.yml", id: "static", at: 0 }]);
    for (const { path } of workflows) expect(read(path)).not.toMatch(/secrets\./);
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

describe("scripts/ci-e2e.sh", () => {
  const e2e = (base: string, ...labels: string[]): string =>
    execFileSync("bash", ["scripts/ci-e2e.sh"], {
      input: [base, ...labels].join("\n"),
      encoding: "utf8",
    });

  it("runs E2E into stage or main, whatever the labels", () => {
    for (const base of ["stage", "main", "Stage"]) {
      expect(e2e(base)).toBe("e2e=true\n");
      expect(e2e(base, "type:chore")).toBe("e2e=true\n");
    }
  });

  it("runs it elsewhere only with the e2e label, in any case", () => {
    expect(e2e("dev")).toBe("e2e=false\n");
    expect(e2e("chore/244-stage-stack", "type:chore", "area:ci")).toBe("e2e=false\n");
    expect(e2e("dev", "e2e-later", "no-e2e", "staged")).toBe("e2e=false\n");
    expect(e2e("main-old")).toBe("e2e=false\n");
    expect(e2e("dev", "type:chore", "e2e")).toBe("e2e=true\n");
    expect(e2e("dev", "E2E", "area:ci")).toBe("e2e=true\n");
  });

  it("runs it when it reads no base: it fails closed", () => {
    expect(e2e("")).toBe("e2e=true\n");
  });
});

describe("the model's playback", () => {
  it("cuts a run short when the next in its concurrency group begins", () => {
    const push = on("synchronize", pr({ base: "stage" }));
    // The first run's checks, which come first, by job: the result, and when it was created.
    const first = (next: number) =>
      Object.fromEntries(
        play({ at: 0, event: push }, { at: next, event: push })
          .slice(0, 5)
          .map(({ job, result, at }) => [job, [result, at]]),
      );

    // While lint runs, it is cancelled and the jobs that need it skip.
    expect(first(0.5)).toEqual({
      static: ["cancelled", 0],
      "e2e-placeholder": ["skipped", 0],
      test: ["skipped", 0.5],
      e2e: ["skipped", 0.5],
      build: ["skipped", 0.5],
    });
    // After it, lint stands and what was running is cancelled.
    expect(first(1.5)).toEqual({
      static: ["success", 0],
      "e2e-placeholder": ["skipped", 0],
      test: ["cancelled", 1],
      e2e: ["cancelled", 1],
      build: ["cancelled", 1],
    });
    expect(first(2)).toEqual({
      static: ["success", 0],
      "e2e-placeholder": ["skipped", 0],
      test: ["success", 1],
      e2e: ["success", 1],
      build: ["success", 1],
    });
  });
});

describe("the expression model", () => {
  const github = {
    event: {
      pull_request: { labels: [{ name: "e2e" }], draft: false },
      changes: { base: { ref: { from: "dev" } } },
    },
  };

  it("reads GitHub's operators as GitHub does", () => {
    expect(evaluate("contains(github.event.pull_request.labels.*.name, 'E2E')", { github })).toBe(
      true,
    );
    expect(evaluate("!github.event.pull_request.draft && 'yes' || 'no'", { github })).toBe("yes");
    expect(evaluate("github.event.pull_request.draft && 'yes' || 'no'", { github })).toBe("no");
    expect(evaluate("github.event.changes.base && 'yes' || 'no'", { github })).toBe("yes");
    expect(evaluate("github.event.changes.title && 'yes' || 'no'", { github })).toBe("no");
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
