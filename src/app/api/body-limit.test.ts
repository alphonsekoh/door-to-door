import { beforeEach, describe, expect, it, vi } from "vitest";
import { zError } from "@/generated/zod.gen";
import { listOperations, loadOpenApiDocument } from "@/lib/openapi-document";
import { DEFAULT_BODY_LIMIT_BYTES, SYNC_BODY_LIMIT_BYTES } from "@/server/http/body-limit";
import type { RouteHandler } from "@/server/http/contract";
import { routeFileFor } from "@/server/http/route-registry";

/*
 * Every operation that takes a body documents 413 and refuses a body over its
 * cap before it authenticates (#126). Derived from the spec, as the
 * same-origin sweep is (D-121-9), so an operation added later is swept too.
 */
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const modules = import.meta.glob("./**/route.ts");
const operations = listOperations(loadOpenApiDocument()).map(({ path, method, operation }) => ({
  path,
  method: method.toUpperCase(),
  operationId: operation["operationId"] as string,
  takesBody: "requestBody" in operation,
  documents413: "413" in (operation["responses"] as Record<string, unknown>),
}));
const withBody = operations.filter((operation) => operation.takesBody);

async function handlerFor(path: string, method: string): Promise<RouteHandler> {
  const load = modules[`./${routeFileFor(path).replace("src/app/api/", "")}`];
  if (load === undefined) throw new Error(`${path} has no route file`);
  const handler = ((await load()) as Record<string, unknown>)[method];
  if (typeof handler !== "function") throw new Error(`${path} exports no ${method}`);
  return handler as RouteHandler;
}

/* A valid id for every path parameter, so the path's 400 does not come first. */
function paramsFor(path: string) {
  const names = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
  return {
    params: Promise.resolve(
      Object.fromEntries(names.map((name) => [name, "00000000-0000-4000-8000-000000000001"])),
    ),
  };
}

const declaring = (method: string, bytes: number) =>
  new Request("https://app.example.org/api/anything", {
    method,
    body: "{}",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "content-length": String(bytes),
    },
  });

const capOf = (operationId: string) =>
  operationId === "syncVisits" ? SYNC_BODY_LIMIT_BYTES : DEFAULT_BODY_LIMIT_BYTES;

beforeEach(() => {
  auth.mockReset();
  auth.mockResolvedValue(null);
});

describe("every operation with a request body", () => {
  it("finds the operations to sweep, the sync batch and team creation among them", () => {
    expect(withBody.map((operation) => operation.operationId)).toEqual(
      expect.arrayContaining(["syncVisits", "createVisit", "createTeam", "updateOwnProfile"]),
    );
  });

  it("documents 413, and no operation without a body does", () => {
    expect(operations.filter((op) => op.takesBody !== op.documents413)).toEqual([]);
  });

  it.each(withBody.map((op) => [`${op.method} ${op.path}`, op] as const))(
    "%s refuses a body one byte over its cap before it authenticates",
    async (_name, operation) => {
      const handler = await handlerFor(operation.path, operation.method);
      const response = await handler(
        declaring(operation.method, capOf(operation.operationId) + 1),
        paramsFor(operation.path),
      );

      expect(response.status).toBe(413);
      expect(zError.parse(await response.json()).error.code).toBe("content_too_large");
      expect(auth).not.toHaveBeenCalled();
    },
  );

  it.each(withBody.map((op) => [`${op.method} ${op.path}`, op] as const))(
    "%s reads a body at its cap",
    async (_name, operation) => {
      // "{}" behind a Content-Length of exactly the cap: past the size check,
      // then refused for what it says (400) or who sent it (401).
      const handler = await handlerFor(operation.path, operation.method);
      const response = await handler(
        declaring(operation.method, capOf(operation.operationId)),
        paramsFor(operation.path),
      );

      expect([400, 401]).toContain(response.status);
    },
  );
});
