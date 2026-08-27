import { AdminSessions } from "@/components/admin-sessions";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Outings" };

export default async function AdminSessionsPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader title="Outings" subtitle="Create, start, end and reopen." />
      <AdminSessions />
    </>
  );
}
