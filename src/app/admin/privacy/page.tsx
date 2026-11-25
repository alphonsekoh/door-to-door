import { ErasureRequests } from "@/components/admin/erasure-requests";
import { PageHeader } from "@/components/ui/page-header";
import { WholeWords } from "@/components/ui/unit-number";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Erasure requests" };

export default async function AdminPrivacyPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title={<WholeWords text="Erasure requests" />}
        subtitle="Carry out requests to delete a household's or a member's data."
        back={{ href: "/admin/sessions", label: "Sessions" }}
      />
      <ErasureRequests />
    </>
  );
}
