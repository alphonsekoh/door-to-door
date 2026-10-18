import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Resolves the "@/*" alias from tsconfig.json natively, no plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    server: {
      // next-auth reaches for next/server, which does not resolve outside the
      // Next.js runtime unless it is inlined.
      deps: { inline: ["next-auth", "@auth/core"] },
    },
    projects: [
      {
        extends: true,
        test: {
          name: { label: "unit", color: "green" },
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: { label: "integration", color: "yellow" },
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          globalSetup: ["./vitest.globalSetup.integration.ts"],
          setupFiles: ["./vitest.setup.integration.ts"],
          // Shared scratch database: parallel files would truncate each other.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: { label: "components", color: "cyan" },
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.components.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      // Listing every source file, not only imported ones, so an untested file
      // counts as uncovered rather than quietly vanishing from the report.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/generated/**",
        // Integration-test harness: only tests import it, so it is not app code.
        "src/db/testing.ts",
        "drizzle/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/app/**/layout.tsx",
        "src/app/**/error.tsx",
        "src/app/**/global-error.tsx",
        "**/*.config.*",
      ],
      thresholds: {
        // Logic carries a hard 100%. These directories hold the code where a
        // missed branch is a real defect rather than an unrendered variant.
        "src/lib/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/server/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/db/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/app/api/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
        // Root-level entry points: the proxy and instrumentation hooks.
        "src/*.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },

        // UI sits at 90: chasing the last 10% of JSX branches produces tests
        // that assert nothing.
        "src/components/**": { statements: 90, branches: 90, functions: 90, lines: 90 },
        "src/app/**": { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});
