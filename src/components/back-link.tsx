"use client";

import Link from "next/link";
import { canRetrace } from "@/lib/screen-trail";

export type Back = {
  href: string;
  label: string;
  /* For a screen reached from several places: go back the way the member
     came, and use `href` when what is behind is not one of the app's own
     screens (a cold launch, a new tab, the sign-in form). */
  retrace?: boolean;
};

export function BackLink({ href, label, retrace = false }: Back) {
  /* At least 44px each way, the touch minimum, and no more than its content
     needs past that: in a narrow header it is the chevron alone, and every
     pixel it does not take is the title's. */
  return (
    <Link
      href={href}
      aria-label={retrace ? label : `Back to ${label}`}
      onClick={(event) => {
        if (retrace && canRetrace()) {
          event.preventDefault();
          window.history.back();
        }
      }}
      className="-ml-1 inline-flex min-h-11 min-w-[44px] items-center gap-1 pr-2 text-body font-medium btn-text"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {/* Only inside a narrow container (an inline PageHeader): the
          accessible name above still says where it goes. */}
      <span className="@max-[6.5rem]:sr-only">{label}</span>
    </Link>
  );
}
