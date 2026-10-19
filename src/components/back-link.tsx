"use client";

import Link from "next/link";

export type Back = {
  href: string;
  label: string;
  /* For a screen reached from several places: go back the way the member
     came, and use `href` only when there is nowhere to go back to (a cold
     launch onto this address). */
  retrace?: boolean;
};

export function BackLink({ href, label, retrace = false }: Back) {
  return (
    <Link
      href={href}
      aria-label={retrace ? label : `Back to ${label}`}
      onClick={(event) => {
        if (retrace && window.history.length > 1) {
          event.preventDefault();
          window.history.back();
        }
      }}
      className="-ml-1 inline-flex min-h-11 items-center gap-1 pr-2 text-body font-medium btn-text"
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
      <span>{label}</span>
    </Link>
  );
}
