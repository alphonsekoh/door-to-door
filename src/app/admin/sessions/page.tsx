import { AdminSessions } from "@/components/admin-sessions";
import { OverdueFollowUps } from "@/components/overdue-follow-ups";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Sessions" };

export default async function AdminSessionsPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader title="Sessions" subtitle="Create, start, end and reopen." />
      {/* The admin landing page, so the place to see what is overdue. */}
      <div className="mb-4 empty:hidden">
        <OverdueFollowUps />
      </div>
      <AdminSessions />
    </>
  );
}
