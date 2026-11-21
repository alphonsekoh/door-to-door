/*
 * What the stage check reports per route (#244): latency percentiles and
 * response sizes, as a Markdown table for a pull request or the board, or as
 * JSON to compare two runs.
 */

export type Sample = { ms: number; bytes: number; wireBytes: number; status: number; ok: boolean };

export type RouteSummary = {
  route: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  /* The median response, decoded and as sent. */
  bytes: number;
  wireBytes: number;
  failures: number;
  /* What the failures answered, each status once: 429 is a limit, not a slow server. */
  failedWith: number[];
};

/* Nearest rank: the smallest sample at or above p percent of them. NaN with none. */
export function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted.slice(0, rank).reduce((_, value) => value, Number.NaN);
}

const ascending = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

export function summarise(route: string, samples: readonly Sample[]): RouteSummary {
  const ms = ascending(samples.map((sample) => sample.ms));
  return {
    route,
    count: samples.length,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    max: percentile(ms, 100),
    bytes: percentile(ascending(samples.map((sample) => sample.bytes)), 50),
    wireBytes: percentile(ascending(samples.map((sample) => sample.wireBytes)), 50),
    failures: samples.filter((sample) => !sample.ok).length,
    failedWith: [
      ...new Set(ascending(samples.filter((sample) => !sample.ok).map((sample) => sample.status))),
    ],
  };
}

const milliseconds = (value: number): string => (Number.isNaN(value) ? "-" : value.toFixed(0));
const kilobytes = (value: number): string =>
  Number.isNaN(value) ? "-" : (value / 1024).toFixed(1);

const failed = (row: RouteSummary): string =>
  row.failures === 0 ? "0" : `${String(row.failures)} (${row.failedWith.join(", ")})`;

export function formatTable(rows: readonly RouteSummary[]): string {
  const header = [
    "| Route | n | p50 ms | p95 ms | max ms | KB | KB sent | failed |",
    "| --- | --: | --: | --: | --: | --: | --: | --: |",
  ];
  const lines = rows.map(
    (row) =>
      `| ${row.route} | ${String(row.count)} | ${milliseconds(row.p50)} | ${milliseconds(row.p95)} | ` +
      `${milliseconds(row.max)} | ${kilobytes(row.bytes)} | ${kilobytes(row.wireBytes)} | ${failed(row)} |`,
  );
  return [...header, ...lines].join("\n");
}
