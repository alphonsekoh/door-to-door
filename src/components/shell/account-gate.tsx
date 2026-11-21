"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AuthFailureScreen } from "@/components/shell/auth-failure-screen";
import { accountStore } from "@/lib/session/account-state";
import { useRole } from "@/lib/hooks/use-role";
import { replaceWith } from "@/lib/session/navigate";
import { loadCurrentUser } from "@/lib/session/users";
import { useRoutePathname } from "@/lib/hooks/use-route-pathname";
import { WAITING_PATH, isPublicPath, isWaitingPath } from "@/server/auth/routes";

/*
 * Holds the app behind the account message once the server refuses the
 * session. The app underneath is made inert by the message's modal, not
 * unmounted, so a half-typed form is not thrown away by a message the member
 * did not cause.
 *
 * An account nobody has approved yet is not given a message: it is taken to
 * the waiting page, the one screen it may use (#249). The waiting page
 * answers its own refusals.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const { failure } = useSyncExternalStore(
    accountStore.subscribe,
    accountStore.getSnapshot,
    accountStore.getServerSnapshot,
  );
  const { isSignedIn } = useRole();
  const pathname = useRoutePathname();
  const checked = useRef(false);
  const [unapproved, setUnapproved] = useState(false);

  /* Once per document load: server-rendered and not-found pages make no API
     call of their own, and this read is also what brings a changed role into
     the nav, and what finds an account still waiting for approval on a
     screen that makes no request it would be refused. The shell is not
     remounted by client navigation. */
  const shouldCheck = isSignedIn && !isPublicPath(pathname);
  useEffect(() => {
    if (!shouldCheck || checked.current) return;
    checked.current = true;
    /* Offline or refused: apiFetch has already reported anything that matters. */
    loadCurrentUser().then(
      (user) => {
        if (user.approval === "pending" || user.approval === "blocked") setUnapproved(true);
      },
      () => undefined,
    );
  }, [shouldCheck]);

  const toWaiting = (unapproved || failure === "unapproved") && !isWaitingPath(pathname);
  useEffect(() => {
    /* Replaced, so Back does not return to a screen that sends them on again. */
    if (toWaiting) replaceWith(WAITING_PATH);
  }, [toWaiting]);

  /* Nothing of a screen that cannot load is drawn on the way: its refusal
     would flash up before the waiting page. */
  if (toWaiting) return null;

  return (
    <>
      {children}
      {failure === null || failure === "unapproved" ? null : <AuthFailureScreen kind={failure} />}
    </>
  );
}
