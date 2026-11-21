import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/*
 * What GitHub Actions decides for a pull request event, read from the
 * workflows themselves (#248): which workflows run, which jobs run or skip,
 * the check name each reports, and when. Only what .github/workflows uses is
 * modelled: pull_request triggers, re-runs, needs, a job's if, name and
 * outputs, the two scripts whose output a job passes on, and the expression
 * syntax below. Anything else throws, so a new construct fails a test instead
 * of being misread.
 */

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
type Context = Readonly<Record<string, Value>>;

type Token = { kind: "string" | "op" | "path"; text: string };

function tokenize(source: string): Token[] {
  const pattern =
    /\s*(?:'((?:[^']|'')*)'|(\|\||&&|==|!=|!|\(|\)|,)|([A-Za-z_][\w-]*(?:\.(?:[A-Za-z_][\w-]*|\*))*))\s*/y;
  const tokens: Token[] = [];
  while (pattern.lastIndex < source.length) {
    const at = pattern.lastIndex;
    const match = pattern.exec(source);
    if (match === null) throw new Error(`Cannot read "${source}" at ${String(at)}`);
    const [, string, op, path] = match;
    if (string !== undefined) tokens.push({ kind: "string", text: string.replaceAll("''", "'") });
    else if (op !== undefined) tokens.push({ kind: "op", text: op });
    else tokens.push({ kind: "path", text: path ?? "" });
  }
  return tokens;
}

const isRecord = (value: Value): value is Record<string, Value> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// GitHub's falsy values, but NaN, which nothing here yields.
const truthy = (value: Value): boolean =>
  value !== false && value !== 0 && value !== "" && value !== null;

// GitHub compares strings ignoring case, and values of different types as numbers.
function equals(left: Value, right: Value): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return left.toLowerCase() === right.toLowerCase();
  }
  if (typeof left === typeof right) return left === right;
  return Number(left) === Number(right);
}

function lookup(context: Context, path: string): Value {
  const [root = "", ...keys] = path.split(".");
  if (!(root in context)) throw new Error(`The model has no "${root}" context: ${path}`);
  let values: Value[] = [context[root] ?? null];
  let filtered = false;
  for (const key of keys) {
    if (key === "*") {
      filtered = true;
      values = values.flatMap((value) =>
        Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [],
      );
    } else {
      values = values.map((value) => (isRecord(value) ? (value[key] ?? null) : null));
    }
  }
  return filtered ? values : (values[0] ?? null);
}

function call(name: string, args: Value[]): Value {
  const [search, item] = args;
  if (name !== "contains" || args.length !== 2 || search === undefined || item === undefined) {
    throw new Error(`The model has no ${name}() with ${String(args.length)} arguments`);
  }
  if (Array.isArray(search)) return search.some((element) => equals(element, item));
  if (typeof search === "string" && typeof item === "string") {
    return search.toLowerCase().includes(item.toLowerCase());
  }
  throw new Error("The model's contains() takes an array, or two strings");
}

