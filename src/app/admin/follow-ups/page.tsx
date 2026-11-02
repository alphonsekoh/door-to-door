import { Suspense } from "react";
import { AdminFollowUps } from "@/components/admin/admin-follow-ups";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Follow-up list" };

export default async function AdminFollowUpsPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="Follow-up list"
        subtitle="Review suggestions and choose which households to revisit."
        back={{ href: "/admin/sessions", label: "Sessions" }}
      />
      {/* useSearchParams needs a boundary, or the route opts out of static
          rendering at build time. */}
      <Suspense fallback={<p className="text-body text-foreground-muted">Loading…</p>}>
        <AdminFollowUps />
      </Suspense>
    </>
  );
}
