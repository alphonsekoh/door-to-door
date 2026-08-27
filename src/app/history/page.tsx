import { OwnHistoryScreen } from "@/components/own-history";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Outings you have worked, newest first." />
      <OwnHistoryScreen />
    </>
  );
}
