import { Suspense } from "react";
import { ConsolidatedHistory } from "@/components/consolidated-history";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "All records" };

export default async function AdminHistoryPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="All records"
        subtitle="Every visit, across every session."
        back={{ href: "/admin/sessions", label: "Sessions" }}
      />
      {/* useSearchParams needs a boundary, or the route opts out of static
          rendering at build time. */}
      <Suspense fallback={<p className="text-body text-foreground-muted">Loading…</p>}>
        <ConsolidatedHistory />
      </Suspense>
    </>
  );
}
