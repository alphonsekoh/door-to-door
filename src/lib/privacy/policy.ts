/*
 * What the privacy policy quotes and its tests check (#273): the date, the
 * sections, the periods and the response times. The prose is in
 * src/components/privacy/privacy-policy.tsx. A compliance review that changes
 * a number changes it here, once.
 */

/* The operator as config.yaml names them: a person or a body. */
export type PrivacyContact = { organisation: string; dpoEmail: string };

/* Noon UTC, so no time zone moves the day it names. Change it with the text. */
export const POLICY_UPDATED = "2026-11-23T12:00:00Z";

export const POLICY_SECTION_IDS = [
  "who",
  "collected",
  "purposes",
  "consent",
  "access",
  "erasure",
  "retention",
  "protection",
  "transfers",
  "breach",
  "dnc",
  "contact",
  "changes",
] as const;

export type SectionId = (typeof POLICY_SECTION_IDS)[number];

export const POLICY_SECTIONS: readonly { id: SectionId; heading: string }[] = [
  { id: "who", heading: "Who we are" },
  { id: "collected", heading: "What we record" },
  { id: "purposes", heading: "Why we record it" },
  { id: "consent", heading: "Your consent" },
  { id: "access", heading: "Seeing or correcting your data" },
  { id: "erasure", heading: "Withdrawing consent or asking us to delete your data" },
  { id: "retention", heading: "How long we keep it" },
  { id: "protection", heading: "Keeping it accurate and safe" },
  { id: "transfers", heading: "Where it is processed" },
  { id: "breach", heading: "If something goes wrong" },
  { id: "dnc", heading: "Phone calls and messages" },
  { id: "contact", heading: "Contact us" },
  { id: "changes", heading: "Changes to this policy" },
];

/*
 * How far back Neon can restore the database, in hours: 6, the owner's figure
 * for the free tier's maximum (2026-11-23). Not read from the Neon console, so
 * recheck it if the plan changes. The policy quotes it as "up to" this long.
 */
export const RESTORE_WINDOW_HOURS = 6;

export const hours = (count: number): string =>
  `${String(count)} ${count === 1 ? "hour" : "hours"}`;

export const RETENTION: readonly { id: string; what: string; keep: string }[] = [
  {
    id: "households",
    what: "A household's name, contact, religion, and visit and follow-up notes (including removal reasons)",
    keep: "24 months after the last visit or follow-up activity at that household, then erased",
  },
  {
    id: "accounts",
    what: "A member's account",
    keep: "12 months after the member leaves, then deleted",
  },
  {
    id: "sign-ins",
    what: "Sign-in records and logs",
    keep: "30 days after the sign-in was last used",
  },
  {
    id: "attempts",
    what: "Counts of failed sign-in attempts",
    keep: "A few minutes, in memory only",
  },
  {
    id: "phones",
    what: "Copies on a member's phone",
    keep: "Records not yet sent, until they are sent; sent records for 24 hours or until that member signs out; the session's units for 12 hours or until sign-out. Unsent records are not dropped by signing out",
  },
];

export const RESPONSE_TIMES = {
  access: "30 days",
  withdrawal: "10 business days",
  erasure: "30 days",
  breachAssessment: "30 days",
  breachReport: "3 calendar days",
} as const;
