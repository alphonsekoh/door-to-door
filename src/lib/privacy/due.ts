import { ERASE_WITHIN_WEEKDAYS } from "@/lib/privacy/policy";

/*
 * When a request must be carried out by (#279): ten weekdays after it was
 * made, Monday to Friday in the device's time zone, holidays not skipped.
 * That is the stricter of the policy's two response times (10 business days
 * for withdrawing agreement, 30 days for erasure), so one date serves both.
 */
export function eraseBy(requestedAt: string | Date): Date {
  const due = new Date(requestedAt);
  let remaining = ERASE_WITHIN_WEEKDAYS;
  while (remaining > 0) {
    due.setDate(due.getDate() + 1);
    const day = due.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return due;
}

/* Overdue once the due day is over, not at the hour the request was logged. */
export function isErasureOverdue(due: Date, now: Date): boolean {
  const endOfDay = new Date(due);
  endOfDay.setHours(23, 59, 59, 999);
  return now > endOfDay;
}
