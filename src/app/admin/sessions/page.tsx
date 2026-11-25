import { AdminSessions } from "@/components/admin/admin-sessions";
import { ApprovalCountCard } from "@/components/admin/approval-count-card";
import { ErasureCountCard } from "@/components/admin/erasure-count-card";
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
          decision and what is overdue, under New session. Each hides itself
          when there is none. */}
      <AdminSessions
        notices={
          <div className="space-y-3 empty:hidden">
            <ApprovalCountCard />
            <ErasureCountCard />
            <ReviewCountCard />
            <OverdueFollowUps />
          </div>
        }
      />
    </>
  );
}
