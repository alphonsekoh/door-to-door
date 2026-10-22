"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AuthFailureScreen } from "@/components/shell/auth-failure-screen";
import { accountStore } from "@/lib/account-state";
import { useRole } from "@/lib/use-role";
import { loadCurrentUser } from "@/lib/users";
import { isPublicPath } from "@/server/auth/routes";

/*
 * Holds the app behind the account message once the server refuses the
 * session. The app underneath is made inert by the message's modal, not
 * unmounted, so a half-typed form is not thrown away by a message the member
 * did not cause.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const { failure } = useSyncExternalStore(
    accountStore.subscribe,
    accountStore.getSnapshot,
    accountStore.getServerSnapshot,
  );
  const { isSignedIn } = useRole();
  const pathname = usePathname();
  const checked = useRef(false);

  /* Once per document load: server-rendered and not-found pages make no API
     call of their own, and this read is also what brings a changed role into
     the nav. The shell is not remounted by client navigation. */
  const shouldCheck = isSignedIn && !isPublicPath(pathname);
  useEffect(() => {
    if (!shouldCheck || checked.current) return;
    checked.current = true;
    /* Offline or refused: apiFetch has already reported anything that matters. */
    loadCurrentUser().catch(() => undefined);
  }, [shouldCheck]);

  return (
    <>
      {children}
      {failure === null ? null : <AuthFailureScreen kind={failure} />}
    </>
  );
}
