import { describe, expect, it } from "vitest";
import { contractRoutes, isImplemented, routeFileFor } from "@/server/http/route-registry";

/*
 * Phase 3 delivers these handlers. Every operation not yet built is listed
 * here, so the checklist is explicit rather than implied by a passing test.
 *
 * An entry that has actually been implemented fails the suite, which is what
 * keeps the list shrinking instead of rotting.
 */
const PENDING_OPERATIONS = new Set([
  "updateUser", // #31
]);

const routes = contractRoutes();

describe("routeFileFor", () => {
  it("maps a plain path", () => {
    expect(routeFileFor("/blocks")).toBe("src/app/api/blocks/route.ts");
  });

  it("maps a path parameter to a Next.js dynamic segment", () => {
    expect(routeFileFor("/sessions/{id}")).toBe("src/app/api/sessions/[id]/route.ts");
  });

  it("maps several parameters and nested segments", () => {
    expect(routeFileFor("/sessions/{id}/blocks/{blockId}")).toBe(
      "src/app/api/sessions/[id]/blocks/[blockId]/route.ts",
    );
  });
});

describe("contract coverage", () => {
  it("finds every operation in the contract", () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes.map((r) => r.operationId)).size).toBe(routes.length);
  });

  it("has every operation either implemented or explicitly pending", () => {
    const unaccounted = routes.filter(
      (route) => !isImplemented(route) && !PENDING_OPERATIONS.has(route.operationId),
    );
    expect(
      unaccounted.map((r) => `${r.method} ${r.path} -> ${r.file}`),
      "Add a handler, or list the operation in PENDING_OPERATIONS",
    ).toEqual([]);
  });

  it("has no pending entry that is already implemented", () => {
    // Forces the list to shrink as Phase 3 lands, rather than going stale.
    const stale = routes.filter(
      (route) => isImplemented(route) && PENDING_OPERATIONS.has(route.operationId),
    );
    expect(
      stale.map((r) => r.operationId),
      "Implemented - remove these from PENDING_OPERATIONS",
    ).toEqual([]);
  });

  it("lists no operation that the contract does not define", () => {
    const known = new Set(routes.map((r) => r.operationId));
    const unknown = [...PENDING_OPERATIONS].filter((id) => !known.has(id));
    expect(unknown, "Not in openapi.yaml - remove from PENDING_OPERATIONS").toEqual([]);
  });
});
