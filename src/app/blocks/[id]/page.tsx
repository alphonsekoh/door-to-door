import { BlockScreen } from "@/components/block-screen";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Record a visit" };

export default async function BlockPage({ params }: PageProps<"/blocks/[id]">) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Record a visit" subtitle="One unit at a time." />
      <BlockScreen blockId={id} />
    </>
  );
}
