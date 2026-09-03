/**
 * The arithmetic every module in here was writing out for itself.
 *
 * `smoothstep` had three identical copies, `mix` two, and wrapping an angle to
 * its shortest equivalent had *four* — under three different names, in two
 * different units, one of them inline. That last one is not tidiness. A function
 * called `shortestAngle` took degrees in one module and radians in another, and
 * the accessor that fed the radian version was read as degrees by a caller that
 * had the degree version in scope: act 4 threw the reader 110 degrees across the
 * frame once per loop and it took a numeric bisect to find.
 *
 * So the unit is in the name here, and there is nowhere else to define it.
 */

/** @returns {number} `value` held between `min` and `max` */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Linear interpolation. */
export function mix(a, b, t) {
  return a + (b - a) * t;
}

/** The classic 3t²−2t³ ease, clamped to 0…1 at both ends. */
export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * `t` mapped from the window `from`…`to` onto 0…1, eased.
 *
 * The scene is a sequence of things arriving and leaving, and each of those is a
 * window on the storyboard rather than a moment — so this, rather than a
 * comparison, is what nearly every visibility in the scene is written with.
 */
export function easeIn(t, from, to) {
  return smoothstep((t - from) / (to - from));
}

/**
 * A difference between two bearings, taken the short way round.
 *
 * @param {number} delta degrees
 * @returns {number} the same rotation expressed within ±180°
 */
export function shortestDegrees(delta) {
  return ((((delta + 180) % 360) + 360) % 360) - 180;
}

/**
 * A difference between two bearings, taken the short way round.
 *
 * @param {number} delta radians
 * @returns {number} the same rotation expressed within ±π
 */
export function shortestRadians(delta) {
  const turn = Math.PI * 2;
  return ((((delta + Math.PI) % turn) + turn) % turn) - Math.PI;
}
