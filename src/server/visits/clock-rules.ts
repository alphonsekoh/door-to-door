import {
  approximateMinutes,
  checkNotAhead,
  checkNotBefore,
  checkWithinTolerance,
  type Clock,
} from "@/lib/clock";
import { getConfig } from "@/server/config";
import { ClockSkewError } from "@/server/http/errors";

/* Read per call, never at module scope: next build has no config file (D-13-4). */
export function currentClock(): Clock {
  return {
    now: new Date(),
    toleranceMs: getConfig().sync.clockSkewToleranceSeconds * 1000,
  };
}

/* Nothing the server stores may be from the future. */
export function assertNotInFuture(instant: Date, clock: Clock): void {
  const violation = checkNotAhead(instant, clock);
  if (violation) {
    throw new ClockSkewError(
      `This record is dated about ${String(approximateMinutes(violation.differenceMs))} minutes ahead of the server. Check the phone's clock.`,
    );
  }
}

/* A record cannot predate the outing it claims to belong to. */
export function assertNotBeforeOuting(instant: Date, startedAt: Date, clock: Clock): void {
  const violation = checkNotBefore(instant, startedAt, clock);
  if (violation) {
    throw new ClockSkewError(
      `This record is dated about ${String(approximateMinutes(violation.differenceMs))} minutes before its session began. Check the phone's clock.`,
    );
  }
}

/* The whole batch is refused, so nothing is half-applied. */
export function assertBatchClockSane(sentAt: Date, clock: Clock): void {
  const violation = checkWithinTolerance(sentAt, clock);
  if (violation) {
    const minutes = approximateMinutes(violation.differenceMs);
    throw new ClockSkewError(
      `The phone's clock is about ${String(minutes)} minutes ${violation.kind === "ahead" ? "ahead of" : "behind"} the server. Correct it and try again.`,
    );
  }
}
