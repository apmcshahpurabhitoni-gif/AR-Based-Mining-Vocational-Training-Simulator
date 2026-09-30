/**
 * The rules the controls obey, kept out of the render loop.
 *
 * `docs/16` phase 5. Three of the six control gaps are arithmetic, not layout:
 * a thumbstick's deadzone, what counts as "I have arrived", and whether the
 * device has asked for less motion. All three are pure functions here so a test
 * can check them, because each one fails silently — a jittery stick that drifts
 * the trainee into a wall, or a room that ignores `prefers-reduced-motion`, is
 * not an error anybody reports, it is just an app that feels wrong.
 *
 * The layout half of phase 5 — one thumb bar instead of two corner clusters — is
 * in `Scene3D`, where the bar is.
 */

/**
 * Below this, a stick is not being pushed.
 *
 * A resting stick reads 0.02 to 0.08 on most pads, and the browser reports that
 * every frame. Without a deadzone the trainee walks into the conveyor while
 * trying to look at it. 0.18 is above the resting noise of the pads this gets
 * demoed on and below the travel of a real thumb.
 */
export const DEADZONE = 0.18;

/**
 * A stick, as a direction with a magnitude in 0..1.
 *
 * Rescaled rather than merely zeroed below the deadzone, so the first push off
 * centre is *slow* rather than instantly full speed. And the length is clamped,
 * because a stick pushed diagonally reports (1, 1) and an unclamped vector is
 * √2 times as long — which reads as the trainee sprinting whenever they walk at
 * an angle, and it is the single most common gamepad movement bug.
 */
export function stickVector(
  x: number,
  y: number,
  deadzone = DEADZONE,
): { x: number; y: number } {
  // A pad that reports NaN once — which happens on a bluetooth reconnect —
  // would otherwise put NaN into the camera position and the room would vanish
  // with no error anywhere. Centred is the only safe reading.
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  // Clamped rather than trusted: a caller passing 0 would divide by zero in the
  // rescale below, and a deadzone of 1 would never move at all.
  const floor = Math.max(0, Math.min(0.99, deadzone));
  if (len < floor) return { x: 0, y: 0 };
  const scale = Math.min(1, (len - floor) / (1 - floor)) / len;
  return { x: x * scale, y: y * scale };
}

/**
 * Look input from the right stick: a turn rate in -1..1 for yaw.
 *
 * The left stick moves the trainee camera-relative, so it turns the body by
 * walking. The right stick turns the view without moving, which is how a person
 * looks at the far wall of a 26 m room without walking to it.
 */
export function lookYaw(rx: number, deadzone = DEADZONE): number {
  return stickVector(rx, 0, deadzone).x;
}

/**
 * Pitch rate from the right stick's vertical axis, in -1..1.
 *
 * Separate from yaw because the caller has to clamp it: a stick that keeps
 * pushing past the pitch limit leaves the view stuck at the ceiling until the
 * stick is centred again, which is disorienting in a way that turning is not.
 */
export function lookPitch(ry: number, deadzone = DEADZONE): number {
  return stickVector(0, ry, deadzone).y;
}

/**
 * How close counts as having arrived.
 *
 * A room this size needs to acknowledge arrival: nothing else tells a trainee
 * that they have walked up to something, so in a 26 m bay the difference between
 * "at the object" and "near it" is invisible. 2.2 m is about arm's length plus
 * the width of the thing, which is where you would actually be standing to use
 * it.
 */
export const REACH_RADIUS = 2.2;

/** True when the trainee is close enough to something to be "at" it. */
export const reached = (distance: number): boolean => distance <= REACH_RADIUS;

/** Minimal shape of `window.matchMedia`, so tests can pass a fake. */
export interface MediaQueryLike {
  matchMedia: (query: string) => { matches: boolean };
}

/**
 * Has the device asked for less motion?
 *
 * Not decoration. This is a training room with a camera that a person moves
 * through, and the guidance for motion sensitivity is that movement triggered by
 * the *user* is fine while movement the app initiates is not. So: no camera bob,
 * no auto-turn, no easing on the view. Injected rather than read from `window` so
 * the answer is testable and the call site stays one line.
 */
export function prefersReducedMotion(win?: MediaQueryLike | null): boolean {
  // No window means no camera either, so this cannot matter at runtime — but the
  // default is still the safe one, so a caller that gets this wrong in a future
  // surface gets less motion rather than more.
  if (!win) return true;
  try {
    return win?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    // An old WebView, or a browser that throws on the query. Reduced motion is
    // the safe default to fail into: less movement cannot cause a fall.
    return true;
  }
}

/**
 * Is this a touch-first device?
 *
 * Screen size is not the signal — a 1280x800 laptop window is a very common
 * resolution and treating it as a phone cost a desktop its MSAA once already.
 * Touch is the reliable answer, and it is why the on-screen controls exist at
 * all.
 */
export function isTouchPrimary(win?: MediaQueryLike | null): boolean {
  try {
    return win?.matchMedia("(pointer: coarse)").matches ?? false;
  } catch {
    return false;
  }
}

/** The gamepad buttons this room uses, by index, so the mapping is one table. */
export const BUTTON_ANSWER = 0; // A / cross — answer whatever the crosshair is on
export const BUTTON_HOME = 3; // Y / triangle — back to the entry
export const BUTTON_MAP = 8; // Select / view — the bay map
