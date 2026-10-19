import { SessionDetail } from "@/components/session-detail";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Outing" };

/* The heading is the outing's title, which SessionDetail loads. */
export default async function AdminSessionPage({ params }: PageProps<"/admin/sessions/[id]">) {
  await requireAdminPage();
  const { id } = await params;
  return <SessionDetail sessionId={id} />;
}
