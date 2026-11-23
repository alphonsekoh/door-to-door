import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PrivacyFooter } from "@/components/privacy/privacy-footer";
import { SignInForm } from "@/components/account/sign-in-form";
import { googleDomains } from "@/auth/google";

export const metadata = { title: "Sign in" };

/*
 * Rendered per request, not prerendered (#14): whether Google sign-in is set
 * up is in config.yaml, which `next build` never reads, and the button has to
 * be there in the first paint rather than shift the form under a thumb.
 */
export default async function SignInPage() {
  await connection();
  const domains = googleDomains();
  return (
    <>
      <PageHeader
        title="Sign in"
        subtitle={
          domains === null
            ? "Use the account your admin set up for you."
            : /* Anyone Google vouches for may ask to join (#249). */
              "New here? Sign in with Google, then an admin approves you."
        }
      />
      {/* useSearchParams needs a boundary. */}
      <Suspense fallback={null}>
        <SignInForm googleDomains={domains} />
      </Suspense>
      <PrivacyFooter />
    </>
  );
}
