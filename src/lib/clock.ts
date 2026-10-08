/*
 * Clock bounds for client-supplied timestamps. A phone's clock can be wrong or
 * tampered with, so the server only checks what it can verify itself: values
 * against its own clock and against the outing they claim to belong to.
 */

export type Clock = { now: Date; toleranceMs: number };

export type ClockViolation = { kind: "ahead" | "behind"; differenceMs: number };

/* Rounded up so a violation never reads as "0 minutes". */
export function approximateMinutes(differenceMs: number): number {
  return Math.max(1, Math.ceil(Math.abs(differenceMs) / 60_000));
}

/* Exactly at the tolerance is accepted; only beyond it is a violation. */
export function checkNotAhead(instant: Date, clock: Clock): ClockViolation | null {
  const differenceMs = instant.getTime() - clock.now.getTime();
  return differenceMs > clock.toleranceMs ? { kind: "ahead", differenceMs } : null;
}

export function checkNotBefore(instant: Date, floor: Date, clock: Clock): ClockViolation | null {
  const differenceMs = floor.getTime() - instant.getTime();
  return differenceMs > clock.toleranceMs ? { kind: "behind", differenceMs } : null;
}

export function checkWithinTolerance(instant: Date, clock: Clock): ClockViolation | null {
  const differenceMs = instant.getTime() - clock.now.getTime();
  if (Math.abs(differenceMs) <= clock.toleranceMs) return null;
  return { kind: differenceMs > 0 ? "ahead" : "behind", differenceMs };
}
