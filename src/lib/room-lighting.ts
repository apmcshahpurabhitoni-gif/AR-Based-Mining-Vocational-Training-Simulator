/**
 * Baked lighting for the bay.
 *
 * Phase 2 of `docs/16-3d-environment-and-controls-plan.md`.
 *
 * The room was lit by one ambient light at a constant level, and that is the
 * whole reason it read flat: a light with no falloff and no direction puts the
 * same amount of illumination on the middle of the floor and on the inside of
 * a corner, so nothing has a dark side and nothing has a shape. Lowering the
 * ambient fixed the modelling and made the room dim, which is not the same
 * problem solved.
 *
 * The two things a mine bay is actually missing are occlusion and a ceiling.
 * Both are handled here, and both are handled by *baking* rather than by
 * adding lights:
 *
 *   Occlusion is a vertex bake. The floor and walls are subdivided and each
 *   vertex is darkened by how enclosed its position is — into a corner, under
 *   the conveyor, behind a prop. `aoAt` is that function. It costs one
 *   multiply per fragment and nothing else, which is the only reason it is
 *   affordable on a phone; a screen-space AO pass would cost a depth
 *   pre-pass and a blur every frame for the same picture.
 *
 *   The ceiling is geometry, because from eye height you never see the middle
 *   of it — you see the far end, where beams, ducting and lamps are what tell
 *   you the room is four and a half metres high. The lamp positions live here
 *   as data, next to the occlusion, because both are statements about where
 *   the light is and the two have to agree.
 *
 * Deliberately NOT here: extra point lights. Each one is another term in the
 * fragment shader's light loop, on every pixel, every frame. Six lamps that
 * look like light and cost nothing beat three lamps that cost a third of the
 * frame budget and still look like three.
 */

import { ROOM, SCENERY, type SceneryItem } from "./environment";

/** How far from a wall the occlusion reaches, in metres. */
const WALL_REACH = 2.6;

/** How dark the tightest corner goes. Not black — rock is never black. */
const CORNER_FLOOR = 0.3;

/** Extra darkening under a piece of plant, as a multiplier floor. */
const UNDER_PLANT = 0.55;

export interface Lamp {
  x: number;
  z: number;
  /** Ceiling height the fixture hangs from. */
  y: number;
}

/**
 * Strip lights down the middle of the ceiling.
 *
 * Spaced along the wide axis, which is the axis the room reads across, so the
 * row of them gives the space its length. Five is what fits 26 m without the
 * outer two drifting over the walls.
 *
 * The positions are shared with the lights that actually illuminate the room
 * (`LIT_LAMP_INDICES` below) and with the environment map, so a trainee who
 * looks up at a lamp can see the pool of light it is making on the floor.
 */
export const CEILING_LAMPS: readonly Lamp[] = [
  { x: -8, z: 0, y: ROOM.height - 0.55 },
  { x: -4, z: 0, y: ROOM.height - 0.55 },
  { x: 0, z: 0, y: ROOM.height - 0.55 },
  { x: 4, z: 0, y: ROOM.height - 0.55 },
  { x: 8, z: 0, y: ROOM.height - 0.55 },
] as const;

/** Metres of floor a lamp is taken to light. */
const LAMP_REACH = 7.5;

/**
 * Which of the ceiling lamps carry a real light, and which are fittings only.
 *
 * The room has five visible strip lights and three point lights, because each
 * point light is a term in every fragment's shading loop on every pixel of
 * every frame. The three are hung under the three central fittings, so the
 * pools of light on the floor sit under the lamps you can see.
 *
 * The two outer fittings are the honest cost of that trade. They are over the
 * ends of a 26 m room, where the light has fallen off and the skirting is
 * already dark from the baked occlusion, so the eye reads them as fittings in
 * a dim end rather than as lamps that failed to make a pool.
 *
 * The alternative — a light per fitting, and the positions agreeing exactly —
 * is one of the first things to cut if Phase 1 ever needs the headroom back.
 */
export const LIT_LAMP_INDICES: readonly number[] = [1, 2, 3];

/** Shortest distance from a point to any wall plane, in metres. */
function distanceToWalls(x: number, z: number): number {
  return Math.min(ROOM.width / 2 - Math.abs(x), ROOM.depth / 2 - Math.abs(z));
}

/**
 * How open one axis is, as a multiplier.
 *
 * Ranges from 0.55 flat against a wall to 1 in the middle, rather than from 0.
 * A floor that falls to black at the skirting does not look occluded, it looks
 * like the texture ran out — and it took a clamp to hide that, which in turn
 * flattened every point within a metre of a wall to the same value and erased
 * the corner-versus-skirting distinction the whole function exists to draw.
 *
 * Smoothstep, not a linear ramp: a linear ramp leaves a visible crease where it
 * meets flat floor, and a hard edge in an ambient term is the one artefact the
 * eye finds instantly.
 */
