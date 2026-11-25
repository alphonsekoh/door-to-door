/*
 * The date a person asked to be erased, as the sheet takes it (#279): a day
 * on the member's own calendar, today unless they say otherwise, since a
 * request heard at a door last week is logged this week.
 */
const pad = (value: number) => String(value).padStart(2, "0");

/* `YYYY-MM-DD` in the device's time zone, what a date input holds. */
export function dayInput(now: Date): string {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/*
 * Today is sent as nothing, so the server's clock says when; an earlier day
 * is noon that day, which no zone moves to another date. Null when the field
 * holds no day.
 */
export function requestedAtFor(day: string, now: Date): string | undefined | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (day === dayInput(now)) return undefined;
  return new Date(`${day}T12:00:00`).toISOString();
}
