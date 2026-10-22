export type NavItem = {
  href: string;
  label: string;
  /* Matches nested routes so /history/123 keeps the History tab active. */
  matchPrefix: boolean;
  /* The section the tab stands for, where it is wider than the screen the
     tab opens: Admin opens on Sessions but is every /admin screen. */
  section?: string;
  /* Hidden from members. Affordance only - every handler re-checks the role,
     so this decides what is shown, never what is permitted. */
  adminOnly?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Session", matchPrefix: false },
  { href: "/history", label: "History", matchPrefix: true },
  { href: "/follow-ups", label: "Follow-ups", matchPrefix: true },
  {
    href: "/admin/sessions",
    label: "Admin",
    matchPrefix: true,
    section: "/admin",
    adminOnly: true,
  },
  { href: "/account", label: "Account", matchPrefix: true },
] as const;

export function visibleNavItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => item.adminOnly !== true || isAdmin);
}

export function isActiveRoute(pathname: string, item: NavItem): boolean {
  if (!item.matchPrefix) return pathname === item.href;
  const section = item.section ?? item.href;
  return pathname === section || pathname.startsWith(`${section}/`);
}
