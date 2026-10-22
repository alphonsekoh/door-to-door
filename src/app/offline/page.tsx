import type { Metadata } from "next";
import { OfflineShell } from "@/components/shell/offline-shell";

export const metadata: Metadata = { title: "Offline" };

/* Precached by the service worker and shown for any navigation that cannot
   be fetched. Prerendered static HTML on purpose: the same file is served to
   whoever picks up the phone, so it carries nothing about any member, and
   everything the shell shows is read on the phone at runtime (D-77-7). The
   shell titles itself: "Offline", or the block it has open. */
export default function OfflinePage() {
  return <OfflineShell />;
}
