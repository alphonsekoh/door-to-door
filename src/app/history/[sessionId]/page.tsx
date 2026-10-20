import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { SessionRecords } from "@/components/session-records";

export const metadata = { title: "Session records" };

export default async function SessionHistoryPage({ params }: PageProps<"/history/[sessionId]">) {
  const { sessionId } = await params;
  return (
    <>
      <PageHeader
        title="Session records"
        subtitle="What you, or your team, recorded on this session."
        back={{ href: "/history", label: "History" }}
      />
      {/* useSearchParams (the Me / My team choice) needs a boundary. */}
      <Suspense fallback={<p className="text-body text-foreground-muted">Loading…</p>}>
        <SessionRecords sessionId={sessionId} />
      </Suspense>
    </>
  );
}
