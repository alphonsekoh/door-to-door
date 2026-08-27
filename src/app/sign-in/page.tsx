import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { SignInForm } from "@/components/sign-in-form";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <PageHeader title="Sign in" subtitle="Use the account your admin set up for you." />
      {/* useSearchParams needs a boundary, or the whole route opts out of prerendering. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </>
  );
}
