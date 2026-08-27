import { AttentionList } from "@/components/attention-list";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/server/auth/pages";

export const metadata = { title: "Needs a return visit" };

export default async function AdminAttentionPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="Needs a return visit"
        subtitle="Doors that showed interest and have nobody going back."
      />
      <AttentionList />
    </>
  );
}
