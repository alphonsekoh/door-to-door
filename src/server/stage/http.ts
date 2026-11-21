import type {
  Agent,
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
  RequestOptions,
} from "node:http";
import { performance } from "node:perf_hooks";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

/*
 * The stage check's HTTP client (#244). node:http rather than fetch, which
 * decompresses out of sight: the check reports what crossed the wire as well
 * as what the page or API returned, and a phone on mobile data pays for the
 * first. It also takes the stage edge's own certificate authority through the
 * agent, so TLS stays verified.
 */

/* http.request or https.request, as the base URL's scheme needs. */
export type Transport = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export type Exchange = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  wireBytes: number;
  /* Request sent to the last byte received. */
  ms: number;
};

export function decode(encoding: string | undefined, wire: Buffer): Buffer {
  switch (encoding) {
    case "gzip":
      return gunzipSync(wire);
    case "br":
      return brotliDecompressSync(wire);
    case "deflate":
      return inflateSync(wire);
    default:
      return wire;
  }
}

export type CookieJar = {
  header: () => string;
  store: (setCookie: readonly string[] | undefined) => void;
  names: () => string[];
};

/* Enough of a browser's jar for one site: the latest value of each name wins, and a cleared one goes. */
export function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>();
  return {
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    store: (setCookie) => {
      for (const line of setCookie ?? []) {
        const end = line.indexOf(";");
        const pair = end === -1 ? line : line.slice(0, end);
        const split = pair.indexOf("=");
        const name = pair.slice(0, split).trim();
        const value = pair.slice(split + 1).trim();
        if (value === "" || /;\s*max-age=0\s*(?:;|$)/i.test(line)) cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    names: () => [...cookies.keys()],
  };
}

export type RequestInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

export type StageClient = {
  request: (path: string, init?: RequestInit) => Promise<Exchange>;
  jar: CookieJar;
};

export type ClientOptions = { baseUrl: string; transport: Transport; agent: Agent };

/* One signed-in phone: its own cookies, the compression a browser asks for. */
export function createClient({ baseUrl, transport, agent }: ClientOptions): StageClient {
  const jar = createCookieJar();
  const send = (path: string, { method = "GET", body, headers = {} }: RequestInit) =>
    new Promise<Omit<Exchange, "body"> & { wire: Buffer }>((resolve, reject) => {
      const started = performance.now();
      const cookie = jar.header();
      const sent = transport(
        new URL(path, baseUrl),
        {
          method,
          agent,
          headers: {
            "accept-encoding": "gzip, br",
            "user-agent": "door-to-door-stage-check",
            ...(cookie === "" ? {} : { cookie }),
            ...(body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) }),
            ...headers,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (data: Buffer) => {
            chunks.push(data);
          });
          response.on("end", () => {
            const wire = Buffer.concat(chunks);
            jar.store(response.headers["set-cookie"]);
            resolve({
              status: Number(response.statusCode),
              headers: response.headers,
              wire,
              wireBytes: wire.length,
              ms: performance.now() - started,
            });
          });
        },
      );
      sent.on("error", reject);
      sent.end(body);
    });
  /* Decoded once the clock has stopped: that is the phone's work, not the server's. */
  const request = async (path: string, init: RequestInit = {}): Promise<Exchange> => {
    const { wire, ...rest } = await send(path, init);
    return { ...rest, body: decode(rest.headers["content-encoding"], wire) };
  };
  return { request, jar };
}
