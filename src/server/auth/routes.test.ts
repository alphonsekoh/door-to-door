import { describe, expect, it } from "vitest";
import {
  WAITING_PATH,
  isApiPath,
  isPublicPath,
  isPwaPath,
  isWaitingPath,
  signInRedirect,
} from "@/server/auth/routes";

describe("isPublicPath", () => {
  it.each([
    "/sign-in",
    "/api/auth",
    "/api/auth/session",
    "/api/auth/callback/credentials",
    "/privacy",
    "/offline",
    "/manifest.webmanifest",
    "/serwist/sw.js",
    "/serwist/sw.js.map",
  ])("lets %s through", (path) => {
    // Guarding these would make signing in impossible.
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/", "/history", "/api/sessions", "/api/sessions/active", "/api/blocks", "/account"])(
    "guards %s",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );

  it("does not treat a lookalike prefix as public", () => {
    // /sign-in-secretly must not inherit /sign-in's exemption.
    expect(isPublicPath("/sign-in-secretly")).toBe(false);
    expect(isPublicPath("/api/authorise")).toBe(false);
    expect(isPublicPath("/offline-secrets")).toBe(false);
    expect(isPublicPath("/privacy-x")).toBe(false);
    expect(isPublicPath("/serwistx")).toBe(false);
  });
});

/* #249: only someone signed in has a request to wait on. */
describe("the waiting page", () => {
  it("is guarded, not public", () => {
    expect(WAITING_PATH).toBe("/waiting");
    expect(isPublicPath(WAITING_PATH)).toBe(false);
  });

  it("is that one path, not a lookalike", () => {
    expect(isWaitingPath("/waiting")).toBe(true);
    expect(isWaitingPath("/waiting-room")).toBe(false);
    expect(isWaitingPath("/")).toBe(false);
  });
});

describe("isPwaPath", () => {
  it.each(["/offline", "/manifest.webmanifest", "/serwist/sw.js", "/serwist/sw.js.map"])(
    "recognises %s, which the browser may fetch without cookies",
    (path) => {
      expect(isPwaPath(path)).toBe(true);
    },
  );

  it.each(["/sign-in", "/privacy", "/api/auth/csrf", "/history", "/serwistx", "/offline-secrets"])(
    "does not match %s",
    (path) => {
      expect(isPwaPath(path)).toBe(false);
    },
  );
});

describe("isApiPath", () => {
  it.each(["/api", "/api/sessions", "/api/visits/sync"])("recognises %s", (path) => {
    expect(isApiPath(path)).toBe(true);
  });

  it.each(["/", "/history", "/apixyz"])("does not match %s", (path) => {
    expect(isApiPath(path)).toBe(false);
  });
});

describe("signInRedirect", () => {
  it("preserves where the visitor was going", () => {
    expect(signInRedirect("/history", "")).toBe("/sign-in?callbackUrl=%2Fhistory");
  });

  it("keeps the query string", () => {
    expect(signInRedirect("/history", "?block=123")).toBe(
      "/sign-in?callbackUrl=%2Fhistory%3Fblock%3D123",
    );
  });

  it("omits a pointless callback for the home screen", () => {
    expect(signInRedirect("/", "")).toBe("/sign-in");
  });

  it("handles an empty path", () => {
    expect(signInRedirect("", "")).toBe("/sign-in");
  });

  /* A search term is a name or a phone number, and no screen keeps it in
     its URL (D-129-7); an old link's must not reach the sign-in page (#163). */
  it("drops a search term and keeps the filters", () => {
    expect(signInRedirect("/admin/history", "?religion=hindu&q=Tan&from=2026-03-01")).toBe(
      "/sign-in?callbackUrl=%2Fadmin%2Fhistory%3Freligion%3Dhindu%26from%3D2026-03-01",
    );
  });

  it("drops a search term that was the whole query", () => {
    expect(signInRedirect("/admin/records", "?q=9123%204567")).toBe(
      "/sign-in?callbackUrl=%2Fadmin%2Frecords",
    );
  });

  it("drops every copy of the search term", () => {
    expect(signInRedirect("/admin/history", "?q=Tan&q=Lim")).toBe(
      "/sign-in?callbackUrl=%2Fadmin%2Fhistory",
    );
  });

  it("leaves a query without a search term exactly as it came", () => {
    // Re-encoding it could change what the page reads back.
    expect(signInRedirect("/history", "?scope=team&x=a%20b")).toBe(
      "/sign-in?callbackUrl=%2Fhistory%3Fscope%3Dteam%26x%3Da%2520b",
    );
  });

  it("sends a search on the home screen to a bare sign-in", () => {
    expect(signInRedirect("/", "?q=Tan")).toBe("/sign-in");
  });
});
