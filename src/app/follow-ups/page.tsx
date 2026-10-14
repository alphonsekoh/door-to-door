import { Suspense } from "react";
import { FollowUpsScreen } from "@/components/follow-ups-screen";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Follow-ups" };

export default function FollowUpsPage() {
  return (
    <>
      <PageHeader title="Follow-ups" subtitle="Notes waiting on a return visit." />
      {/* useSearchParams needs a boundary, or the route opts out of static
          rendering at build time. */}
      <Suspense fallback={<p className="text-body text-foreground-muted">Loading…</p>}>
        <FollowUpsScreen />
      </Suspense>
    </>
  );
}
