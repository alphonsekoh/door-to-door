import { describe, expect, it } from "vitest";
import { formatDay, formatDayTime } from "@/lib/history/dates";

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe("formatDay", () => {
  it("writes the day first with a short month, whatever the device locale", () => {
    expect(formatDay(local(2026, 10, 14).toISOString())).toBe("14 Oct 2026");
    expect(formatDay(local(2026, 3, 3).getTime())).toBe("3 Mar 2026");
    expect(formatDay(local(2026, 7, 15))).toBe("15 Jul 2026");
  });
});

describe("formatDayTime", () => {
  it("adds the time on the same day, in twelve-hour time", () => {
    expect(formatDayTime(local(2026, 10, 19, 15, 38))).toBe("19 Oct 2026 at 3:38 pm");
    expect(formatDayTime(local(2026, 10, 19, 9, 5).getTime())).toBe("19 Oct 2026 at 9:05 am");
  });
});
