import { Suspense } from "react";
import { HISTORY_SUBTITLE, OwnHistoryScreen } from "@/components/own-history";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "History" };

export default function HistoryPage() {
  return (
    /* The header lives in the screen, whose subtitle follows Me / My team.
       useSearchParams needs a boundary, or the route opts out of static
       rendering at build time. */
    <Suspense
      fallback={
        <>
          <PageHeader title="History" subtitle={HISTORY_SUBTITLE.me} />
          <p className="text-body text-foreground-muted">Loading…</p>
        </>
      }
    >
      <OwnHistoryScreen />
    </Suspense>
  );
}
