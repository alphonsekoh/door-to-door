import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { NextRequest, type NextFetchEvent } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig, type AppConfig } from "@/lib/config";
import { buildBaseAuthConfig } from "@/server/auth/base-config";

/*
 * A sign-in over an http request URL, as the app sees one behind a TLS proxy
 * that sends no X-Forwarded-Proto, and the proxy reading the cookie it set.
 * Real Auth.js on both sides, built from settings parsed out of YAML, so the
 * default is the one a config.yaml without the key gets. No database: the
 * Credentials provider here accepts anyone.
 */

const SECRET = "k3Jx9Qw2LmZp0Rt7Vb5Nc8Hd1Fg4Ys6A";
const ORIGIN = "http://127.0.0.1:3210";
const MINIMAL =
  "database:\n  url: postgresql://localhost:5432/door_to_door\n" +
  "privacy:\n  organisation: Example Operator\n  dpoEmail: dpo@example.com\n";

const settingsFrom = (yaml: string) => ({
  ...parseConfig(yaml, "config.yaml"),
  authSecret: SECRET,
});

let current: AppConfig & { authSecret: string } = settingsFrom(MINIMAL);
vi.mock("@/server/config", () => ({ getConfig: () => current }));

const { default: proxy } = await import("@/proxy");

const event = {} as NextFetchEvent;

/* name=value from each Set-Cookie, as a browser would send them back. */
const cookieHeader = (cookies: string[]) =>
  cookies.map((cookie) => cookie.split(";")[0]).join("; ");

/* The attribute names after the name=value pair, lower-cased. */
const attributes = (cookie: string): Set<string> =>
  new Set(
    cookie
      .split(";")
      .slice(1)
      .map((part) => part.replace(/=.*$/, "").trim().toLowerCase()),
  );

async function signIn(): Promise<{ csrf: string[]; session: string }> {
  const { handlers } = NextAuth({
    ...buildBaseAuthConfig(current),
    providers: [
      Credentials({
        credentials: { email: {}, password: {} },
        authorize: () => ({ id: "u1", email: "alice@example.com", role: "member" }),
      }),
    ],
  });

  const csrfResponse = await handlers.GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const csrf = csrfResponse.headers.getSetCookie();

  const callback = await handlers.POST(
    new NextRequest(`${ORIGIN}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader(csrf),
      },
      body: new URLSearchParams({ csrfToken, email: "alice@example.com", password: "pw" }),
    }),
  );
  const session = callback.headers
    .getSetCookie()
    .filter((cookie) => cookie.includes("session-token="));
  if (session.length !== 1 || session[0] === undefined) {
    throw new Error(`expected one session cookie, got ${String(session.length)}`);
  }
  return { csrf, session: session[0] };
}

async function proxyWith(cookie: string): Promise<Response> {
  const response = await proxy(
    new NextRequest(`${ORIGIN}/history`, { headers: { cookie } }),
    event,
  );
  if (!(response instanceof Response)) throw new Error("the proxy gave no response");
  return response;
}

describe("under the default config, over http", () => {
  beforeEach(() => {
    current = settingsFrom(MINIMAL);
  });

  it("reads no secureCookies key, and defaults it on", () => {
    expect(current.auth.secureCookies).toBe(true);
  });

  it("issues the CSRF cookie with the __Host- prefix", async () => {
    const { csrf } = await signIn();
    const token = csrf.find((cookie) => cookie.includes("csrf-token="));
    expect(token).toMatch(/^__Host-authjs\.csrf-token=/);
  });

  it("issues __Secure-authjs.session-token, Secure, HttpOnly and SameSite=Lax", async () => {
    const { session } = await signIn();
    expect(session).toMatch(/^__Secure-authjs\.session-token=/);
    expect(attributes(session).has("secure")).toBe(true);
    expect(attributes(session).has("httponly")).toBe(true);
    expect(session).toMatch(/; SameSite=Lax(;|$)/i);
  });

  it("is let through by the proxy on an http request", async () => {
    const { session } = await signIn();
    expect((await proxyWith(cookieHeader([session]))).status).toBe(200);
  });

  it("is not let through under the bare name the proxy would use for http", async () => {
    const { session } = await signIn();
    const jwt = cookieHeader([session]).replace(/^__Secure-/, "");
    expect(jwt).toMatch(/^authjs\.session-token=/);
    const response = await proxyWith(jwt);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });
});

describe("with auth.secureCookies: false, for a plain-http run", () => {
  beforeEach(() => {
    current = settingsFrom(`${MINIMAL}auth:\n  secureCookies: false\n`);
  });

  it("issues the bare-named session cookie without Secure", async () => {
    const { session } = await signIn();
    expect(session).toMatch(/^authjs\.session-token=/);
    expect(attributes(session).has("secure")).toBe(false);
    expect(attributes(session).has("httponly")).toBe(true);
  });

  it("is let through by the proxy", async () => {
    const { session } = await signIn();
    expect((await proxyWith(cookieHeader([session]))).status).toBe(200);
  });
});
