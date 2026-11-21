"use client";

import Link from "next/link";
import { NavIcon } from "@/components/ui/nav-icon";
import { isActiveRoute, visibleNavItems } from "@/lib/session/nav";
import { useShellState } from "@/lib/offline/shell-state";
import { useRoutePathname } from "@/lib/hooks/use-route-pathname";
import { badgeCount, useApprovalCount } from "@/lib/session/approval-count";
import { isPublicPath, isWaitingPath } from "@/server/auth/routes";
import { useRole } from "@/lib/hooks/use-role";

export function BottomNav() {
  const pathname = useRoutePathname();
  const { isAdmin } = useRole();
  const items = visibleNavItems(isAdmin);
  const shell = useShellState();
  /* The waiting page leads nowhere else: every tab would only send its
     account back there (#249). */
  const hidden = isPublicPath(pathname) || isWaitingPath(pathname) || shell.active;
  /* Who waits for an admin's approval, on the Admin tab (#249). */
  const waiting = useApprovalCount(isAdmin && !hidden);

  /*
   * Nothing to navigate to on a public route, and rendering it there does
   * harm: each Link prefetches while signed out, the proxy answers with a
   * redirect to /sign-in, and the client router caches that. The push after a
   * successful sign-in then replays the cached redirect and the member is left
   * staring at the form they just completed.
   */
  /* On the offline shell every link would be a cold reload, offline, back
     into the shell, losing the form on the way (D-77-12). */
  if (hidden) {
    return null;
  }

  /*
   * Glass, exactly --nav-height tall, so the Save bar docked on it meets it
   * edge to edge with nothing showing through between. When one is docked
   * the two read as one slab and the nav drops its own lit edge.
   *
   * Drawn at the 16px base whatever the text size, as an iPhone's tab bar
   * is: grown with the text, it took a fifth of the screen at the largest.
   * Labels never wrap. Where a tab is too narrow for its label, on a narrow
   * phone, the label is kept for screen readers only (in px, as a container
   * query's rem is the reader's).
   */
  return (
    <nav
      aria-label="Primary"
      className="material-chrome fixed inset-x-0 bottom-0 z-40 inset-safe-bottom chrome-size [body:has([data-docked])_&]:shadow-none"
    >
      <ul className="mx-auto flex h-(--nav-height) max-w-screen-sm">
        {items.map((item) => {
          const active = isActiveRoute(pathname, item);
          const badge = item.adminOnly === true && waiting !== null && waiting > 0 ? waiting : null;
          return (
            <li key={item.href} className="@container flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                /* The count in words, as the badge is not read: in the name,
                   as text in the link would be read with a break in it. */
                aria-label={
                  badge === null
                    ? undefined
                    : `${item.label}, ${String(badge)} waiting for approval`
                }
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-caption font-semibold ${
                  active ? "text-primary" : "text-foreground"
                }`}
              >
                {/* On the icon, out of the flow, so it never makes the nav
                    taller, and there when the label is not. */}
                <span className="relative">
                  <NavIcon name={item.href} />
                  {badge === null ? null : (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 left-1/2 ml-1.5 min-w-5 rounded-full bg-danger px-1 text-center text-caption leading-5 font-semibold text-danger-foreground tabular-nums"
                    >
                      {badgeCount(badge)}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap @max-[68px]:sr-only">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
