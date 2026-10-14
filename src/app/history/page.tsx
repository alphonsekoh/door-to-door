import { Suspense } from "react";
import { OwnHistoryScreen } from "@/components/own-history";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Outings you have worked, newest first." />
      {/* useSearchParams (the Me / My team choice) needs a boundary, or the
          route opts out of static rendering at build time. */}
      <Suspense fallback={<p className="text-body text-foreground-muted">Loading…</p>}>
        <OwnHistoryScreen />
      </Suspense>
    </>
  );
}
