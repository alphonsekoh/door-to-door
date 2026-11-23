import Link from "next/link";

/*
 * No prefetch: from sign-in it would be a background auth request beside the
 * CSRF cookie (#150, #151). No config either, so Account stays static.
 */
export function PrivacyFooter() {
  return (
    <footer className="mt-8 border-t border-border pt-4">
      <Link
        href="/privacy"
        prefetch={false}
        className="inline-flex min-h-11 items-center text-body btn-text"
      >
        Privacy policy
      </Link>
    </footer>
  );
}
