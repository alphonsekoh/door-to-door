import { describe, expect, it } from "vitest";
import { dayInput, requestedAtFor } from "@/lib/privacy/requested";

const now = new Date(2026, 10, 5, 9, 30);

describe("dayInput", () => {
  it("is the day on the device's calendar, as a date input holds it", () => {
    expect(dayInput(now)).toBe("2026-11-05");
    expect(dayInput(new Date(2026, 0, 3, 23, 59))).toBe("2026-01-03");
  });
});

describe("requestedAtFor", () => {
  it("sends today as nothing, so the server's clock says when", () => {
    expect(requestedAtFor("2026-11-05", now)).toBeUndefined();
  });

  it("sends an earlier day as noon that day", () => {
    expect(requestedAtFor("2026-11-01", now)).toBe(new Date(2026, 10, 1, 12).toISOString());
  });

  it("is null for a field holding no day", () => {
    expect(requestedAtFor("", now)).toBeNull();
    expect(requestedAtFor("5 Nov", now)).toBeNull();
  });
});
