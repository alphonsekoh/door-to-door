import { BlockScreen } from "@/components/blocks/block-screen";

export const metadata = { title: "Record a visit" };

/* The heading is the block's own name, which the screen learns with the
   session; see BlockScreen. */
export default async function BlockPage({ params, searchParams }: PageProps<"/blocks/[id]">) {
  const { id } = await params;
  /* A household tapped on the follow-up list arrives with its unit filled in. */
  const { unit } = await searchParams;
  return <BlockScreen blockId={id} initialUnit={typeof unit === "string" ? unit : ""} />;
}
