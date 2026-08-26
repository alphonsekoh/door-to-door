import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Sessions and units you have recorded." />
      <Placeholder issue={27}>
        Past sessions, the blocks worked, and each unit&rsquo;s full timeline.
      </Placeholder>
    </>
  );
}
