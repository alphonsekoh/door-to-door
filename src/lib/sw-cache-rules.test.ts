import { describe, expect, it } from "vitest";
import {
  isApiRequest,
  isCacheableApiGet,
  isFresh,
  keysToEvict,
  messageType,
} from "@/lib/sw-cache-rules";

const url = (path: string) => new URL(path, "https://app.test");

describe("isCacheableApiGet", () => {
  it("caches the block list, with or without a query", () => {
    expect(isCacheableApiGet(url("/api/blocks"), "GET")).toBe(true);
    expect(isCacheableApiGet(url("/api/blocks?search=12&limit=20"), "GET")).toBe(true);
  });

  it.each([
    "/api/sessions/active",
    "/api/sessions",
    "/api/sessions/abc",
    "/api/sessions/abc/blocks",
    "/api/follow-ups",
    "/api/history",
    "/api/history/mine",
    "/api/households",
    "/api/households/attention",
    "/api/visits",
    "/api/users/me",
    "/api/auth/session",
    "/api/blocks/abc",
  ])("never caches %s - a stale answer there hides live state", (path) => {
    expect(isCacheableApiGet(url(path), "GET")).toBe(false);
  });

  it.each(["POST", "PATCH", "PUT", "DELETE", "HEAD"])("never caches a %s", (method) => {
    expect(isCacheableApiGet(url("/api/blocks"), method)).toBe(false);
    expect(isCacheableApiGet(url("/api/visits/sync"), method)).toBe(false);
  });
});

describe("isApiRequest", () => {
  it("recognises API paths only", () => {
    expect(isApiRequest(url("/api/visits"))).toBe(true);
    expect(isApiRequest(url("/api"))).toBe(true);
    expect(isApiRequest(url("/apixyz"))).toBe(false);
    expect(isApiRequest(url("/history"))).toBe(false);
  });
});

describe("isFresh", () => {
  it("accepts an entry up to its max age and refuses one past it", () => {
    expect(isFresh(1_000, 1_500, 500)).toBe(true);
    expect(isFresh(1_000, 1_501, 500)).toBe(false);
  });
});

describe("keysToEvict", () => {
  it("drops the oldest entries beyond the cap", () => {
    expect(keysToEvict(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });

  it("drops nothing while under the cap", () => {
    expect(keysToEvict(["a"], 2)).toEqual([]);
    expect(keysToEvict([], 0)).toEqual([]);
  });
});

describe("messageType", () => {
  it("reads the type of a well-formed message", () => {
    expect(messageType({ type: "SKIP_WAITING" })).toBe("SKIP_WAITING");
  });

  it.each([null, undefined, "SKIP_WAITING", 4, {}, { type: 3 }])("ignores %j", (data) => {
    expect(messageType(data)).toBeNull();
  });
});
