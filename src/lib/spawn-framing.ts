/**
 * Where a step opens, and which way the trainee is looking.
 *
 * `docs/16` phase 4. Every step used to open from one fixed point looking one
 * fixed way, so a `decide` step — which is a comparison of four things side by
 * side — and an `observe` step — which is one object somewhere on the far wall —
 * were framed the same way. One of those two is always wrong, and the wrong one
 * is invisible: the room renders, the labels are there, and the trainee is just
 * looking at a wall.
 *
 * So the spawn is *derived from the step*, not fixed:
 *
 *   decide / act — the options are laid on an arc, so the trainee stands at the
 *                  entry looking at the arc. The arc is the question.
 *   observe      — the object is against a wall, so the trainee stands back from
 *                  it, looking straight at it. The object is the question.
 *
 * This is data, not render code, for the same reason the equipment is data: a
 * test can check that the camera is never spawned inside a wall, and that what
 * the step asks about is always in front of the trainee.
 *
 * It cannot and does not change what is graded. Framing is where the camera
 * starts; `runner.ts` and `scoring.ts` are untouched, and a tap is still graded
 * by the id it hits.
 */

import { ENTRY, ROOM, type ScenerySolid, pushOutOfSolids } from "./environment";

export interface SpawnFrame {
  x: number;
  z: number;
  /** Radians. 0 faces -Z, into the room, because a Three.js camera looks down -Z. */
  yaw: number;
}

/** Horizontal field of view, matching `FOV_DEG` in `Scene3D`. */
const FOV_DEG = 78;

/**
 * How far back from the target an `observe` step stands.
 *
 * Far enough that the object and its neighbours are both in frame — a gas
 * monitor photographed from 1.5 m is a rectangle with no context, and the
 * distractors on the same step are the point of an observe step. Near enough
 * that the label has not faded out (`LABEL_NEAR` is 13 m).
 */
const STANDOFF = 5.5;

/** The wall margin the walker is clamped to, matching `WALL_MARGIN` in `Scene3D`. */
const WALL_MARGIN = 0.7;

/** Player radius, matching `BODY_R` in `Scene3D`. */
const BODY_R = 0.45;

/**
 * The frame for a step whose options are on the arc.
 *
 * The entry, facing into the room. The arc is placed relative to this point by
 * `arcSlot`, so the two have to agree — which is why this is a function of the
 * same `ENTRY` the renderer reads rather than a second literal.
 */
export function entryFrame(): SpawnFrame {
  return { x: ENTRY.x, z: ENTRY.z, yaw: 0 };
}

/**
 * The frame for a step about one object: stand back from it, facing it.
 *
 * The standoff direction is from the target towards the room centre, so the
 * trainee ends up between the middle of the bay and the thing they are looking
 * at, which is walkable floor in every corner of this room. It is then clamped
 * inside the walls and pushed out of any plant it landed in.
 */
export function observeFrame(
  anchor: { x: number; z: number },
  solids: readonly ScenerySolid[] = [],
  bodyRadius = BODY_R,
): SpawnFrame {
  const toCentreX = 0 - anchor.x;
  const toCentreZ = 0 - anchor.z;
  const len = Math.hypot(toCentreX, toCentreZ) || 1;
  // A target sitting on the room's own centre would have no direction to back
  // away from, so fall back to backing off along +Z, towards the entry.
  const ux = len < 0.5 ? 0 : toCentreX / len;
  const uz = len < 0.5 ? 1 : toCentreZ / len;

  const limitX = ROOM.width / 2 - WALL_MARGIN - bodyRadius;
  const limitZ = ROOM.depth / 2 - WALL_MARGIN - bodyRadius;
  const clampedX = Math.max(-limitX, Math.min(limitX, anchor.x + ux * STANDOFF));
  const clampedZ = Math.max(-limitZ, Math.min(limitZ, anchor.z + uz * STANDOFF));
  const clear = pushOutOfSolids(clampedX, clampedZ, bodyRadius, solids);

  return { x: clear.x, z: clear.z, yaw: yawTowards(clear.x, clear.z, anchor.x, anchor.z) };
}

/**
 * Yaw that looks from one point at another.
 *
 * A Three.js camera looks down its own -Z, so the forward vector at yaw is
 * `(-sin, -cos)`. This is the bug the room was born with: `Math.PI` was used
 * for "facing into the room", and it faces the near wall instead.
 */
export function yawTowards(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

/** Angle in radians between where the camera looks and a point, 0 when dead on. */
export function angleOffCentre(frame: SpawnFrame, point: { x: number; z: number }): number {
  const want = yawTowards(frame.x, frame.z, point.x, point.z);
  let delta = want - frame.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

/** Half the horizontal field of view, in radians. */
export const HALF_FOV = ((FOV_DEG / 2) * Math.PI) / 180;
