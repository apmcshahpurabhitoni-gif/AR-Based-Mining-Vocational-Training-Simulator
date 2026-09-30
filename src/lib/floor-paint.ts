/**
 * Painted routes on the floor — `docs/16` phases 3 and 4.
 *
 * ---------------------------------------------------------------------------------
 * What this is, and what it is not
 * ---------------------------------------------------------------------------------
 *
 * A map is a thing you read. A painted line on the floor is a thing you walk
 * along, and in a 26 x 20 m bay the second is worth more: the trainee is not
 * holding a map, they are looking at the floor.
 *
 * Two routes are painted. The primary runs from the entry to the tunnel. The
 * alternate leaves the entry on a different line and joins the same tunnel from
 * the other side. **Which one a person should take is safety content** and this
 * file does not say — it declares two lines of paint and nothing else. Making
 * one of them the correct route is R9's, and the alternates are drawn dashed for
 * exactly that reason: visually secondary, never labelled as right or wrong.
 *
 * Inert, like everything in `SCENERY`. Paint is never pickable and never graded,
 * and `floor-paint.test.ts` fails the build if a stroke id ever matches
 * something in the marker vocabulary.
 *
 * Every vertex is inside the room and every stroke keeps a walkable clearance
 * from the collision set, both asserted by the test. A painted route that ran
 * under the conveyor would be a line the trainee is told to follow into a solid
 * object, which is worse than no line at all.
 */

import { ENTRY, EXIT_MOUTH, ROOM, type ScenerySolid } from "./environment";

export type PaintRole = "walkway" | "alternate";

export interface PaintStroke {
  /** Stable id, for tests. Never shown to a trainee. */
  id: string;
  role: PaintRole;
  /** Centre-line, metres from the room centre. */
  points: readonly (readonly [number, number])[];
  /** Stripe width, metres. */
  width: number;
  /** Drawn as dashes rather than a solid line. The alternates are dashed. */
  dashed?: boolean;
}

/** Dash length and the gap between dashes, metres. */
const DASH = 0.7;
const GAP = 0.5;

export const PAINT: readonly PaintStroke[] = [
  {
    id: "route-primary",
    role: "walkway",
    width: 0.22,
    points: [
      [ENTRY.x, ENTRY.z],
      [EXIT_MOUTH.x, EXIT_MOUTH.z],
    ],
  },
  {
    id: "route-alternate",
    role: "alternate",
    width: 0.16,
    dashed: true,
    points: [
      [ENTRY.x, ENTRY.z],
      [-2.0, 5.5],
      [-1.0, -1.0],
      [-3.5, -5.6],
      [1.5, -6.6],
      [EXIT_MOUTH.x, EXIT_MOUTH.z],
    ],
  },
] as const;

/** One straight piece of stripe, ready to become a box. */
export interface PaintPiece {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
}

/**
 * A stroke expanded into drawable pieces.
 *
 * A dashed line is many short pieces rather than a texture, because a texture
 * on a floor quad means a second material, a UV set and a repeat factor tuned by
 * eye, and the only thing being asked of the alternate route is that it reads
 * as secondary from across the room.
 */
export function paintPieces(stroke: PaintStroke): PaintPiece[] {
  const pieces: PaintPiece[] = [];
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const from = stroke.points[i];
    const to = stroke.points[i + 1];
    if (!from || !to) continue;
    const [ax, az] = from;
    const [bx, bz] = to;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    if (!stroke.dashed) {
      pieces.push({ ax, az, bx, bz, width: stroke.width });
      continue;
    }
    const step = DASH + GAP;
    const count = Math.max(1, Math.floor(len / step));
    // Spread the dashes over the whole run rather than stopping short of the
    // end, so a dashed route still visibly reaches the tunnel.
    const used = count * step;
    const offset = (len - (used - GAP)) / 2;
    for (let n = 0; n < count; n++) {
      const t0 = (offset + n * step) / len;
      const t1 = (offset + n * step + DASH) / len;
      pieces.push({
        ax: ax + (bx - ax) * t0,
        az: az + (bz - az) * t0,
        bx: ax + (bx - ax) * t1,
        bz: az + (bz - az) * t1,
        width: stroke.width,
      });
    }
  }
  return pieces;
}

