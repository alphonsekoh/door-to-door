import { format } from "node:util";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/client";
import { MAX_EMAIL_LENGTH } from "@/server/auth/credentials";
import { resetAuthLog } from "@/server/auth/auth-log";
import { GET, POST } from "./route";

/*
 * Real Auth.js underneath, with only the config file stood in for: a rename
 * in Auth.js, or an export that skips the header wrapper, fails here rather
 * than at runtime. No request below reaches the database.
 */
vi.mock("@/server/config", () => ({
  getConfig: () => ({
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/nowhere",
    authSecret: "a-secret-that-is-long-enough-for-tests",
    auth: { trustHost: true, secureCookies: true },
    rateLimit: {
      signInAttempts: 10,
      signInAttemptsPerClient: 30,
      signInWindowSeconds: 300,
      trustedProxyHops: 0,
    },
  }),
}));

afterEach(async () => {
  await resetDatabase();
});

const ORIGIN = "http://127.0.0.1:3210";

/* A token and the cookie that backs it, as the form's first request gets them. */
async function freshCsrf(): Promise<{ csrfToken: string; cookie: string }> {
  const csrf = await GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const cookie = csrf.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .join("; ");
  return { csrfToken, cookie };
}

/* Over-long, so it is refused before the limiter or the database, with a line
   of its own from the credentials check. */
const OVERLONG_EMAIL = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;

describe("auth catch-all route", () => {
  it("answers GET with Auth.js's CSRF token, no-store", async () => {
    const response = await GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ csrfToken: expect.any(String) as string });
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Secure under the default config, though this request is plain http.
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContainEqual(expect.stringMatching(/^__Host-authjs\.csrf-token=/));
    expect(cookies.filter((cookie) => !/; Secure(;|$)/.test(cookie))).toEqual([]);
  });

  it("clears the HTTP cache on a sign-out POST, even one Auth.js refuses", async () => {
    // No CSRF token, so Auth.js refuses it; the cache is cleared anyway (D-122-10).
    const response = await POST(new NextRequest(`${ORIGIN}/api/auth/signout`, { method: "POST" }));
    expect(response.headers.get("clear-site-data")).toBe('"cache"');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("what it logs (#128)", () => {
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

  it("writes a forged session cookie as one line of its own making", async () => {
    // The full config builds on the base one, so the route logs as the proxy does.
    const header = Buffer.from(
      JSON.stringify({ alg: "dir", enc: "A256GCM", crit: ["x\r\n[auth][error] forged"] }),
    ).toString("base64url");
    await GET(
      new NextRequest(`${ORIGIN}/api/auth/session`, {
        headers: { cookie: `__Secure-authjs.session-token=${header}..aXY.Y3Q.dGFn` },
      }),
    );
    expect(written).toEqual(["[auth][error] JWTSessionError (cause ERR_JOSE_NOT_SUPPORTED)"]);
  });

  it("writes a refused sign-in once: the sign-in log's line, not Auth.js's CredentialsSignin", async () => {
    const { csrfToken, cookie } = await freshCsrf();

    const response = await POST(
      new NextRequest(`${ORIGIN}/api/auth/callback/credentials`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        body: new URLSearchParams({ csrfToken, email: OVERLONG_EMAIL, password: "wrong" }),
      }),
    );

    expect(response.headers.get("location")).toContain("error=CredentialsSignin");
    expect(written).toEqual([
      "Sign-in refused: an email or password longer than any account can have",
    ]);
  });

  /*
   * The form sends a CSRF refusal again by itself (#151), and tells it apart
   * from a refused password by this type. Both rest on Auth.js refusing it
   * before the credentials check runs: no budget is charged, and the answer
   * is the same whoever the email belongs to.
   */
  it("refuses a token its cookie does not back as MissingCSRF, before reading the credentials", async () => {
    const [page, stale] = await Promise.all([freshCsrf(), freshCsrf()]);

    const response = await POST(
      new NextRequest(`${ORIGIN}/api/auth/callback/credentials`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          // As next-auth/react's signIn sends it, for an answer it can read.
          "x-auth-return-redirect": "1",
          cookie: stale.cookie,
        },
        body: new URLSearchParams({
          csrfToken: page.csrfToken,
          email: OVERLONG_EMAIL,
          password: "wrong",
        }),
      }),
    );

    const { url } = (await response.json()) as { url: string };
    expect(new URL(url).searchParams.get("error")).toBe("MissingCSRF");
    // No line from the credentials check: it never ran.
    expect(written).toEqual(["[auth][error] MissingCSRF"]);
  });
});
