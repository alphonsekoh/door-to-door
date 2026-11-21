/*
 * The stage stack's app reaches its database through toxiproxy (#244). A
 * latency toxic on each direction adds a fixed round trip to every query, to
 * model a function in one region and its database in another, which a
 * database on the same Docker network never shows.
 */

export const DATABASE_PROXY = "postgres";
const TOXICS = { upstream: "stage-latency-up", downstream: "stage-latency-down" } as const;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function call(api: string, path: string, init: RequestInit, fetchImpl: FetchLike) {
  try {
    return await fetchImpl(new URL(path, api).toString(), init);
  } catch {
    throw new Error(`Could not reach toxiproxy at ${api}. Is the stage stack up? npm run stage:up`);
  }
}

/* Clears any delay this check added, then adds `roundTripMs`, half each way. 0 leaves none. */
export async function setDatabaseLatency(
  api: string,
  roundTripMs: number,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const base = `/proxies/${DATABASE_PROXY}/toxics`;
  for (const name of Object.values(TOXICS)) {
    const response = await call(api, `${base}/${name}`, { method: "DELETE" }, fetchImpl);
    if (!response.ok && response.status !== 404) {
      throw new Error(`toxiproxy refused to remove ${name}: HTTP ${String(response.status)}`);
    }
  }
  if (roundTripMs === 0) return;
  const halves = { upstream: Math.floor(roundTripMs / 2), downstream: Math.ceil(roundTripMs / 2) };
  for (const stream of ["upstream", "downstream"] as const) {
    const response = await call(
      api,
      base,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: TOXICS[stream],
          type: "latency",
          stream,
          attributes: { latency: halves[stream], jitter: 0 },
        }),
      },
      fetchImpl,
    );
    if (!response.ok) {
      throw new Error(`toxiproxy refused the ${stream} delay: HTTP ${String(response.status)}`);
    }
  }
}
