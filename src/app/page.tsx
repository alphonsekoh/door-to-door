import { ActiveSessionScreen } from "@/components/active-session";
import { PageHeader } from "@/components/page-header";

export default function SessionPage() {
  return (
    <>
      <PageHeader title="Active session" subtitle="Pick a block to start recording." />
      <ActiveSessionScreen />
    </>
  );
}
