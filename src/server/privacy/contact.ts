import type { PrivacyContact } from "@/lib/privacy/policy";
import { getConfig } from "@/server/config";

/* Per call, never at module scope: `next build` has no config file (D-13-4). */
export function privacyContact(): PrivacyContact {
  return getConfig().privacy;
}
