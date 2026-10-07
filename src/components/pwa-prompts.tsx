"use client";

import { InstallPrompt } from "@/components/install-prompt";
import { UpdatePrompt } from "@/components/update-prompt";
import { useRole } from "@/lib/use-role";

/* Signed-in members only: neither prompt belongs on the sign-in screen. The
   install prompt keeps its listener alive regardless; see its own comment. */
export function PwaPrompts() {
  const { isSignedIn } = useRole();
  return (
    <>
      <InstallPrompt />
      {isSignedIn ? <UpdatePrompt /> : null}
    </>
  );
}
