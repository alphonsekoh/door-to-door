import { format } from "node:util";
import { encode } from "next-auth/jwt";
import { NextRequest, type NextFetchEvent } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthLog } from "@/server/auth/auth-log";

/*
 * What a session cookie can make the server log (#128), through the real
 * proxy and real Auth.js, with only the config file stood in for.
 */

const SECRET = "s".repeat(40);
vi.mock("@/server/config", () => ({
  getConfig: () => ({ authSecret: SECRET, auth: { trustHost: true, secureCookies: true } }),
}));

const { default: proxy } = await import("@/proxy");

const COOKIE = "__Secure-authjs.session-token";
const INJECTED = "[auth][error] a line the cookie wrote";

const b64 = (text: string) => Buffer.from(text).toString("base64url");

/*
 * A JWE whose protected header marks an extension of the sender's choosing
 * critical. jose refuses it before any key is derived, quoting its name.
 */
const forged = [
  b64(
    JSON.stringify({
      alg: "dir",
      enc: "A256GCM",
      crit: [`x\r\n${INJECTED}\u001b[31m\u001b]0;owned\u0007\u2028`],
    }),
  ),
  "",
  b64("twelve bytes"),
  b64("ciphertext"),
  b64("sixteen byte tag"),
].join(".");

const CLAIMS = {
  sub: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  email: "ana.lim@example.com",
  name: "Ana Lim",
  role: "admin",
};

/* Signed with the app's own secret, so it decrypts, and an hour past its expiry. */
const expired = () => encode({ token: CLAIMS, secret: SECRET, salt: COOKIE, maxAge: -3600 });

let written: string[] = [];

beforeEach(() => {
  resetAuthLog();
  written = [];
  for (const method of ["error", "warn", "log", "info", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      written.push(format(...args));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function visit(token: string): Promise<Response> {
  const request = new NextRequest("http://127.0.0.1:3210/history", {
    headers: { cookie: `${COOKIE}=${token}` },
  });
  return proxy(request, {} as NextFetchEvent);
}

describe("a forged session cookie", () => {
  it("writes one line, with none of its text and no line break or escape", async () => {
    const response = await visit(forged);

    expect(response.status).toBe(307);
    expect(written).toEqual(["[auth][error] JWTSessionError (cause ERR_JOSE_NOT_SUPPORTED)"]);
    const output = written.join("");
    for (const character of ["\n", "\r", "\u001b", "\u2028"]) {
      expect(output).not.toContain(character);
    }
    expect(output).not.toContain(INJECTED);
    expect(output).not.toContain("owned");
  });

  it("writes one line for ten identical requests", async () => {
    for (let i = 0; i < 10; i += 1) {
      await visit(forged);
    }
    expect(written).toHaveLength(1);
  });
});

describe("an expired session cookie", () => {
  it("never writes its claims", async () => {
    const response = await visit(await expired());

    expect(response.status).toBe(307);
    expect(written).toEqual(["[auth][error] JWTSessionError (cause ERR_JWT_EXPIRED)"]);
    for (const claim of Object.values(CLAIMS)) {
      expect(written.join("")).not.toContain(claim);
    }
  });
});
