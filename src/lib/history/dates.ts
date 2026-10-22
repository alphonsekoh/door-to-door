/*
 * Every date the app shows, in one style on every screen and every browser:
 * "3 Mar 2026", day first as dates are written where the app is used, in the
 * phone's own time zone. A household's history once showed "Due 15 Jul 2026"
 * beside "3/14/2026".
 */
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });

type Instant = string | number | Date;

export function formatDay(instant: Instant): string {
  return DAY.format(new Date(instant));
}

/* "19 Oct 2026 at 3:38 pm" */
export function formatDayTime(instant: Instant): string {
  const date = new Date(instant);
  return `${DAY.format(date)} at ${TIME.format(date)}`;
}
