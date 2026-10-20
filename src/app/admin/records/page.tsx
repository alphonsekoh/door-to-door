import { Suspense } from "react";
import { AdminRecords } from "@/components/admin-records";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Records" };

export default async function AdminRecordsPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="Records"
        subtitle="Everything recorded on the running session."
        back={{ href: "/admin/sessions", label: "Sessions" }}
      />
      {/* useSearchParams needs a boundary, or the whole route opts out of
          static rendering at build time. */}
      <Suspense fallback={<p className="text-body text-foreground-muted">Loading…</p>}>
        <AdminRecords />
      </Suspense>
    </>
  );
}
