"use client";

import { useEffect } from "react";
import { reloadWhenRestored } from "@/lib/session/navigate";

/* Reloads a page restored from the back/forward cache (lib/session/navigate.ts). */
export function RestoreGuard() {
  useEffect(() => reloadWhenRestored(), []);
  return null;
}
