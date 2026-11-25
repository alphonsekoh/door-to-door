import { describe, expect, it } from "vitest";
import { eraseBy, isErasureOverdue } from "@/lib/privacy/due";

/* Built in local time, as the dates are shown: the device's own zone. */
const local = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour);
const day = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];

describe("eraseBy", () => {
  it("is ten weekdays on, so a Monday request is due on the Monday after next", () => {
    // Mon 2 Nov 2026 -> Mon 16 Nov 2026
    expect(day(eraseBy(local(2026, 11, 2)))).toEqual([2026, 11, 16]);
  });

  it("counts from a Friday over the weekend", () => {
    // Fri 6 Nov: the first weekday after is Mon 9 Nov, the tenth is Mon 23 Nov.
    expect(day(eraseBy(local(2026, 11, 6)))).toEqual([2026, 11, 20]);
  });

  it("starts a weekend request on the Monday after", () => {
    // Sat 7 Nov: Mon 9 is the first weekday, Fri 20 the tenth.
    expect(day(eraseBy(local(2026, 11, 7)))).toEqual([2026, 11, 20]);
    expect(day(eraseBy(local(2026, 11, 8)))).toEqual([2026, 11, 20]);
  });

  it("never lands on a weekend, and does not skip holidays", () => {
    for (let offset = 0; offset < 14; offset += 1) {
      const due = eraseBy(local(2026, 12, 20 + offset));
      expect([0, 6]).not.toContain(due.getDay());
    }
    // Christmas Day 2026 is a Friday, and counts as a weekday here.
    expect(day(eraseBy(local(2026, 12, 11)))).toEqual([2026, 12, 25]);
  });

  it("takes the instant the server sent as readily as a Date", () => {
    expect(eraseBy("2026-11-02T04:00:00.000Z").getTime()).toBeGreaterThan(
      new Date("2026-11-02T04:00:00.000Z").getTime(),
    );
  });
});

describe("isErasureOverdue", () => {
  it("is overdue once the due day is over, not on it", () => {
    const due = local(2026, 11, 16, 9);
    expect(isErasureOverdue(due, local(2026, 11, 16, 23))).toBe(false);
    expect(isErasureOverdue(due, local(2026, 11, 17, 0))).toBe(true);
    expect(isErasureOverdue(due, local(2026, 11, 10))).toBe(false);
  });
});
