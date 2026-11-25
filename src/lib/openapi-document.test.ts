import { describe, expect, it } from "vitest";
import {
  approvalEnum,
  followUpStatusEnum,
  interestLevelEnum,
  religionEnum,
  roleEnum,
  sessionKindEnum,
  sessionStatusEnum,
} from "@/db/schema";
import { listOperations, loadOpenApiDocument, schemaEnum } from "@/lib/openapi-document";

const doc = loadOpenApiDocument();
const operations = listOperations(doc);

/* Secured by the scheduler's secret alone (#279), not by an account's session. */
const isCronOperation = (operation: Record<string, unknown>) =>
  JSON.stringify(operation["security"]) === JSON.stringify([{ cronSecret: [] }]);

describe("document", () => {
  it("declares OpenAPI 3.1", () => {
    expect(doc.openapi.startsWith("3.1")).toBe(true);
  });

  it("defines the session cookie security scheme it relies on", () => {
    expect(doc.components.securitySchemes).toHaveProperty("sessionCookie");
  });
});

describe("enums mirror the database", () => {
  /*
   * The acceptance criterion for #10, and the thing most likely to drift: the
   * contract and the schema must agree on every enum, or a value valid in one
   * layer is rejected by the other.
   */
  it.each([
    ["Role", roleEnum],
    ["Religion", religionEnum],
    ["InterestLevel", interestLevelEnum],
    ["SessionStatus", sessionStatusEnum],
    ["SessionKind", sessionKindEnum],
    ["FollowUpStatus", followUpStatusEnum],
    ["Approval", approvalEnum],
  ])("%s matches the Drizzle pgEnum exactly", (name, pgEnum) => {
    expect(schemaEnum(doc, name)).toEqual([...pgEnum.enumValues]);
  });
});

describe("schemaEnum", () => {
  it("returns the values for an enum schema", () => {
    expect(schemaEnum(doc, "Role")).toEqual(["admin", "member"]);
  });

  it("returns empty for a schema that is not an enum", () => {
    // Callers compare against a known list, so an empty result reads as
    // "no such enum" rather than throwing mid-assertion.
    expect(schemaEnum(doc, "Block")).toEqual([]);
  });

  it("returns empty for a schema that does not exist", () => {
    expect(schemaEnum(doc, "NoSuchSchema")).toEqual([]);
  });
});

describe("the scheduler's secret", () => {
  it("secures the retention job alone", () => {
    const secured = operations.filter(({ operation }) => isCronOperation(operation));
    expect(secured.map(({ operation }) => operation["operationId"])).toEqual(["runRetention"]);
    expect(doc.components.securitySchemes).toHaveProperty("cronSecret");
  });
});

describe("every operation", () => {
  it("has a unique operationId", () => {
    const ids = operations.map((o) => o.operation["operationId"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("has a summary", () => {
    for (const { path, method, operation } of operations) {
      expect(operation["summary"], `${method.toUpperCase()} ${path}`).toBeTruthy();
    }
  });

  it("documents a success response", () => {
    for (const { path, method, operation } of operations) {
      const responses = operation["responses"] as Record<string, unknown>;
      const success = Object.keys(responses).filter((c) => c.startsWith("2"));
      expect(success.length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
    }
  });

  it("documents a 401, since every operation requires a session", () => {
    for (const { path, method, operation } of operations) {
      const responses = operation["responses"] as Record<string, unknown>;
      expect(Object.keys(responses), `${method.toUpperCase()} ${path}`).toContain("401");
    }
  });

  it("documents a 403, since every operation refuses a deactivated or unapproved account", () => {
    for (const { path, method, operation } of operations) {
      // The scheduler's route has no account to refuse: its secret is all it takes.
      if (isCronOperation(operation)) continue;
      const responses = operation["responses"] as Record<string, unknown>;
      expect(Object.keys(responses), `${method.toUpperCase()} ${path}`).toContain("403");
    }
  });

  it("documents at least one other error response", () => {
    for (const { path, method, operation } of operations) {
      const responses = operation["responses"] as Record<string, unknown>;
      const errors = Object.keys(responses).filter(
        (c) => c !== "401" && (c.startsWith("4") || c.startsWith("5")),
      );
      expect(errors.length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
    }
  });

  it("belongs to a declared tag", () => {
    for (const { path, method, operation } of operations) {
      const tags = operation["tags"] as string[] | undefined;
      expect(tags?.length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
    }
  });
});