/** Evaluates one expression, the part inside `${{ }}`. */
export function evaluate(source: string, context: Context): Value {
  const tokens = tokenize(source);
  let at = 0;
  const take = (op: string): boolean => {
    const token = tokens[at];
    if (token?.kind !== "op" || token.text !== op) return false;
    at += 1;
    return true;
  };
  const need = (op: string): void => {
    if (!take(op)) throw new Error(`Expected "${op}" in "${source}"`);
  };

  // Precedence, loosest first: ||, &&, == and !=, then !.
  const or = (): Value => {
    let left = and();
    while (take("||")) {
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const and = (): Value => {
    let left = comparison();
    while (take("&&")) {
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const comparison = (): Value => {
    const left = not();
    if (take("==")) return equals(left, not());
    if (take("!=")) return !equals(left, not());
    return left;
  };
  const not = (): Value => (take("!") ? !truthy(not()) : primary());
  const primary = (): Value => {
    const token = tokens[at];
    if (token === undefined) throw new Error(`"${source}" ends too soon`);
    at += 1;
    if (token.kind === "string") return token.text;
    if (token.kind === "op") {
      if (token.text !== "(") throw new Error(`Unexpected "${token.text}" in "${source}"`);
      const inner = or();
      need(")");
      return inner;
    }
    if (token.text === "true") return true;
    if (token.text === "false") return false;
    if (token.text === "null") return null;
    if (!take("(")) return lookup(context, token.text);
    const args: Value[] = [];
    if (!take(")")) {
      do args.push(or());
      while (take(","));
      need(")");
    }
    return call(token.text, args);
  };

  const value = or();
  if (at !== tokens.length) throw new Error(`Unread input in "${source}"`);
  return value;
}

function display(value: Value): string {
  if (value === null) return "";
  if (typeof value === "object") throw new Error("The model does not print arrays or objects");
  return String(value);
}

/** Replaces each `${{ }}` in a string, as in a job's name or a concurrency group. */
export function interpolate(text: string, context: Context): string {
  return text.replace(/\$\{\{(.*?)\}\}/g, (_, expression: string) =>
    display(evaluate(expression, context)),
  );
}

// An if may be written with or without its ${{ }}.
const condition = (text: string, context: Context): boolean =>
  truthy(evaluate(/^\s*\$\{\{(.*)\}\}\s*$/s.exec(text)?.[1] ?? text, context));

const Job = z.object({
  name: z.string(),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  if: z.string().optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  steps: z.array(z.object({ id: z.string().optional(), run: z.string().optional() })),
});
// Strict: a trigger the model does not know, a push for one, fails the parse.
const Workflow = z.object({
  name: z.string(),
  on: z.strictObject({ pull_request: z.strictObject({ types: z.array(z.string()) }) }),
  concurrency: z.object({ group: z.string() }).optional(),
  jobs: z.record(z.string(), Job),
});
type Workflow = z.infer<typeof Workflow>;
type Job = z.infer<typeof Job>;

export const WORKFLOW_FILES = readdirSync(".github/workflows").map((name) =>
  join(".github/workflows", name),
);

// Read once: the tests play hundreds of events through the same files.
let parsed: Workflow[] | undefined;
const workflows = (): Workflow[] =>
  (parsed ??= WORKFLOW_FILES.map((path) => Workflow.parse(parse(readFileSync(path, "utf8")))));

export type PullRequest = {
  draft: boolean;
  base: string;
  labels: readonly string[];
  /** What `git diff HEAD^1 HEAD` lists on the test merge commit. */
  changed: readonly string[];
};
export type PullRequestEvent = {
  action: string;
  label?: string;
  /** An edited event's base before it, when the edit retargeted the pull request. */
  previousBase?: string;
  /** The pull request as the event recorded it, which a re-run replays. */
  pullRequest: PullRequest;
  /** Its base and labels when a job asks the API for them; as recorded unless given. */
  now?: Pick<PullRequest, "base" | "labels">;
  /** 1 for the run the event starts, and 2 on for each re-run of all its jobs. */
  attempt?: number;
};
/**
 * `stage` is when GitHub creates the check: 0 as the run begins, and a job
 * that needs others only once they have finished, one stage after the last.
 */
export type Check = {
  job: string;
  name: string;
  result: "success" | "failure" | "skipped";
  stage: number;
};
export type Run = { workflow: string; concurrency: string | null; checks: Check[] };

/*
 * The only steps the model runs: the docs filter, fed the changed paths, and
 * the E2E rule, fed the base and labels as the API lists them, one per line.
 * Each is run once per input.
 */
const SCRIPTS: Record<string, (event: PullRequestEvent) => readonly string[]> = {
  "scripts/ci-changes.sh": ({ pullRequest }) => pullRequest.changed,
  "scripts/ci-e2e.sh": ({ pullRequest, now = pullRequest }) => [now.base, ...now.labels],
};
const printed = new Map<string, string>();
function stepOutputs(job: Job, event: PullRequestEvent): Context {
  const steps: Record<string, Value> = {};
  for (const step of job.steps) {
    if (step.id === undefined) continue;
    const outputs: Record<string, string> = {};
    for (const [script, input] of Object.entries(SCRIPTS)) {
      if (!step.run?.includes(script)) continue;
      const lines = input(event).join("\n");
      const key = `${script}\0${lines}`;
      const out =
        printed.get(key) ?? execFileSync("bash", [script], { input: lines, encoding: "utf8" });
      printed.set(key, out);
      for (const line of out.trim().split("\n")) {
        const [name = "", ...rest] = line.split("=");
        outputs[name] = rest.join("=");
      }
    }
    steps[step.id] = { outputs };
  }
  return { steps };
}

function simulate(workflow: Workflow, event: PullRequestEvent, failing: readonly string[]): Run {
  const { draft, base, labels } = event.pullRequest;
  const github: Value = {
    event_name: "pull_request",
    ref: "refs/pull/1/merge",
    run_attempt: String(event.attempt ?? 1),
    base_ref: base,
    event: {
      action: event.action,
      label: event.label === undefined ? null : { name: event.label },
      changes:
        event.previousBase === undefined ? {} : { base: { ref: { from: event.previousBase } } },
      pull_request: { draft, base: { ref: base }, labels: labels.map((name) => ({ name })) },
    },
  };
  // What the needs context holds of a finished job, and apart, the stage of its check.
  const done = new Map<string, { result: Check["result"]; outputs: Record<string, string> }>();
  const stages = new Map<string, number>();
  const checks: Check[] = [];
  const pending = Object.entries(workflow.jobs);
  while (pending.length > 0) {
    const next = pending.findIndex(([, job]) => needsOf(job).every((id) => done.has(id)));
    const entry = pending[next];
    if (entry === undefined) throw new Error(`${workflow.name}: unknown or circular needs`);
    pending.splice(next, 1);
    const [id, job] = entry;
    const needs: Record<string, Value> = {};
    for (const need of needsOf(job)) needs[need] = done.get(need) ?? null;
    const context: Context = { github, needs };
    // An if with no status function holds success(): a job whose needs did not all succeed skips.
    const runs =
      needsOf(job).every((need) => done.get(need)?.result === "success") &&
      (job.if === undefined || condition(job.if, context));
    const result = !runs ? "skipped" : failing.includes(id) ? "failure" : "success";
    // A failed job's outputs are what its steps set before the failure: all of them, at worst.
    const outputs: Record<string, string> = {};
    if (runs) {
      const steps = stepOutputs(job, event);
      for (const [key, text] of Object.entries(job.outputs ?? {})) {
        outputs[key] = interpolate(text, { ...steps, github });
      }
    }
    const stage = Math.max(-1, ...needsOf(job).map((need) => stages.get(need) ?? 0)) + 1;
    done.set(id, { result, outputs });
    stages.set(id, stage);
    checks.push({ job: id, name: interpolate(job.name, context), result, stage });
  }
  return {
    workflow: workflow.name,
    concurrency:
      workflow.concurrency === undefined
        ? null
        : interpolate(workflow.concurrency.group, { github }),
    checks,
  };
}

const needsOf = (job: Job): string[] =>
  job.needs === undefined ? [] : typeof job.needs === "string" ? [job.needs] : job.needs;

/**
 * Every run the event starts, with each job's check. Jobs named in `failing`
 * fail when they run; every other job that runs succeeds.
 */
export function runsFor(event: PullRequestEvent, failing: readonly string[] = []): Run[] {
  return workflows()
    .filter((workflow) => workflow.on.pull_request.types.includes(event.action))
    .map((workflow) => simulate(workflow, event, failing));
}
