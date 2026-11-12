"use client";

import { accountStore, classifyAuthFailure } from "@/lib/session/account-state";
import type { FieldIssue } from "@/server/http/errors";

/*
 * A thin typed fetch wrapper over the generated types.
 *
 * Deliberately hand-written rather than generated: #11 records why the SDK
 * plugin is off. This exists so callers get the contract's types and its error
 * envelope without every component re-deriving how to read a failure.
 */

type Failure = { code: string; message: string; details: FieldIssue[] };

const field = (raw: unknown, key: string): unknown =>
  typeof raw === "object" && raw !== null ? Reflect.get(raw, key) : undefined;

/* A malformed issue would break the form that points at its field. */
const isFieldIssue = (issue: unknown): issue is FieldIssue =>
  typeof field(issue, "path") === "string" && typeof field(issue, "message") === "string";

/*
 * Every contract route answers in the envelope, but a proxy, Auth.js, the
 * platform or the service worker may not, and their words are not the app's
 * to show: only the status is kept (#165). Known by its shape, not by a code
 * this build knows, so a newer server's code still reaches the caller.
 */
function readFailure(body: unknown): Failure {
  const error = field(body, "error");
  const code = field(error, "code");
  const message = field(error, "message");
  if (typeof code !== "string" || typeof message !== "string") {
    return { code: "internal_error", message: "Something went wrong.", details: [] };
  }
  const details = field(error, "details");
  return { code, message, details: Array.isArray(details) ? details.filter(isFieldIssue) : [] };
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  /* Which fields a 400 refused, so a form can point at them (D-119-16). */
  readonly details: FieldIssue[];

  /* Any body at all: building the error must never be what fails. */
  constructor(status: number, body: unknown) {
    const failure = readFailure(body);
    super(failure.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = failure.code;
    this.details = failure.details;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  /* Headers rather than a spread: HeadersInit may be an array or a Headers. */
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");

  const response = await fetch(`/api${path}`, { ...init, headers });

  if (!response.ok) {
    /* A proxy or crash can return HTML; failing to parse must not mask the status. */
    const body: unknown = await response.json().catch(() => undefined);
    const error = new ApiRequestError(response.status, body);
    /* Still thrown, so each caller's promise settles as before; the shell
       covers whatever that caller shows with the one account message. */
    const failure = classifyAuthFailure(error.status, error.code);
    if (failure !== null) accountStore.reportAuthFailure(failure);
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
