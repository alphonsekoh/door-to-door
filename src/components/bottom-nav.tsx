"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/components/nav-icon";
import { isActiveRoute, visibleNavItems } from "@/lib/nav";
import { useShellState } from "@/lib/offline/shell-state";
import { isPublicPath } from "@/server/auth/routes";
import { useRole } from "@/lib/use-role";

export function BottomNav() {
  const pathname = usePathname();
  const { isAdmin } = useRole();
  const items = visibleNavItems(isAdmin);
  const shell = useShellState();

  /*
   * Nothing to navigate to on a public route, and rendering it there does
   * harm: each Link prefetches while signed out, the proxy answers with a
   * redirect to /sign-in, and the client router caches that. The push after a
   * successful sign-in then replays the cached redirect and the member is left
   * staring at the form they just completed.
   */
  /* On the offline shell every link would be a cold reload, offline, back
     into the shell, losing the form on the way (D-77-12). */
  if (isPublicPath(pathname) || shell.active) {
    return null;
  }

  /*
   * Glass, exactly --nav-height tall, so the Save bar docked on it meets it
   * edge to edge with nothing showing through between. When one is docked
   * the two read as one slab and the nav drops its own lit edge.
   *
   * Labels never wrap. Where a tab is too narrow for its label in the
   * current text size, the label is kept for screen readers only.
   */
  return (
    <nav
      aria-label="Primary"
      className="material-chrome fixed inset-x-0 bottom-0 z-40 inset-safe-bottom [body:has([data-docked])_&]:shadow-none"
    >
      <ul className="mx-auto flex h-(--nav-height) max-w-screen-sm">
        {items.map((item) => {
          const active = isActiveRoute(pathname, item);
          return (
            <li key={item.href} className="@container flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-caption font-semibold ${
                  active ? "text-primary" : "text-foreground"
                }`}
              >
                <NavIcon name={item.href} />
                <span className="whitespace-nowrap @max-[4.25rem]:sr-only">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
