import { PageHeader } from "@/components/page-header";
import { SessionDetail } from "@/components/session-detail";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Outing" };

export default async function AdminSessionPage({ params }: PageProps<"/admin/sessions/[id]">) {
  await requireAdminPage();
  const { id } = await params;
  return (
    <>
      <PageHeader title="Outing" subtitle="Blocks, progress and lifecycle." />
      <SessionDetail sessionId={id} />
    </>
  );
}
