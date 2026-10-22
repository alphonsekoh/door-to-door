"use client";

import { InstallPrompt } from "@/components/pwa/install-prompt";
import { UpdatePrompt } from "@/components/pwa/update-prompt";
import { hasRecordsToSend } from "@/lib/pwa/sw-update";
import { useRole } from "@/lib/hooks/use-role";

/* Signed-in members only: neither prompt belongs on the sign-in screen. The
   install prompt keeps its listener alive regardless; see its own comment.
   An update waits only for this member's records still being sent (D-32-6,
   refined by D-33). */
export function PwaPrompts() {
  const { isSignedIn, userId } = useRole();
  return (
    <>
      <InstallPrompt />
      {isSignedIn ? <UpdatePrompt hasUnsynced={() => hasRecordsToSend(userId)} /> : null}
    </>
  );
}
