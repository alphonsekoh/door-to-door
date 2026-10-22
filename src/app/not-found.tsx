import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" subtitle="That page does not exist." />
      <Link
        href="/"
        className="inline-flex min-h-11 btn-primary items-center rounded-lg px-4 text-body font-medium"
      >
        Back to session
      </Link>
    </>
  );
}
