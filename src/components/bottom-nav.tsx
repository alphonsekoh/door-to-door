"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/components/nav-icon";
import { isActiveRoute, visibleNavItems } from "@/lib/nav";
import { isPublicPath } from "@/server/auth/routes";
import { useRole } from "@/lib/use-role";

export function BottomNav() {
  const pathname = usePathname();
  const { isAdmin } = useRole();
  const items = visibleNavItems(isAdmin);

  /*
   * Nothing to navigate to on a public route, and rendering it there does
   * harm: each Link prefetches while signed out, the proxy answers with a
   * redirect to /sign-in, and the client router caches that. The push after a
   * successful sign-in then replays the cached redirect and the member is left
   * staring at the form they just completed.
   */
  if (isPublicPath(pathname)) {
    return null;
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 inset-safe-bottom backdrop-blur"
    >
      <ul className="mx-auto flex max-w-screen-sm">
        {items.map((item) => {
          const active = isActiveRoute(pathname, item);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-caption font-medium transition-colors ${
                  active ? "text-primary" : "text-foreground-muted"
                }`}
              >
                <NavIcon name={item.href} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
