import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zError } from "@/generated/zod.gen";
import {
  ResponseContractError,
  coerceQuery,
  requireChanges,
  searchParamsToObject,
  toErrorResponse,
  withContract,
} from "@/server/http/contract";
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "@/server/http/errors";

const zWidget = z.object({ id: z.string(), size: z.number() });
const widget = { id: "w1", size: 3 };

const post = (body: unknown, url = "https://test.local/api/widgets") =>
  new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const get = (url: string) => new Request(url);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("request validation", () => {
  const route = withContract(
    {
      operationId: "createWidget",
      body: z.object({ name: z.string().min(1), size: z.number().int() }),
      responses: { 201: zWidget },
    },
    ({ body }) => Promise.resolve({ status: 201, body: { id: body.name, size: body.size } }),
  );

  it("passes a valid body to the handler", async () => {
    const response = await route(post({ name: "w1", size: 3 }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(widget);
  });

  it("rejects a missing required field with 400 and a useful message", async () => {
    const response = await route(post({ size: 3 }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error: { code: string; details: { path: string }[] };
    };
    expect(payload.error.code).toBe("validation_failed");
    expect(payload.error.details.map((d) => d.path)).toContain("/name");
  });

  it("names every offending field, not just the first", async () => {
    const response = await route(post({ name: "", size: 1.5 }));
    const payload = (await response.json()) as { error: { details: { path: string }[] } };
    expect(payload.error.details.map((d) => d.path).sort()).toEqual(["/name", "/size"]);
  });

  it("rejects a body that is not valid JSON", async () => {
    const response = await route(
      new Request("https://test.local/api/widgets", {
        method: "POST",
        body: "{oops",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toMatch(/not valid JSON/);
  });

  it("treats an empty body as absent rather than as invalid JSON", async () => {
    const response = await route(new Request("https://test.local/api/widgets", { method: "POST" }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toMatch(/request body/i);
  });
});

describe("requests from another origin, and bodies that are not JSON (#121)", () => {
  const handler = vi.fn(() => Promise.resolve({ status: 201, body: widget }));
  const route = withContract(
    {
      operationId: "createWidget",
      path: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string().min(1), size: z.number().int() }),
      responses: { 201: zWidget },
    },
    handler,
  );
  const ID = "00000000-0000-4000-8000-000000000001";
  const params = (id = ID) => ({ params: Promise.resolve({ id }) });
  const send = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("https://test.local/api/widgets", { method: "POST", body, headers });
  const valid = JSON.stringify({ name: "w1", size: 3 });
  const errorOf = async (response: Response) => zError.parse(await response.json()).error;

  beforeEach(() => {
    handler.mockClear();
  });

  it("refuses a cross-site write with 403 before reading its path or body", async () => {
    // A 400 here would mean the request was parsed first, and say what was wrong with it.
    const response = await route(send("{oops", { "sec-fetch-site": "cross-site" }), params("x"));
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("forbidden");
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a write whose Origin is another host when there is no Sec-Fetch-Site", async () => {
    const response = await route(
      send(valid, {
        "content-type": "application/json",
        origin: "https://other.example.org",
        host: "app.example.org",
      }),
      params(),
    );
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still answers a cross-site read", async () => {
    const read = withContract({ operationId: "getWidget", responses: { 200: zWidget } }, () =>
      Promise.resolve({ status: 200, body: widget }),
    );
    const response = await read(
      new Request("https://test.local/api/widgets/1", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("refuses a text/plain body with 415 in the error envelope", async () => {
    // CORS-simple: a page on another origin can send it without a preflight.
    const response = await route(
      send(valid, { "content-type": "text/plain", "sec-fetch-site": "same-origin" }),
      params(),
    );
    expect(response.status).toBe(415);
    expect(await errorOf(response)).toEqual({
      code: "unsupported_media_type",
      message: "Send the request body as JSON.",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a body with no Content-Type at all", async () => {
    // A string body is labelled text/plain; a Blob with no type sends no header.
    const request = send(new Blob([valid]));
    expect(request.headers.get("content-type")).toBeNull();
    const response = await route(request, params());
    expect(response.status).toBe(415);
    expect(handler).not.toHaveBeenCalled();
  });

  it("reports an empty text/plain body as missing, not as the wrong type", async () => {
    const response = await route(send("", { "content-type": "text/plain" }), params());
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("validation_failed");
  });

  it("accepts JSON that names its charset, from the app's own origin", async () => {
    const response = await route(
      send(valid, {
        "content-type": "application/json; charset=utf-8",
        "sec-fetch-site": "same-origin",
        origin: "https://app.example.org",
      }),
      params(),
    );
    expect(response.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("query and path validation", () => {
  it("parses query parameters", async () => {
    const route = withContract(
      {
        operationId: "listWidgets",
        query: z.object({ limit: z.coerce.number().int().max(100) }),
        responses: { 200: z.object({ limit: z.number() }) },
      },
      ({ query }) => Promise.resolve({ status: 200, body: { limit: query.limit } }),
    );
    const response = await route(get("https://test.local/api/widgets?limit=25"));
    expect(await response.json()).toEqual({ limit: 25 });
  });

  it("rejects an out-of-range query parameter", async () => {
    const route = withContract(
      {
        operationId: "listWidgets",
        query: z.object({ limit: z.coerce.number().int().max(100) }),
        responses: { 200: z.object({ limit: z.number() }) },
      },
      ({ query }) => Promise.resolve({ status: 200, body: { limit: query.limit } }),
    );
    const response = await route(get("https://test.local/api/widgets?limit=5000"));
    expect(response.status).toBe(400);
  });

  it("parses path parameters", async () => {
    const route = withContract(
      {
        operationId: "getWidget",
        path: z.object({ id: z.uuid() }),
        responses: { 200: z.object({ id: z.string() }) },
      },
      ({ path }) => Promise.resolve({ status: 200, body: { id: path.id } }),
    );
    const id = "00000000-0000-4000-8000-000000000001";
    const response = await route(get("https://test.local/api/widgets/x"), {
      params: Promise.resolve({ id }),
    });
    expect(await response.json()).toEqual({ id });
  });

  it("rejects a malformed path parameter with 400, not 500", async () => {
    const route = withContract(
      {
        operationId: "getWidget",
        path: z.object({ id: z.uuid() }),
        responses: { 200: z.object({ id: z.string() }) },
      },
      ({ path }) => Promise.resolve({ status: 200, body: { id: path.id } }),
    );
    const response = await route(get("https://test.local/api/widgets/nope"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("searchParamsToObject", () => {
  it("reads a single value as a scalar", () => {
    expect(searchParamsToObject(new URLSearchParams("a=1"))).toEqual({ a: "1" });
  });

  it("collects repeated keys into an array", () => {
    // ?id=a&id=b must reach the schema as a list, not silently lose one.
    expect(searchParamsToObject(new URLSearchParams("id=a&id=b"))).toEqual({ id: ["a", "b"] });
  });

  it("returns an empty object for no parameters", () => {
    expect(searchParamsToObject(new URLSearchParams(""))).toEqual({});
  });
});

describe("response validation", () => {
  /*
   * The half that makes the contract real. A handler returning something the
   * spec does not describe must fail, not ship.
   */
  const routeReturning = (body: unknown, status = 200) =>
    withContract({ operationId: "getWidget", responses: { 200: zWidget } }, () =>
      Promise.resolve({ status, body }),
    );

  it("returns a conforming response", async () => {
    const response = await routeReturning(widget)(get("https://test.local/api/widgets/1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(widget);
  });

  it("throws when the handler omits a documented field", async () => {
    await expect(
      routeReturning({ id: "w1" })(get("https://test.local/api/widgets/1")),
    ).rejects.toThrow(ResponseContractError);
  });

  it("throws when the handler returns a field the spec does not describe", async () => {
    // The acceptance criterion: undocumented output fails its test.
    await expect(
      routeReturning({ ...widget, secret: "leaked" })(get("https://test.local/api/widgets/1")),
    ).rejects.toThrow(ResponseContractError);
  });

  it("throws when the handler returns an undocumented status", async () => {
    await expect(
      routeReturning(widget, 418)(get("https://test.local/api/widgets/1")),
    ).rejects.toThrow(/not documented/);
  });

  it("names the operation and status in the message", async () => {
    await expect(
      routeReturning({ id: "w1" })(get("https://test.local/api/widgets/1")),
    ).rejects.toThrow(/getWidget returned a 200/);
  });

  it("supports a documented 204 with no body", async () => {
    const route = withContract(
      { operationId: "deleteWidget", responses: { 204: z.undefined() } },
      () => Promise.resolve({ status: 204 }),
    );
    const response = await route(get("https://test.local/api/widgets/1"));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  describe("in production", () => {
    it("returns 500 rather than leaking a malformed payload", async () => {
      // Drift must not reach a user, but nor should the process crash.
      vi.stubEnv("NODE_ENV", "production");
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const response = await routeReturning({ id: "w1" })(get("https://test.local/api/widgets/1"));
      expect(response.status).toBe(500);
      const payload = (await response.json()) as { error: { code: string } };
      expect(payload.error.code).toBe("internal_error");
      expect(error).toHaveBeenCalled();
    });

    it("returns 500 for an undocumented status too", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const response = await routeReturning(widget, 418)(get("https://test.local/api/widgets/1"));
      expect(response.status).toBe(500);
    });
  });
});

describe("errors thrown by handlers", () => {
  const routeThrowing = (error: Error) =>
    withContract({ operationId: "getWidget", responses: { 200: zWidget } }, () => {
      throw error;
    });

  it.each([
    [new UnauthenticatedError(), 401, "unauthenticated"],
    [new ForbiddenError(), 403, "forbidden"],
    [new NotFoundError(), 404, "not_found"],
    [new ConflictError(), 409, "conflict"],
    [
      new ConflictError("session_already_active", "Another session is active."),
      409,
      "session_already_active",
    ],
  ])("maps %s to its documented status", async (error, status, code) => {
    const response = await routeThrowing(error)(get("https://test.local/api/widgets/1"));
    expect(response.status).toBe(status);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe(code);
  });

  it("turns an unexpected error into 500 without echoing it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await routeThrowing(new Error("connection string user:hunter2"))(
      get("https://test.local/api/widgets/1"),
    );
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).not.toMatch(/hunter2/);
    expect(spy).toHaveBeenCalled();
  });
});

describe("logging an unexpected error", () => {
  const USER = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
  const outage = () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 10.0.0.12:5432"), {
      code: "ECONNREFUSED",
      address: "10.0.0.12",
      port: 5432,
    });
    const error = new Error(`Failed query: select * from users where id = $1\nparams: ${USER}`, {
      cause,
    });
    return Object.assign(error, { params: [USER] });
  };
  const throwing = (operationId: string) =>
    withContract({ operationId, responses: { 200: zWidget } }, () => Promise.reject(outage()));

  it("logs one sanitised line: no host, port, parameters or cause", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await throwing("redactWidget")(get("https://test.local/api/widgets/1"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(new InternalError().toBody());
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("redactWidget");
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toMatch(/10\.0\.0\.12|5432/);
    expect(logged).not.toContain(USER);
    spy.mockRestore();
  });

  it("logs a burst of failures once per operation", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = throwing("burstWidget");
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => route(get("https://test.local/api/widgets/1"))),
    );

    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 500));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("toErrorResponse", () => {
  it("rethrows a contract error so it surfaces rather than becoming a 500", () => {
    const drift = new ResponseContractError("getWidget", 200, "detail");
    expect(() => toErrorResponse(drift, "getWidget")).toThrow(ResponseContractError);
  });

  it("includes details only when there are any", async () => {
    const response = toErrorResponse(new NotFoundError(), "getWidget");
    const payload = (await response.json()) as { error: Record<string, unknown> };
    expect(payload.error).not.toHaveProperty("details");
  });
});

describe("coerceQuery", () => {
  /*
   * Query parameters are strings on the wire while the contract describes
   * their semantic types. Every numeric parameter in the API would otherwise
   * be rejected with 400 - "50" is not a number as far as z.int() is
   * concerned.
   */
  const schema = z.object({
    limit: z.int().optional().default(50),
    active: z.boolean().optional(),
    search: z.string().optional(),
    status: z.enum(["draft", "active"]).optional(),
  });

  it("coerces a numeric parameter", () => {
    expect(coerceQuery(schema, { limit: "25" })).toEqual({ limit: 25 });
  });

  it("coerces booleans", () => {
    expect(coerceQuery(schema, { active: "true" })).toEqual({ active: true });
    expect(coerceQuery(schema, { active: "false" })).toEqual({ active: false });
  });

  it("leaves a string parameter alone even when it looks numeric", () => {
    // Block "123" is a name, not a number. Coercing by value rather than by
    // schema would corrupt it.
    expect(coerceQuery(schema, { search: "123" })).toEqual({ search: "123" });
  });

  it("leaves enums alone", () => {
    expect(coerceQuery(schema, { status: "draft" })).toEqual({ status: "draft" });
  });

  it("leaves a non-numeric value for a numeric field, so the schema reports it", () => {
    // Coercing to NaN would produce a baffling message.
    expect(coerceQuery(schema, { limit: "abc" })).toEqual({ limit: "abc" });
  });

  it("leaves an empty string alone", () => {
    expect(coerceQuery(schema, { limit: "" })).toEqual({ limit: "" });
  });

  it("ignores keys the schema does not declare", () => {
    expect(coerceQuery(schema, { unknown: "5" })).toEqual({ unknown: "5" });
  });

  it("leaves a non-string value untouched", () => {
    expect(coerceQuery(schema, { limit: 25 })).toEqual({ limit: 25 });
  });

  it("returns the input unchanged for a schema with no shape", () => {
    expect(coerceQuery(z.string(), { limit: "25" })).toEqual({ limit: "25" });
  });

  it("only coerces booleans for exact true/false", () => {
    expect(coerceQuery(schema, { active: "yes" })).toEqual({ active: "yes" });
  });
});

describe("requireChanges", () => {
  /*
   * The generated Zod drops the contract's minProperties, so an empty PATCH
   * body would otherwise reach the database and fail as a 500.
   */
  it("passes a body with changes through", () => {
    expect(requireChanges({ name: "123" })).toEqual({ name: "123" });
  });

  it("rejects an empty body with a 400, not a database error", () => {
    expect(() => requireChanges({})).toThrow(ValidationError);
  });

  it("says what to do about it", () => {
    expect(() => requireChanges({})).toThrow(/at least one field/);
  });

  it("accepts a body whose only field is explicitly null", () => {
    // Clearing a postal code is a real change.
    expect(requireChanges({ postalCode: null })).toEqual({ postalCode: null });
  });
});
