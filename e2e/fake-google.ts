import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";

/*
 * A stand-in for Google's OpenID provider (#14): nothing in the tests may
 * need real Google or real credentials. Just enough of it for Auth.js's
 * Google provider, pointed here by auth.google.issuer: discovery, an
 * authorize page, the token endpoint and the signing key.
 *
 * The authorize page asks for an email, whether Google has verified it and
 * the account's Workspace domain (`hd`, none for a consumer account), and
 * the code it hands back carries that answer to the token endpoint, which
 * signs an ID token saying so. Vitest calls `handle` as Auth.js's
 * customFetch; Playwright runs it as a server (see the end of the file).
 */

export type FakeGoogleAccount = {
  email: string;
  verified: boolean;
  /* Google's id for the account; by default one per email, as Google's is. */
  sub?: string;
  /*
   * The Google Workspace domain the account belongs to, which Google sends
   * only for a Workspace account. Any JSON value, so a test can send one
   * that is not a string.
   */
  hd?: unknown;
};

export const FAKE_GOOGLE_CLIENT_ID = "fake-client.apps.googleusercontent.com";
export const FAKE_GOOGLE_CLIENT_SECRET = "fake-google-secret-for-tests-only";

/* What the authorize page sends back to the app as `code`. */
export function fakeGoogleCode(account: FakeGoogleAccount): string {
  return Buffer.from(JSON.stringify(account)).toString("base64url");
}

function readCode(code: string): FakeGoogleAccount | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(code, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "email" in parsed &&
      typeof parsed.email === "string" &&
      "verified" in parsed &&
      typeof parsed.verified === "boolean"
    ) {
      const sub = "sub" in parsed && typeof parsed.sub === "string" ? parsed.sub : undefined;
      return {
        email: parsed.email,
        verified: parsed.verified,
        ...(sub === undefined ? {} : { sub }),
        ...("hd" in parsed ? { hd: parsed.hd } : {}),
      };
    }
  } catch {
    /* Not one of ours. */
  }
  return null;
}

const subFor = (email: string) =>
  `fake-${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 20)}`;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

export type FakeGoogle = {
  issuer: string;
  handle: (request: Request) => Promise<Response>;
};

export function createFakeGoogle(issuer: string, clientId = FAKE_GOOGLE_CLIENT_ID): FakeGoogle {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "fake-google-key";

  function idToken(account: FakeGoogleAccount): string {
    const now = Math.floor(Date.now() / 1000);
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${part({ alg: "RS256", typ: "JWT", kid })}.${part({
      iss: issuer,
      aud: clientId,
      azp: clientId,
      sub: account.sub ?? subFor(account.email),
      email: account.email,
      email_verified: account.verified,
      ...(account.hd === undefined ? {} : { hd: account.hd }),
      name: "Name From Google",
      picture: "https://example.invalid/picture.png",
      iat: now,
      exp: now + 600,
    })}`;
    return `${input}.${sign("sha256", Buffer.from(input), privateKey).toString("base64url")}`;
  }

  function authorizePage(url: URL): Response {
    const fields = ["redirect_uri", "state"]
      .map(
        (name) =>
          `<input type="hidden" name="${name}" value="${escapeHtml(url.searchParams.get(name) ?? "")}">`,
      )
      .join("");
    // The heading says whether the app asked Google to show the account chooser.
    const heading =
      url.searchParams.get("prompt") === "select_account" ? "Choose an account" : "Sign in";
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<title>Fake Google</title></head><body><h1>${heading}</h1>
<form method="post" action="/approve">${fields}
<label>Email <input name="email" type="email"></label>
<label><input name="verified" type="checkbox" checked> Verified by Google</label>
<label>Workspace domain <input name="hd"></label>
<button type="submit">Continue</button></form></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  async function approve(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const redirect = new URL(form.get("redirect_uri") ?? "");
    const hd = form.get("hd") ?? "";
    redirect.searchParams.set(
      "code",
      fakeGoogleCode({
        email: form.get("email") ?? "",
        verified: form.get("verified") === "on",
        ...(hd === "" ? {} : { hd }),
      }),
    );
    redirect.searchParams.set("state", form.get("state") ?? "");
    return new Response(null, { status: 302, headers: { location: redirect.toString() } });
  }

  async function token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const account = readCode(form.get("code") ?? "");
    const basic = request.headers.get("authorization") ?? "";
    const [id] = Buffer.from(basic.replace(/^Basic /, ""), "base64")
      .toString()
      .split(":");
    if (account === null || decodeURIComponent(id ?? "") !== clientId) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    return Response.json({
      access_token: "fake-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
      id_token: idToken(account),
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/.well-known/openid-configuration":
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        });
      case "/authorize":
        return authorizePage(url);
      case "/approve":
        return approve(request);
      case "/token":
        return token(request);
      case "/jwks":
        return Response.json({
          keys: [{ ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" }],
        });
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  return { issuer, handle };
}

/* As a server, for Playwright: `tsx e2e/fake-google.ts`, on FAKE_GOOGLE_PORT. */
if (process.argv[1]?.endsWith("fake-google.ts") === true) {
  const port = Number(process.env["FAKE_GOOGLE_PORT"] ?? 4210);
  const fake = createFakeGoogle(`http://127.0.0.1:${String(port)}`);
  createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const body = Buffer.concat(chunks);
      const request = new Request(`${fake.issuer}${incoming.url ?? "/"}`, {
        method: incoming.method ?? "GET",
        headers: Object.entries(incoming.headers).flatMap(([name, value]): [string, string][] =>
          value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]],
        ),
        ...(body.length > 0 ? { body } : {}),
      });
      void fake.handle(request).then(async (response) => {
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      });
    });
  }).listen(port, "127.0.0.1");
}
