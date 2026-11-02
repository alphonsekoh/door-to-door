"use client";

import { usePathname, useSelectedLayoutSegment } from "next/navigation";

/*
 * The path of the route actually rendered, for the chrome the root layout
 * draws (the nav, the sync bar, the queue, the account check, the install
 * banner). Call it only from there: the segment is the one below the
 * nearest layout.
 *
 * Where the service worker serves the prerendered /offline page for an
 * address that failed (/ or /blocks/<id>), usePathname() reads that address
 * on the client but /offline on the server, so whatever depends on it
 * hydrates against different HTML (React #418). The segment comes from the
 * route tree in the page itself, the same on both sides.
 */
export function useRoutePathname(): string {
  const pathname = usePathname();
  return useSelectedLayoutSegment() === "offline" ? "/offline" : pathname;
}
