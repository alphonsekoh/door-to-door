import { readFileSync } from "node:fs";
import { parse } from "yaml";

/*
 * Loads openapi.yaml so tests can assert against the contract itself. Kept
 * loosely typed on purpose: the point is to check the document's shape, and
 * typing it against a generated model would assume the very thing under test.
 */

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    responses?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

export const OPENAPI_PATH = "openapi.yaml";

export function loadOpenApiDocument(path = OPENAPI_PATH): OpenApiDocument {
  return parse(readFileSync(path, "utf8")) as OpenApiDocument;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export type Operation = {
  path: string;
  method: (typeof HTTP_METHODS)[number];
  operation: Record<string, unknown>;
};

/* Flattens paths into one operation list, so tests can assert across all of them. */
export function listOperations(doc: OpenApiDocument): Operation[] {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    HTTP_METHODS.filter((method) => method in item).map((method) => ({
      path,
      method,
      operation: item[method] as Record<string, unknown>,
    })),
  );
}

export function schemaEnum(doc: OpenApiDocument, name: string): string[] {
  const schema = doc.components.schemas[name] as { enum?: string[] } | undefined;
  return schema?.enum ?? [];
}
