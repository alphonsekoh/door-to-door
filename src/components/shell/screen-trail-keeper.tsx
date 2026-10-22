"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { arrived, traversed } from "@/lib/screen-trail";

/* Feeds the trail a retracing Back reads (lib/screen-trail.ts). */
export function ScreenTrailKeeper() {
  const pathname = usePathname();

  useEffect(() => {
    window.addEventListener("popstate", traversed);
    return () => {
      window.removeEventListener("popstate", traversed);
    };
  }, []);

  useEffect(() => {
    arrived(pathname);
  }, [pathname]);

  return null;
}