/** Every piece in the room, flattened. The renderer's whole geometry list. */
export function allPaintPieces(): PaintPiece[] {
  return PAINT.flatMap(paintPieces);
}

/** Distance from a point to a segment. Pure, so the test can check the layout. */
export function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/**
 * How much room a walker has beside a stroke: the smallest gap between the
 * paint and anything solid, less the width of a person.
 *
 * Negative means the line runs through something, which is the bug this exists
 * to make impossible. `halfWidth` is the walkway's own half-width, because a
 * 2.2 m aisle painted down the middle needs the aisle to be there.
 */
export function routeClearance(
  stroke: PaintStroke,
  solids: readonly ScenerySolid[],
  bodyRadius: number,
  halfWidth = 1.1,
): number {
  let worst = Infinity;
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const from = stroke.points[i];
    const to = stroke.points[i + 1];
    if (!from || !to) continue;
    const [ax, az] = from;
    const [bx, bz] = to;
    for (const s of solids) {
      worst = Math.min(worst, distanceToSegment(s.x, s.z, ax, az, bx, bz) - s.r - bodyRadius);
    }
  }
  return worst - halfWidth;
}

/** Smallest distance from any part of a stroke to the room's walls. */
export function routeWallMargin(stroke: PaintStroke): number {
  let worst = Infinity;
  for (const [x, z] of stroke.points) {
    worst = Math.min(
      worst,
      ROOM.width / 2 - Math.abs(x),
      ROOM.depth / 2 - Math.abs(z),
    );
  }
  return worst;
}

/**
 * How far apart two routes run through the middle of the room.
 *
 * Both routes start at the entry and finish at the tunnel, so the raw minimum
 * distance between them is always zero and the number would say nothing. What
 * matters is whether they *diverge*: two lines 20 cm apart for their whole
 * length are one line drawn twice, and the room would have no second route at
 * all while the bay map claimed it did. So the shared first and last
 * `TRIMMED` metres of each route are excluded — the last few metres are where
 * both routes converge on the same tunnel, and proximity there is the point
 * rather than a defect — and what is left is the part where the two lines have
 * to be distinguishable.
 */
const TRIMMED = 3.0;

export function routeSeparation(a: PaintStroke, b: PaintStroke): number {
  const inner = trimEnds(a, TRIMMED);
  const other = trimEnds(b, TRIMMED);
  let worst = Infinity;
  for (const [ax, az, bx, bz] of inner) {
    for (const [cx, cz, dx, dz] of other) {
      // Sample along one line, measure to the other. Endpoint-to-endpoint alone
      // misses the case where one route's middle runs past the other's end.
      for (let s = 0; s <= 16; s++) {
        const t = s / 16;
        worst = Math.min(worst, distanceToSegment(cx + (dx - cx) * t, cz + (dz - cz) * t, ax, az, bx, bz));
      }
    }
  }
  return worst;
}

/** The middle of a polyline: its segments with `by` metres taken off each end. */
function trimEnds(
  stroke: PaintStroke,
  by: number,
): Array<readonly [number, number, number, number]> {
  const pts: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const from = stroke.points[i];
    const to = stroke.points[i + 1];
    if (!from || !to) continue;
    const [ax, az] = from;
    const [bx, bz] = to;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const t0 = by / len;
    const t1 = 1 - by / len;
    // A segment shorter than the trim is inside the excluded end, so it drops
    // out entirely; the next segment continues the run.
    if (t1 <= t0) continue;
    pts.push([ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1]);
  }
  return pts;
}
