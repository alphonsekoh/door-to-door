import { AdminSessions } from "@/components/admin/admin-sessions";
import { OverdueFollowUps } from "@/components/follow-ups/overdue-follow-ups";
import { ReviewCountCard } from "@/components/follow-ups/review-count-card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Sessions" };

export default async function AdminSessionsPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader title="Sessions" subtitle="Create, start, end and reopen." />
      {/* The admin landing page, so the place to see what waits for a
          decision and what is overdue. Each hides itself when there is none. */}
      <div className="mb-4 space-y-3 empty:hidden">
        <ReviewCountCard />
        <OverdueFollowUps />
      </div>
      <AdminSessions />
    </>
  );
}
