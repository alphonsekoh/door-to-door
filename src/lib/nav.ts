export type NavItem = {
  href: string;
  label: string;
  /* Matches nested routes so /history/123 keeps the History tab active. */
  matchPrefix: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Session", matchPrefix: false },
  { href: "/history", label: "History", matchPrefix: true },
  { href: "/follow-ups", label: "Follow-ups", matchPrefix: true },
  { href: "/account", label: "Account", matchPrefix: true },
] as const;

export function isActiveRoute(pathname: string, item: NavItem): boolean {
  if (!item.matchPrefix) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
