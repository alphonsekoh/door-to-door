import { MemberList } from "@/components/admin/member-list";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Team" };

export default async function AdminTeamPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who can sign in, and what they can do."
        back={{ href: "/admin/sessions", label: "Sessions" }}
      />
      <MemberList />
    </>
  );
}
