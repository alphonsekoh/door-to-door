import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/placeholder";

export default function SessionPage() {
  return (
    <>
      <PageHeader
        title="Active session"
        subtitle="Pick a block to start recording."
      />
      <Placeholder issue={24}>
        The active session and its blocks, with live unit counts.
      </Placeholder>
    </>
  );
}
