import { WaitingScreen } from "@/components/account/waiting-screen";
import { PrivacyFooter } from "@/components/privacy/privacy-footer";
import { PageHeader } from "@/components/ui/page-header";
import { requireWaitingPage } from "@/server/auth/pages";

export const metadata = { title: "Approval" };

/*
 * Where an account nobody has approved is kept (#249), drawn from its row on
 * every load, so Check again shows an approval, a rejection or an unblock
 * the moment an admin makes it. An approved account is sent home.
 */
export default async function WaitingPage() {
  const account = await requireWaitingPage();
  return (
    <>
      <PageHeader
        title={
          account.approval === "blocked" ? "Your request wasn't approved" : "Waiting for approval"
        }
      />
      <WaitingScreen account={account} />
      <PrivacyFooter />
    </>
  );
}
