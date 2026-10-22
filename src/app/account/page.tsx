import { AccountScreen } from "@/components/account/account-screen";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Account" subtitle="Your name and sign-in details." />
      <AccountScreen />
    </>
  );
}
