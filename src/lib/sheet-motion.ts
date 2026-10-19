/*
 * The physics behind a bottom sheet you can drag, kept free of React and of
 * the animation library so every rule here can be checked with numbers.
 *
 * Values follow Apple's Designing Fluid Interfaces: critically damped springs
 * by default, a little bounce only after a flick, momentum projected with the
 * same deceleration a scroll view uses, and soft resistance past an edge.
 */

/* A scroll view's normal deceleration rate, per millisecond. */
export const DECELERATION = 0.998;

/* Movement before a press on the handle becomes a drag, so a tap on Cancel
   in the header stays a tap. */
export const DRAG_THRESHOLD = 10;

/* px/s. Faster than this, the direction of the throw decides on its own. */
export const FLICK_VELOCITY = 500;

/* Share of the sheet's height the projected end must pass to dismiss. */
export const DISMISS_FRACTION = 0.4;

/* Only the last moments of a drag say how fast it was let go. */
const VELOCITY_WINDOW_MS = 100;

/* Where a throw at this velocity (px/s) comes to rest, relative to now. */
export function project(velocity: number, rate: number = DECELERATION): number {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/* Past an edge the sheet follows less the further it is pulled. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/* The sheet's offset in px. Mid-entrance it can still be the percentage it
   rose from, which a drag grabbing it then has to start from. */
export function toPx(value: number | string, height: number): number {
  if (typeof value === "number") return value;
  const amount = Number.parseFloat(value);
  return value.endsWith("%") ? (amount / 100) * height : amount;
}

export type Sample = { y: number; t: number };

/* px/s over the last few samples; zero once the finger has come to rest. */
export function releaseVelocity(samples: readonly Sample[]): number {
  const last = samples.at(-1);
  if (last === undefined) return 0;
  let first = last;
  for (const sample of samples) {
    if (last.t - sample.t <= VELOCITY_WINDOW_MS) {
      first = sample;
      break;
    }
  }
  const elapsed = last.t - first.t;
  return elapsed === 0 ? 0 : ((last.y - first.y) / elapsed) * 1000;
}

/*
 * Dismiss or settle back. A clear throw decides by its direction alone;
 * otherwise the sheet goes if where it would come to rest is far enough
 * down. Offsets and velocities are positive downwards.
 */
export function shouldDismiss(offset: number, velocity: number, height: number): boolean {
  if (velocity <= -FLICK_VELOCITY) return false;
  if (velocity >= FLICK_VELOCITY) return true;
  return offset + project(velocity) > height * DISMISS_FRACTION;
}

export type Spring = {
  type: "spring";
  bounce: number;
  visualDuration: number;
  velocity?: number;
};

/* Opening, closing and anything not thrown: no overshoot. */
export const SHEET_SPRING: Spring = { type: "spring", bounce: 0, visualDuration: 0.35 };

/* Back to rest after a drag, carrying the finger's velocity. Only a throw
   earns a bounce. */
export function settleSpring(velocity: number): Spring {
  return {
    type: "spring",
    bounce: Math.abs(velocity) >= FLICK_VELOCITY ? 0.15 : 0,
    visualDuration: 0.3,
    velocity,
  };
}

/* Reduced motion: a short cross-fade instead of travel. */
export const FADE = { duration: 0.15, ease: "easeOut" } as const;
