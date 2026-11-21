import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, createCookieJar, decode } from "@/server/stage/http";

/* A real server on loopback: the client's job is the bytes on the wire. */

type Seen = {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
};
const seen: Seen[] = [];
const PAYLOAD = JSON.stringify({
  data: Array.from({ length: 50 }, (_, at) => ({ unit: `#05-${String(at)}` })),
});

function respond(request: IncomingMessage, response: ServerResponse, body: string): void {
  seen.push({ method: request.method, url: request.url, headers: request.headers, body });
  const encoding = new URL(request.url ?? "/", "http://x").searchParams.get("encoding");
  const encoded =
    encoding === "gzip"
      ? gzipSync(PAYLOAD)
      : encoding === "br"
        ? brotliCompressSync(PAYLOAD)
        : Buffer.from(PAYLOAD);
  response.writeHead(request.method === "POST" ? 201 : 200, {
    "content-type": "application/json",
    ...(encoding === null ? {} : { "content-encoding": encoding }),
    "set-cookie": ["session=abc; Path=/; HttpOnly", "theme=dark"],
  });
  response.end(encoded);
}

const server = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  request.on("end", () => {
    respond(request, response, Buffer.concat(chunks).toString("utf8"));
  });
});
let baseUrl = "";
const agent = new http.Agent({ keepAlive: true });

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  agent.destroy();
  await new Promise((resolve) => server.close(resolve));
});

describe("createClient", () => {
  it("asks for compression, times the exchange and reports both sizes", async () => {
    const client = createClient({ baseUrl, transport: http.request, agent });

    const answer = await client.request("/api/history?encoding=gzip");

    expect(answer.status).toBe(200);
    expect(answer.body.toString("utf8")).toBe(PAYLOAD);
    expect(answer.wireBytes).toBe(gzipSync(PAYLOAD).length);
    expect(answer.wireBytes).toBeLessThan(answer.body.length);
    expect(answer.ms).toBeGreaterThan(0);
    expect(seen.at(-1)?.headers["accept-encoding"]).toBe("gzip, br");
    expect(seen.at(-1)?.headers.cookie).toBeUndefined();
  });

  it("sends back the cookies it was given, as a phone does", async () => {
    const client = createClient({ baseUrl, transport: http.request, agent });

    await client.request("/first");
    await client.request("/second?encoding=br");

    expect(seen.at(-1)?.headers.cookie).toBe("session=abc; theme=dark");
    expect(client.jar.names()).toEqual(["session", "theme"]);
  });

  it("posts a body with its length and the caller's headers", async () => {
    const client = createClient({ baseUrl, transport: http.request, agent });

    const answer = await client.request("/api/visits", {
      method: "POST",
      body: '{"unit":"#05-123"}',
      headers: { "content-type": "application/json" },
    });

    expect(answer.status).toBe(201);
    expect(seen.at(-1)).toMatchObject({
      method: "POST",
      url: "/api/visits",
      body: '{"unit":"#05-123"}',
      headers: { "content-type": "application/json", "content-length": "18" },
    });
  });

  it("fails when nothing answers", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const client = createClient({
      baseUrl: `http://127.0.0.1:${String(port)}`,
      transport: http.request,
      agent,
    });

    await expect(client.request("/")).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("decode", () => {
  it("undoes gzip, brotli and deflate, and leaves anything else as sent", () => {
    const text = Buffer.from("door to door");

    expect(decode("gzip", gzipSync(text))).toEqual(text);
    expect(decode("br", brotliCompressSync(text))).toEqual(text);
    expect(decode("deflate", deflateSync(text))).toEqual(text);
    expect(decode(undefined, text)).toEqual(text);
  });
});

describe("createCookieJar", () => {
  it("keeps the latest value of each cookie and drops one the server clears", () => {
    const jar = createCookieJar();

    jar.store(["__Host-authjs.csrf-token=one; Path=/; Secure", "callback=/; Path=/"]);
    jar.store(["__Host-authjs.csrf-token=two; Path=/; Secure"]);
    jar.store(["callback=; Path=/; Max-Age=0"]);
    jar.store(undefined);

    expect(jar.header()).toBe("__Host-authjs.csrf-token=two");
  });

  it("drops a cookie expired by Max-Age=0 even when it still carries a value", () => {
    const jar = createCookieJar();

    jar.store(["a=1", "b=2"]);
    jar.store(["a=gone; Path=/; Max-Age=0; Secure"]);

    expect(jar.names()).toEqual(["b"]);
  });
});
