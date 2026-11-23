import { connection } from "next/server";
import { PrivacyPolicy } from "@/components/privacy/privacy-policy";
import { PageHeader } from "@/components/ui/page-header";
import { formatDay } from "@/lib/history/dates";
import { POLICY_UPDATED } from "@/lib/privacy/policy";
import { privacyContact } from "@/server/privacy/contact";

export const metadata = { title: "Privacy policy" };

/*
 * Rendered per request: who we are comes from config.yaml, which `next build`
 * never reads. Public, for the signed-out too (#273).
 */
export default async function PrivacyPage() {
  await connection();
  const contact = privacyContact();
  return (
    <>
      <PageHeader
        title="Privacy policy"
        subtitle={`Last updated ${formatDay(POLICY_UPDATED)}`}
        back={{ href: "/", label: "Back", retrace: true }}
      />
      <PrivacyPolicy contact={contact} />
    </>
  );
}