function opennessOnAxis(distanceToNearestWall: number): number {
  const t = Math.max(0, Math.min(1, distanceToNearestWall / WALL_REACH));
  return 0.55 + 0.45 * (t * t * (3 - 2 * t));
}

/** Does this piece of plant stand over this point? */
function underPlant(x: number, z: number, items: readonly SceneryItem[] = SCENERY): boolean {
  for (const item of items) {
    // Only floor-standing plant casts anything onto the floor. A hose reel at
    // 1.45 m on the back wall does not darken the floor in front of it, and
    // treating it as if it did would put a shadow band across open walking room.
    if ((item.y ?? 0) >= 0.6) continue;
    const rx = item.kind === "conveyor" ? 2.6 : 1.6;
    const rz = item.kind === "conveyor" ? 8.0 : 1.6;
    if (Math.abs(x - item.x) < rx && Math.abs(z - item.z) < rz) return true;
  }
  return false;
}

/**
 * Baked ambient occlusion on the floor, as a 0..1 multiplier.
 *
 * The function that earns the room its shape.
 *
 * Occlusion is a *product* over the axes, not a minimum over them, and getting
 * that wrong is invisible in the code and obvious on the floor. Taking the
 * nearest wall means a point 0.4 m from the back wall scores identically to a
 * point 0.4 m from both walls at once, so corners come out exactly as bright
 * as the skirting beside them and the room has no corners. Multiplying the
 * two axes gets it for free: one wall darkens once, two darken twice.
 *
 * Plant overhead is a separate cap, because a conveyor is the reason a
 * fifteen-metre dark band exists across open floor, and no amount of proximity
 * to a wall would draw it.
 *
 * Returns 1 in open floor. The value multiplies the albedo through the vertex
 * colour, so it can only darken — light comes from the lamps and the
 * environment, not from here.
 */
export function aoAt(x: number, z: number, items: readonly SceneryItem[] = SCENERY): number {
  const openX = opennessOnAxis(ROOM.width / 2 - Math.abs(x));
  const openZ = opennessOnAxis(ROOM.depth / 2 - Math.abs(z));
  let ao = openX * openZ;
  if (underPlant(x, z, items)) ao = Math.min(ao, UNDER_PLANT);
  return Math.max(CORNER_FLOOR, Math.min(1, ao));
}

/**
 * Baked occlusion on a wall, as a 0..1 multiplier.
 *
 * A different shape from the floor, because a wall is not a floor. Height is
 * the dominant term — the base of a wall is where the floor's own occlusion
 * reaches up it — and the ends of each wall darken into the corners, which is
 * what stops four walls meeting and reading as one flat backdrop.
 */
export function wallAoAt(
  height: number,
  /** 0..1 along the wall. */
  along: number,
): number {
  // Full brightness by roughly head height, dark at the skirting.
  const up = Math.max(0, Math.min(1, height / (ROOM.height * 0.62)));
  const lift = up * up * (3 - 2 * up);
  // Ends of the wall run into the corners.
  const endness = Math.min(along, 1 - along) * 2;
  const into = Math.min(1, endness / 0.22);
  const ao = 0.34 + 0.66 * lift * (0.55 + 0.45 * into);
  return Math.max(0.3, Math.min(1, ao));
}

/**
 * Vertex colours for a plane, baked from an occlusion function.
 *
 * Returns a flat RGB array in three.js's interleaved-off `color` attribute
 * layout. Kept here, next to the functions that produce it, so the bake and
 * the maths that justifies it cannot drift apart — and so it can be tested
 * without a renderer, which is the only way it can be tested at all.
 */
export function bakeVertexColours(
  columns: number,
  rows: number,
  occlusion: (u: number, v: number) => number,
): Float32Array {
  const out = new Float32Array(columns * rows * 3);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const u = columns === 1 ? 0.5 : col / (columns - 1);
      const v = rows === 1 ? 0.5 : row / (rows - 1);
      // Baked into the vertex colour, so it multiplies albedo. Written three
      // times because a colour attribute is RGB and the value is a scalar.
      const ao = occlusion(u, v);
      const i = (row * columns + col) * 3;
      out[i] = ao;
      out[i + 1] = ao;
      out[i + 2] = ao;
    }
  }
  return out;
}

/**
 * Floor occlusion, mapped from the plane's own UVs.
 *
 * The floor is built in XZ and then rotated flat, so `u` runs along the room's
 * width and `v` along its depth. Both are remapped to room coordinates, which
 * is why the bake can be a function of position rather than a function of
 * texture — a tiled texture cannot carry corner darkening, because the corners
 * are not where the texture repeats.
 */
export function floorAoFromUv(u: number, v: number): number {
  const x = (u - 0.5) * ROOM.width;
  const z = (0.5 - v) * ROOM.depth;
  return aoAt(x, z);
}

/** Wall occlusion, mapped from the plane's own UVs. */
export function wallAoFromUv(u: number, v: number): number {
  // v = 0 is the bottom of a `PlaneGeometry`, which is the skirting.
  return wallAoAt(v * ROOM.height, u);
}
