import { existsSync } from "node:fs";
import { listOperations, loadOpenApiDocument } from "@/lib/openapi-document";

/*
 * Maps contract operations to the Next.js route files that must implement them,
 * so the spec and the implementation cannot drift apart in either direction.
 */

export type ContractRoute = {
  operationId: string;
  method: string;
  /* Contract path, e.g. /sessions/{id}/start */
  path: string;
  /* Where the handler must live, e.g. src/app/api/sessions/[id]/start/route.ts */
  file: string;
};

/* /sessions/{id}/blocks -> src/app/api/sessions/[id]/blocks/route.ts */
export function routeFileFor(path: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith("{") && segment.endsWith("}") ? `[${segment.slice(1, -1)}]` : segment,
    );
  return `src/app/api/${segments.join("/")}/route.ts`;
}

export function contractRoutes(): ContractRoute[] {
  const doc = loadOpenApiDocument();
  return listOperations(doc).map(({ path, method, operation }) => ({
    operationId: operation["operationId"] as string,
    method: method.toUpperCase(),
    path,
    file: routeFileFor(path),
  }));
}

export function isImplemented(route: ContractRoute): boolean {
  return existsSync(route.file);
}
