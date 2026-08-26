import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Account" subtitle="Your profile and sign-in details." />
      <Placeholder issue={15}>
        Profile details, password change, and sign out.
      </Placeholder>
    </>
  );
}
