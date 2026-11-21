import { Suspense } from "react";
import { AttentionList } from "@/components/follow-ups/attention-list";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Needs a return visit" };

export default async function AdminAttentionPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="Needs a return visit"
        subtitle="Doors that showed interest and have nobody going back."
        back={{ href: "/admin/sessions", label: "Sessions" }}
      />
      {/* useSearchParams needs a boundary, or the route opts out of static
          rendering at build time. */}
      <Suspense fallback={<p className="text-body text-foreground-muted">Loading…</p>}>
        <AttentionList />
      </Suspense>
    </>
  );
}
