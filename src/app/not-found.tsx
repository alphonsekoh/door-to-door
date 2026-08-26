import Link from "next/link";
import { PageHeader } from "@/components/page-header";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" subtitle="That page does not exist." />
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-body font-medium text-primary-foreground"
      >
        Back to session
      </Link>
    </>
  );
}
