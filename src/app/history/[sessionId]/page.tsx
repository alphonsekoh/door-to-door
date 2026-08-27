import { PageHeader } from "@/components/page-header";
import { SessionRecords } from "@/components/session-records";

export const metadata = { title: "Outing records" };

export default async function SessionHistoryPage({ params }: PageProps<"/history/[sessionId]">) {
  const { sessionId } = await params;
  return (
    <>
      <PageHeader title="Your records" subtitle="Everything you recorded on this outing." />
      <SessionRecords sessionId={sessionId} />
    </>
  );
}
