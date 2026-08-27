"use client";

import type { ErrorBody } from "@/server/http/errors";

/*
 * A thin typed fetch wrapper over the generated types.
 *
 * Deliberately hand-written rather than generated: #11 records why the SDK
 * plugin is off. This exists so callers get the contract's types and its error
 * envelope without every component re-deriving how to read a failure.
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: ErrorBody | undefined) {
    super(body?.error.message ?? "Something went wrong.");
    this.name = "ApiRequestError";
    this.status = status;
    this.code = body?.error.code ?? "internal_error";
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
    throw new ApiRequestError(response.status, body as ErrorBody | undefined);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
