"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";

/*
 * Registers the service worker, in production builds only: in `next dev` a
 * worker would serve stale bundles and make every edit look like a bug.
 *
 * The provider's two conveniences are off on purpose. cacheOnNavigation would
 * store each visited page, which is signed-in HTML; reloadOnOnline would
 * reload the page under a member who is part-way through recording.
 */
export function PwaProvider({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV !== "production"}
      cacheOnNavigation={false}
      reloadOnOnline={false}
      options={{ scope: "/", type: "classic" }}
    >
      {children}
    </SerwistProvider>
  );
}
