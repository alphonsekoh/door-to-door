import { MemberDetail } from "@/components/admin/member-detail";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Member" };

/* The heading is the member's own name, which MemberDetail loads. */
export default async function AdminMemberPage({ params }: PageProps<"/admin/team/[id]">) {
  await requireAdminPage();
  const { id } = await params;
  return <MemberDetail userId={id} />;
}
