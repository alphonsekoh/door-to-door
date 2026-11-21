import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createClient } from "../src/server/stage/http";
import { formatReport, parsePerfArgs, runPerfCheck } from "../src/server/stage/perf";
import { setDatabaseLatency } from "../src/server/stage/toxiproxy";

/*
 * The stage check (#244), run as `npm run stage:perf`. The logic is in
 * src/server/stage; this wires it to the stack and the terminal.
 */

/* The edge's own certificate authority, read from its volume, so TLS is verified. */
function stageAuthority(): string {
  return execFileSync(
    "docker",
    [
      ...["compose", "-p", "door-to-door-stage", "-f", "docker-compose.stage.yml"],
      ...["exec", "-T", "edge", "cat", "/data/caddy/pki/authorities/local/root.crt"],
    ],
    { encoding: "utf8" },
  );
}

async function main(): Promise<void> {
  const options = parsePerfArgs(process.argv.slice(2), process.env);
  const secure = new URL(options.baseUrl).protocol === "https:";
  const agent = secure
    ? new https.Agent({ keepAlive: true, ca: stageAuthority() })
    : new http.Agent({ keepAlive: true });
  try {
    const report = await runPerfCheck(options, {
      client: () =>
        createClient({
          baseUrl: options.baseUrl,
          transport: secure ? https.request : http.request,
          agent,
        }),
      setLatency: (roundTripMs) => setDatabaseLatency(options.toxiproxyUrl, roundTripMs),
      now: () => new Date(),
      log: (message) => {
        process.stderr.write(`${message}\n`);
      },
    });
    console.log(formatReport(report));
    if (options.json !== undefined)
      writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    agent.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
