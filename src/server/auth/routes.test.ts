import { describe, expect, it } from "vitest";
import { isApiPath, isPublicPath, signInRedirect } from "@/server/auth/routes";

describe("isPublicPath", () => {
  it.each([
    "/sign-in",
    "/api/auth",
    "/api/auth/session",
    "/api/auth/callback/credentials",
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
    expect(isPublicPath("/serwistx")).toBe(false);
  });
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
});
