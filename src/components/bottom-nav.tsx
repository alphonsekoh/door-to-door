"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/components/nav-icon";
import { NAV_ITEMS, isActiveRoute } from "@/lib/nav";

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur inset-safe-bottom"
    >
      <ul className="mx-auto flex max-w-screen-sm">
        {NAV_ITEMS.map((item) => {
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
