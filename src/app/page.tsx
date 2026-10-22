import { ActiveSessionScreen } from "@/components/sessions/active-session";
import { PageHeader } from "@/components/ui/page-header";

export default function SessionPage() {
  return (
    <>
      <PageHeader title="Active session" subtitle="Pick a block to start recording." />
      <ActiveSessionScreen />
    </>
  );
}
