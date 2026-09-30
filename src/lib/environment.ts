/**
 * The mine, defined as data.
 *
 * ---------------------------------------------------------------------------
 * The Ponytail approach — what this file is for
 * ---------------------------------------------------------------------------
 *
 * The design brief describes it as: *environment as modules, objects defined in
 * data, one reusable environment across FIRE/GAS/MACHINERY, minimal architecture
 * changes, works on multiple platforms.*
 *
 * This module is the first three of those. The room's dimensions and every piece
 * of equipment in it are declared here and nowhere else. `Scene3D` reads this and
 * draws it; it does not know what a conveyor is. That means the same mine serves
 * every module — a GAS room is this file, not a copy of the renderer — and adding
 * a workbench is one entry, not an edit to a render loop.
 *
 * It is TypeScript rather than JSON on purpose. The brief says "no hardcoding,
 * JSON definitions", and the intent is right: no layout may live in the renderer.
 * But a bare `.json` here would be an unvalidated `any` whose typos surface as a
 * missing object on a phone. This is data — it is just data a compiler and a test
 * can check.
 *
 * ---------------------------------------------------------------------------
 * Scenery is NOT a target, and that distinction is load-bearing
 * ---------------------------------------------------------------------------
 *
 * Everything in `SCENERY` is *context*: it makes the space legible, gives the
 * trainee something to navigate by, and makes the room a place rather than a box.
 * **None of it is tappable and none of it is graded.**
 *
 * That is deliberate, and it is the whole reason this file can be rich. An
 * earlier version of this project furnished the room from a list of ids that
 * lived only inside the training page — `fire-hose-reel`, `switchboard`,
 * `dust-extractor`, `conveyor-drive` — none of which appeared in any manifest or
 * spec. Because tapping an unknown id is graded as a miss, every one of them was
 * recording a real, module-specific safety consequence against an object that did
 * not exist. A gas-detection step offered a fire hose reel, and tapping it
 * reported a gas-safety failure.
 *
 * So there are two layers, and they must not be confused:
 *
 *   SCENERY (here)      — visual, navigational, inert. Rendered, never graded.
 *   MARKERS (markers.ts) — the 13-id vocabulary a step may actually be answered
 *                          with, enforced by `validate-content`.
 *
 * A fire hose reel is scenery. It is scenery *because* it can never be an answer,
 * which is exactly what makes it safe to put one in the room.
 */

/** Room interior in metres. Wide and low, like an equipment bay cut into rock. */
export const ROOM = {
  /** Across the trainee's view. The wide axis, and the one the brief asks for. */
  width: 26,
  /** Into the screen. Deeper than it is tall, so the space reads as a cavern. */
  depth: 20,
  height: 4.6,
} as const;

/**
 * Shape families. Each maps to a builder in `prop-shapes.ts`.
 *
 * `kind` is a closed union, so a typo in the table below is a compile error
 * rather than an invisible piece of equipment.
 */
export type SceneryKind =
  | "conveyor"
  | "switchboard"
  | "extractor"
  | "hose-reel"
  | "first-aid"
  | "gas-monitor"
  | "phone"
  | "estop"
  | "bench"
  | "toolboard"
  | "crate"
  | "rock"
  | "pipe-run";

export interface SceneryItem {
  /** Stable id. Used by tests and for debugging, never shown to a trainee. */
  id: string;
  kind: SceneryKind;
  /** Metres from the room centre. +x is right, +z is behind the spawn. */
  x: number;
  z: number;
  /** Facing, in radians. 0 faces +z (toward the trainee at entry). */
  ry: number;
  /** Vertical offset, for anything that hangs rather than stands. */
  y?: number;
  /** Non-uniform scale, for stretching a shape to fit a wall. */
  scale?: readonly [number, number, number];
}

