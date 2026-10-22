import { SessionDetail } from "@/components/sessions/session-detail";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Session" };

/* The heading is the session's own title, which SessionDetail loads. */
export default async function AdminSessionPage({ params }: PageProps<"/admin/sessions/[id]">) {
  await requireAdminPage();
  const { id } = await params;
  return <SessionDetail sessionId={id} />;
}
