import type { ReactNode } from "react";
import { requireAdminPage } from "@/server/auth/pages";

/*
 * Structural guard for the admin area. A layout is not re-run on client-side
 * navigation between its pages, so each page still calls requireAdminPage
 * itself; this covers any page added without remembering to.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return children;
}
