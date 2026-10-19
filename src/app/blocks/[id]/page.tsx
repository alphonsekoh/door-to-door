import { BlockScreen } from "@/components/block-screen";

export const metadata = { title: "Record a visit" };

/* The heading is the block's own name, which the screen learns with the
   outing; see BlockScreen. */
export default async function BlockPage({ params }: PageProps<"/blocks/[id]">) {
  const { id } = await params;
  return <BlockScreen blockId={id} />;
}
