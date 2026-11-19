/*
 * Like a browser, jsdom moves focus from a control that has become disabled
 * to the page at its next rendering update, which runs the animation frames
 * too (R-199). An attempt held past one frame loses focus every time, as a
 * real one does; an answer within a frame kept it, unless a busy runner drew
 * the answer late (#208).
 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}