/** Wall insets. Equipment mounts on a wall, so it sits just inside it. */
const L = -ROOM.width / 2 + 0.35; // left wall
const R = ROOM.width / 2 - 0.35; // right wall
const B = -ROOM.depth / 2 + 0.35; // back wall (far from the trainee)

/**
 * The equipment.
 *
 * Laid out the way a real bay is: heavy plant along the side walls so it does not
 * block the middle, consumables and safety kit on the back wall where a trainee
 * entering would look, and the conveyor running the length of the room because it
 * is the largest object and the thing that makes the space read as a mine.
 *
 * Deterministic and hand-placed. Nothing is randomised: a cold re-check must be
 * comparable to the training that preceded it, and that extends to where the
 * equipment was.
 */
export const SCENERY: readonly SceneryItem[] = [
  // -- The big anchor: a conveyor run down the right-hand side ----------------
  //
  // 15.6 m of belt, ending 1.2 m short of each end wall so the run stops at the
  // rock rather than passing through it. Its length is also why its collision is
  // a chain of circles instead of one: see `SCENERY_FOOTPRINT`.
  {
    id: "conveyor-line",
    kind: "conveyor",
    x: R - 1.9,
    z: -1.0,
    ry: 0,
    scale: [1, 1, 1.3],
  },

  // -- Side walls: plant and services ----------------------------------------
  { id: "switchboard-left", kind: "switchboard", x: L, z: -5.2, ry: Math.PI / 2 },
  { id: "toolboard-left", kind: "toolboard", x: L, z: 4.4, ry: Math.PI / 2, y: 1.55 },
  { id: "gas-monitor-left", kind: "gas-monitor", x: L, z: 0.2, ry: Math.PI / 2, y: 1.7 },
  { id: "estop-right", kind: "estop", x: R, z: 5.6, ry: -Math.PI / 2 },
  { id: "phone-right", kind: "phone", x: R, z: 7.4, ry: -Math.PI / 2, y: 1.5 },

  // -- Back wall: the kit a trainee looks for on entry ------------------------
  { id: "hose-reel-back", kind: "hose-reel", x: -4.6, z: B, ry: 0, y: 1.45 },
  { id: "first-aid-back", kind: "first-aid", x: -7.2, z: B, ry: 0, y: 1.6 },
  { id: "extractor-back", kind: "extractor", x: 3.4, z: B + 0.6, ry: 0, y: 2.9 },

  // -- Floor: work surfaces and loose material -------------------------------
  { id: "bench-mid", kind: "bench", x: -6.4, z: 3.2, ry: 0.24 },
  { id: "crate-a", kind: "crate", x: -9.6, z: -1.4, ry: 0.5 },
  { id: "crate-b", kind: "crate", x: -8.9, z: -2.6, ry: -0.3 },
  { id: "crate-c", kind: "crate", x: 9.4, z: 7.6, ry: 0.9 },

  // -- Rock: what makes it a mine rather than a warehouse --------------------
  { id: "rock-a", kind: "rock", x: -11.4, z: -7.4, ry: 0.7 },
  { id: "rock-b", kind: "rock", x: -10.4, z: 8.2, ry: 2.1 },
  { id: "rock-c", kind: "rock", x: 11.6, z: -8.4, ry: 1.3 },
  { id: "rock-d", kind: "rock", x: 6.2, z: 9.1, ry: 3.4 },
  { id: "rock-e", kind: "rock", x: -2.2, z: -9.2, ry: 0.2 },

  // -- Services overhead ------------------------------------------------------
  { id: "pipe-main", kind: "pipe-run", x: 0, z: B + 0.5, ry: 0, y: ROOM.height - 0.55 },
] as const;

/**
 * How far off the floor a piece of kit stops being something you walk around.
 *
 * One number, in the data module, used by both the renderer and the test. It
 * used to be an inline `0.6` in the render loop, which meant the rule that
 * "anything with a footprint stands on the floor" was only ever enforced by
 * whoever remembered it.
 */
