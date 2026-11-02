import { beforeEach, describe, expect, it, vi } from "vitest";
import { zError } from "@/generated/zod.gen";
import type { RouteHandler } from "@/server/http/contract";
import { contractRoutes } from "@/server/http/route-registry";

/*
 * A test of withContract alone does not prove every route goes through it.
 * Derived from the spec, so an operation added later is swept automatically
 * (#121).
 */
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const modules = import.meta.glob("./**/route.ts");
const writes = contractRoutes().filter((route) => route.method !== "GET");

async function handlerFor(file: string, method: string): Promise<RouteHandler> {
  const load = modules[`./${file.replace("src/app/api/", "")}`];
  if (load === undefined) throw new Error(`${file} was not found`);
  const handler = ((await load()) as Record<string, unknown>)[method];
  if (typeof handler !== "function") throw new Error(`${file} exports no ${method}`);
  return handler as RouteHandler;
}

const request = (method: string, site: string) =>
  new Request("https://app.example.org/api/anything", {
    method,
    body: method === "DELETE" ? null : "{}",
    headers: { "content-type": "application/json", "sec-fetch-site": site },
  });

beforeEach(() => {
  auth.mockReset();
  auth.mockResolvedValue(null);
});

describe("every write in the contract", () => {
  it("finds the writes to sweep, including those the audit named", () => {
    expect(writes.map((route) => route.operationId)).toEqual(
      expect.arrayContaining(["createUser", "startSession", "syncVisits", "addTeamMember"]),
    );
  });

  it.each(writes.map((route) => [`${route.method} ${route.path}`, route] as const))(
    "%s refuses a cross-site request before it authenticates",
    async (_name, route) => {
      const handler = await handlerFor(route.file, route.method);
      const response = await handler(request(route.method, "cross-site"));

      expect(response.status).toBe(403);
      expect(zError.parse(await response.json()).error.code).toBe("forbidden");
      expect(auth).not.toHaveBeenCalled();
    },
  );

  it.each(writes.map((route) => [`${route.method} ${route.path}`, route] as const))(
    "%s lets a same-origin request past the check",
    async (_name, route) => {
      // Signed out with no path parameters: refused for that (400 or 401), not
      // for where it came from.
      const handler = await handlerFor(route.file, route.method);
      const response = await handler(request(route.method, "same-origin"));

      expect([400, 401]).toContain(response.status);
    },
  );
});
