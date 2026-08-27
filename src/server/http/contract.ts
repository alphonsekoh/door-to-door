import type { ZodError, ZodType } from "zod";
import { ApiError, InternalError, ValidationError, type FieldIssue } from "@/server/http/errors";

/*
 * Wraps a route handler so the contract is enforced at runtime, in both
 * directions.
 *
 * Validating the request is the ordinary half. Validating the *response* is
 * the half that matters: without it, a handler quietly returning a field the
 * spec does not describe ships, and the generated client types become a
 * comfortable fiction. Here that fails loudly in dev and test, and is reported
 * rather than leaked in production.
 */

export type ContractSpec<TPath, TQuery, TBody> = {
  operationId: string;
  path?: ZodType<TPath>;
  query?: ZodType<TQuery>;
  body?: ZodType<TBody>;
  /* Keyed by status code. A handler may only return a documented status. */
  responses: Record<number, ZodType>;
};

export type HandlerInput<TPath, TQuery, TBody> = {
  path: TPath;
  query: TQuery;
  body: TBody;
  request: Request;
};

export type HandlerResult = {
  status: number;
  body?: unknown;
};

export type RouteContext = { params?: Promise<Record<string, string | string[]>> };
export type RouteHandler = (request: Request, context?: RouteContext) => Promise<Response>;

/* Response drift is a bug to surface, not to tolerate - except in production,
 * where a 500 beats leaking a malformed payload. */
function shouldThrowOnResponseDrift(): boolean {
  return process.env.NODE_ENV !== "production";
}

/* Only ever receives a ZodError, so no defensive fallbacks are warranted. */
function issuesFrom(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: `/${issue.path.map(String).join("/")}`,
    message: issue.message,
  }));
}

/*
 * Query parameters are always strings on the wire, but the contract describes
 * their semantic types - `limit` is an integer, not "50". Coercion is driven
 * by the schema rather than guessed from the value, so a parameter the
 * contract declares as a string stays a string even when it looks numeric.
 */
type ZodInternals = {
  def?: { type?: string; shape?: Record<string, unknown>; innerType?: unknown };
};

function unwrap(schema: unknown): ZodInternals {
  let current = schema as ZodInternals;
  while (current.def?.innerType !== undefined) {
    current = current.def.innerType as ZodInternals;
  }
  return current;
}

export function coerceQuery(
  schema: ZodType,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const shape = (schema as ZodInternals).def?.shape;
  if (!shape) {
    return raw;
  }

  const coerced: Record<string, unknown> = { ...raw };
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || !(key in shape)) {
      continue;
    }
    const expected = unwrap(shape[key]).def?.type;

    if (expected === "number" || expected === "int") {
      const asNumber = Number(value);
      // Leave it alone when it is not a number, so the schema reports the
      // real problem rather than a confusing NaN.
      coerced[key] = value.trim() === "" || Number.isNaN(asNumber) ? value : asNumber;
    } else if (expected === "boolean" && (value === "true" || value === "false")) {
      coerced[key] = value === "true";
    }
  }
  return coerced;
}

/* Repeated keys become arrays so `?id=a&id=b` reaches the schema intact. */
export function searchParamsToObject(params: URLSearchParams): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length > 1 ? values : values[0];
  }
  return result;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Request body is not valid JSON.");
  }
}

function parseOrThrow<T>(schema: ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid ${what}.`, issuesFrom(result.error));
  }
  return result.data;
}

/*
 * Stable JSON with sorted keys, for comparing what a handler returned against
 * what the contract admits.
 */
function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== "object" || Array.isArray(inner)) return inner;
    const record = inner as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, record[k]]),
    );
  });
}

function jsonResponse(status: number, body: unknown): Response {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export class ResponseContractError extends Error {
  constructor(operationId: string, status: number, detail: string) {
    super(
      `${operationId} returned a ${String(status)} that does not match the contract: ${detail}`,
    );
    this.name = "ResponseContractError";
  }
}

export function withContract<TPath = undefined, TQuery = undefined, TBody = undefined>(
  spec: ContractSpec<TPath, TQuery, TBody>,
  handler: (input: HandlerInput<TPath, TQuery, TBody>) => Promise<HandlerResult>,
): RouteHandler {
  return async function route(request: Request, context?: RouteContext): Promise<Response> {
    try {
      const rawPath = (await context?.params) ?? {};
      const url = new URL(request.url);

      const input: HandlerInput<TPath, TQuery, TBody> = {
        path: spec.path
          ? parseOrThrow(spec.path, rawPath, "path parameters")
          : (undefined as TPath),
        query: spec.query
          ? parseOrThrow(
              spec.query,
              coerceQuery(spec.query, searchParamsToObject(url.searchParams)),
              "query parameters",
            )
          : (undefined as TQuery),
        body: spec.body
          ? parseOrThrow(spec.body, await readJsonBody(request), "request body")
          : (undefined as TBody),
        request,
      };

      const result = await handler(input);
      return validateResponse(spec, result);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/* Never returns: throws either the drift error or an InternalError. */
function reportDrift(operationId: string, status: number, detail: string): never {
  const drift = new ResponseContractError(operationId, status, detail);
  if (shouldThrowOnResponseDrift()) throw drift;
  console.error(drift.message);
  throw new InternalError();
}

function validateResponse<TPath, TQuery, TBody>(
  spec: ContractSpec<TPath, TQuery, TBody>,
  result: HandlerResult,
): Response {
  const schema = spec.responses[result.status];

  if (!schema) {
    return reportDrift(spec.operationId, result.status, "that status is not documented");
  }

  const parsed = schema.safeParse(result.body);
  if (!parsed.success) {
    return reportDrift(
      spec.operationId,
      result.status,
      issuesFrom(parsed.error)
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; "),
    );
  }

  /*
   * Zod strips unknown keys rather than rejecting them, so a handler returning
   * an undocumented field would otherwise pass validation. Comparing the
   * parsed value against what was returned is what catches it.
   */
  if (canonicalize(parsed.data) !== canonicalize(result.body)) {
    return reportDrift(
      spec.operationId,
      result.status,
      "it returned fields the contract does not describe",
    );
  }

  // The parsed value, never the raw one - so drift cannot leak even if
  // reporting is downgraded in production.
  return jsonResponse(result.status, parsed.data);
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(error.status, error.toBody());
  }
  if (error instanceof ResponseContractError) {
    throw error;
  }
  // Nothing is echoed back from an unexpected error - it may carry internals.
  console.error(error);
  return jsonResponse(500, new InternalError().toBody());
}
