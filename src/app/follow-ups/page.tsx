import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "Follow-ups" };

export default function FollowUpsPage() {
  return (
    <>
      <PageHeader title="Follow-ups" subtitle="Notes waiting on a return visit." />
      <Placeholder issue={35}>
        Outstanding and resolved follow-up notes, sorted by due date.
      </Placeholder>
    </>
  );
}
