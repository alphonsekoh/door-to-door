import { describe, expect, it } from "vitest";
import { formatTable, percentile, summarise, type Sample } from "@/server/stage/stats";

const sample = (ms: number, status = 200): Sample => ({
  ms,
  bytes: ms * 10,
  wireBytes: ms,
  status,
  ok: status === 200,
});

describe("percentile", () => {
  it("takes the nearest rank, never interpolating between samples", () => {
    const sorted = Array.from({ length: 20 }, (_, at) => at + 1);

    expect(percentile(sorted, 50)).toBe(10);
    expect(percentile(sorted, 95)).toBe(19);
    expect(percentile(sorted, 100)).toBe(20);
    expect(percentile([7], 95)).toBe(7);
  });

  it("is NaN with no samples, rather than a number nobody measured", () => {
    expect(percentile([], 50)).toBeNaN();
  });
});

describe("summarise", () => {
  it("reports percentiles, the median sizes and the failures of a route, by status", () => {
    const summary = summarise("POST /api/visits", [
      sample(30),
      sample(10, 429),
      sample(20),
      sample(100, 500),
      sample(40, 429),
    ]);

    expect(summary).toEqual({
      route: "POST /api/visits",
      count: 5,
      p50: 30,
      p95: 100,
      max: 100,
      bytes: 300,
      wireBytes: 30,
      failures: 3,
      failedWith: [429, 500],
    });
  });
});

describe("formatTable", () => {
  it("writes a Markdown table in milliseconds and kilobytes, with a dash for nothing measured", () => {
    const table = formatTable([
      summarise("page /", [{ ms: 12.4, bytes: 11_366, wireBytes: 3072, status: 200, ok: true }]),
      summarise("POST /api/visits", [sample(15, 429), sample(16, 429)]),
      summarise("GET /api/history", []),
    ]);

    expect(table.split("\n")).toEqual([
      "| Route | n | p50 ms | p95 ms | max ms | KB | KB sent | failed |",
      "| --- | --: | --: | --: | --: | --: | --: | --: |",
      "| page / | 1 | 12 | 12 | 12 | 11.1 | 3.0 | 0 |",
      "| POST /api/visits | 2 | 15 | 16 | 16 | 0.1 | 0.0 | 2 (429) |",
      "| GET /api/history | 0 | - | - | - | - | - | 0 |",
    ]);
  });
});
