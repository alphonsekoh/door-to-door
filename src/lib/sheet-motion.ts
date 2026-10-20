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

/* The inverse: how far a pull past the edge went, to draw it `shown` px out. */
export function unrubberband(shown: number, dimension: number, constant = 0.55): number {
  return (shown * dimension) / (constant * (dimension - Math.abs(shown)));
}

/*
 * Where the sheet is drawn for a finger that has moved it `offset` px from
 * rest. Above its resting place it always resists. One holding unsaved work
 * resists going down as well, so it can be tugged but not thrown away.
 */
export function resist(offset: number, height: number, down: boolean): number {
  if (offset < 0) return -rubberband(-offset, height);
  return down ? rubberband(offset, height) : offset;
}

/* The finger's offset that draws the sheet at `shown`. A drag that takes
   hold of a sheet still springing back starts from here, so it does not
   jump under the finger. */
export function unresist(shown: number, height: number, down: boolean): number {
  if (shown < 0) return -unrubberband(-shown, height);
  return down ? unrubberband(shown, height) : shown;
}

/*
 * How dim the scrim is, from 1 to 0, with the sheet `offset` down from rest.
 * It lightens as the sheet is pulled away and darkens as it rises, so it
 * follows the sheet rather than fading on a clock of its own.
 */
export function scrimOpacity(offset: number | string, height: number): number {
  const down =
    typeof offset === "string" && offset.endsWith("%")
      ? Number.parseFloat(offset) / 100
      : toPx(offset, height) / height;
  // At rest before the panel is measured, 0 / 0: fully dim.
  return Math.min(1, Math.max(0, 1 - (down || 0)));
}

/* The sheet's offset in px. Mid-entrance it can still be the percentage it
   rose from, which a drag grabbing it then has to start from. */
export function toPx(value: number | string, height: number): number {
  if (typeof value === "number") return value;
  const amount = Number.parseFloat(value);
  return value.endsWith("%") ? (amount / 100) * height : amount;
}

export type Sample = { y: number; t: number };

/*
 * px/s over the last moments before the finger lifted at `at`. A finger held
 * still sends no moves, so the window is measured back from the release
 * rather than from the last move: a drag that stopped before it was let go
 * was let go at rest, however fast it moved earlier.
 */
export function releaseVelocity(samples: readonly Sample[], at: number): number {
  const last = samples.at(-1);
  const first = samples.find((sample) => at - sample.t <= VELOCITY_WINDOW_MS);
  if (last === undefined || first === undefined) return 0;
  const elapsed = at - first.t;
  return elapsed <= 0 ? 0 : ((last.y - first.y) / elapsed) * 1000;
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

/*
 * Springs in Motion's physical terms. Motion drops the starting velocity of a
 * spring given by duration or bounce, so every spring here is built from
 * Apple's two numbers instead: the damping ratio (1 settles without
 * overshoot) and the response, the time in seconds of one undamped swing.
 */
export type Spring = {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: 1;
  velocity: number;
};

export function spring(dampingRatio: number, response: number, velocity = 0): Spring {
  const stiffness = ((2 * Math.PI) / response) ** 2;
  return {
    type: "spring",
    stiffness,
    damping: 2 * dampingRatio * Math.sqrt(stiffness),
    mass: 1,
    velocity,
  };
}

/* Opening, and closing from rest: no overshoot. */
export const SHEET_SPRING: Spring = spring(1, 0.42);

/* Away after a drag let go far or fast enough, at the finger's speed, so
   the sheet does not stall under it and then set off from rest. */
export function throwSpring(velocity: number): Spring {
  return spring(1, 0.42, velocity);
}

/* Back to rest after a drag, carrying the finger's velocity. Only a throw
   earns a bounce. */
export function settleSpring(velocity: number): Spring {
  return spring(Math.abs(velocity) >= FLICK_VELOCITY ? 0.85 : 1, 0.36, velocity);
}

/* Reduced motion: a short cross-fade instead of travel. */
export const FADE = { duration: 0.15, ease: "easeOut" } as const;
