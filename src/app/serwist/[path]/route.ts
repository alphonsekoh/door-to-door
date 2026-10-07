import { randomUUID } from "node:crypto";
import { createSerwistRoute } from "@serwist/turbopack";

/*
 * Builds the service worker at `next build` and serves it as a static file at
 * /serwist/sw.js. Glob roots are relative to the repo, so the precache lists
 * the hashed bundles Next just emitted plus everything in public/.
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/app/sw.ts",
    globDirectory: ".",
    globPatterns: ["public/**/*.{png,svg,ico}", ".next/static/**/*.{js,css,woff2}"],
    additionalPrecacheEntries: [{ url: "/offline", revision: randomUUID() }],
    useNativeEsbuild: true,
  },
);