export const FLOOR_STANDING_Y = 0.6;

/** True when this piece of equipment sits on the floor and blocks the walker. */
export const onFloor = (item: SceneryItem): boolean => (item.y ?? 0) < FLOOR_STANDING_Y;

/**
 * Floor area a piece of scenery claims: a radius, and optionally a length.
 *
 * Only the kinds that stand on the floor are listed. Wall-mounted kit hangs above
 * walking height and does not block anything, so giving it a radius would make
 * the layout test reject perfectly good rooms.
 *
 * The dust extractor is deliberately absent: every one in the table above hangs
 * off a wall, where the walker passes underneath it, so it claims no floor.
 *
 * `run` exists because one radius is right for a crate and wrong for a 17 m
 * conveyor. A circle large enough to cover the belt walls off the aisle beside
 * it; a circle small enough to leave the aisle lets the trainee walk straight
 * through the middle of it. So a long item is declared as a run, and
 * `scenerySolids` lays a chain of circles down that length.
 */
export const SCENERY_FOOTPRINT: Readonly<
  Partial<Record<SceneryKind, { r: number; run?: number }>>
> = {
  // 1.9 m belt: half-width plus a little, laid down the belt's full length
  // (12 m of geometry, stretched by the item's scale of 1.3).
  conveyor: { r: 1.1, run: 15.6 },
  bench: { r: 1.4 },
  crate: { r: 1.0 },
  rock: { r: 1.5 },
  estop: { r: 0.5 },
  switchboard: { r: 0.9 },
};

/** A circle of floor the walker cannot enter. */
export interface ScenerySolid {
  x: number;
  z: number;
  r: number;
}

/**
 * Move a point out of a set of solid circles.
 *
 * Repeated passes, because a point wedged where two circles overlap cannot
 * escape both in one move. Two callers: the room, which uses it to keep an
 * author-placed object from being driven through the workbench, and the walker,
 * which uses it to stay out of the plant. Pure geometry, so a test can check it
 * without a renderer.
 */
export function pushOutOfSolids(
  x: number,
  z: number,
  radius: number,
  solids: readonly ScenerySolid[],
): { x: number; z: number } {
  let nx = x;
  let nz = z;
  for (let pass = 0; pass < 3; pass++) {
    for (const p of solids) {
      const dx = nx - p.x;
      const dz = nz - p.z;
      const need = p.r + radius;
      const d = Math.hypot(dx, dz);
      if (d >= need) continue;
      if (d === 0) {
        // Dead centre: there is no direction to escape along, so pick one.
        nx += need;
      } else {
        nx += (dx / d) * (need - d);
        nz += (dz / d) * (need - d);
      }
    }
  }
  return { x: nx, z: nz };
}

/**
 * Everything on the floor, as circles the walker is pushed out of.
 *
 * A long item becomes a run of circles along its facing, spaced no further apart
 * than their own radius so the chain has no gap wider than a person. This is the
 * single source of collision for scenery: the renderer does not compute its own,
 * because a renderer that models collision separately from the data is a room
 * that slowly fills up with things you can walk through.
 */
export function scenerySolids(): ScenerySolid[] {
  const solids: ScenerySolid[] = [];
  for (const item of SCENERY) {
    const footprint = SCENERY_FOOTPRINT[item.kind];
    if (!footprint || !onFloor(item)) continue;
    const run = footprint.run ?? 0;
    const steps = run > 0 ? Math.max(2, Math.ceil(run / footprint.r)) : 1;
    for (let i = 0; i < steps; i++) {
      const along = steps === 1 ? 0 : (i / (steps - 1) - 0.5) * run;
      // The run lies along the item's own forward axis, turned by its facing.
      solids.push({
        x: item.x + Math.sin(item.ry) * along,
        z: item.z + Math.cos(item.ry) * along,
        r: footprint.r,
      });
    }
  }
  return solids;
}
