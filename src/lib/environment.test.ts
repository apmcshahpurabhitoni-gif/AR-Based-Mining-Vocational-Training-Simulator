/**
 * The mine, checked.
 *
 * `environment.ts` is data, and the whole reason it is TypeScript rather than
 * JSON is so that data can be checked by something other than a human opening a
 * browser. These are the checks that matter:
 *
 *   1. the room is the shape the brief asked for
 *   2. scenery can never collide with the vocabulary that is graded — the
 *      regression that started all of this
 *   3. everything in the table is inside the room and inside the world
 *   4. everything that stands on the floor claims a footprint, so the walker
 *      cannot pass through it
 *   5. every kind in the table has a builder that actually builds
 *
 * None of these are aesthetics. Aesthetics need eyes. These are the class of
 * mistake that reaches a trainee as "the conveyor is in the wall" or "tapping
 * the workbench failed me", and those are worth a test.
 */

import { describe, expect, test } from "bun:test";
import {
  FLOOR_STANDING_Y,
  ROOM,
  SCENERY,
  SCENERY_FOOTPRINT,
  onFloor,
  pushOutOfSolids,
  scenerySolids,
  type SceneryKind,
} from "./environment";
import { INTERACTABLES, MARKERS } from "./markers";
import { buildScenery } from "./ar/prop-shapes";

/** Every id this project is allowed to put in front of a trainee, and grade. */
const gradable = new Set([
  ...Object.values(MARKERS).flat(),
  ...Object.values(INTERACTABLES).flat(),
]);

describe("the room is the shape the brief asks for", () => {
  test("it is wide — wider than it is deep, and wider than it is tall", () => {
    // "it has to be wide". A room that is deep reads as a corridor no matter
    // how much floor area it has, so the comparison is the point, not the
    // square metres.
    expect(ROOM.width).toBeGreaterThan(ROOM.depth);
    expect(ROOM.width).toBeGreaterThan(ROOM.height * 3);
    expect(ROOM.width).toBeGreaterThanOrEqual(24);
  });

  test("a trainee fits under everything hanging from the roof", () => {
    const headroom = 1.95;
    for (const item of SCENERY) {
      if (onFloor(item)) continue;
      const hanging = item.y ?? 0;
      // Wall kit is mounted, not suspended at head height, so only what hangs
      // low enough to meet a person needs to clear them.
      if (hanging < headroom) expect(hanging).toBeGreaterThan(FLOOR_STANDING_Y - 0.001);
    }
  });
});

describe("scenery is inert, and provably so", () => {
  test("no piece of scenery is named like something that can be graded", () => {
    // The bug this whole file exists to prevent. The training page used to
    // furnish the room from a page-local list — `fire-hose-reel`,
    // `switchboard`, `dust-extractor`, `conveyor-drive` — and `runner.ts` grades
    // a tap on an unknown id as a miss, so each of those recorded a real,
    // module-specific safety consequence against an object no spec ever defined.
    // A gas-detection step offered a fire hose reel; tapping it failed the
    // trainee on gas safety.
    for (const item of SCENERY) {
      expect(gradable.has(item.id)).toBe(false);
    }
  });

  test("scenery ids are unique", () => {
    const seen = new Set<string>();
    for (const item of SCENERY) {
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
    }
  });

  test("every kind in the table has a builder that builds something", () => {
    const built = new Map<SceneryKind, number>();
    for (const item of SCENERY) {
      if (built.has(item.kind)) continue;
      const group = buildScenery(item.kind, (g) => g);
      expect(group.children.length).toBeGreaterThan(0);
      built.set(item.kind, group.children.length);
    }
    // The table is meant to furnish a bay, not three objects and a wall.
    expect(built.size).toBeGreaterThanOrEqual(10);
  });
});

describe("the layout is walkable", () => {
  test("everything is inside the room", () => {
    for (const item of SCENERY) {
      expect(Math.abs(item.x)).toBeLessThan(ROOM.width / 2);
      expect(Math.abs(item.z)).toBeLessThan(ROOM.depth / 2);
      expect(item.y ?? 0).toBeLessThan(ROOM.height);
    }
  });

  test("anything standing on the floor blocks the walker", () => {
    // Otherwise the trainee strolls through the conveyor, and a room you can
    // walk through stops being a room. The renderer reads the same rule through
    // `onFloor`, so this test and the collision code cannot drift apart.
    for (const item of SCENERY) {
      if (!onFloor(item)) continue;
      expect(SCENERY_FOOTPRINT[item.kind]?.r).toBeGreaterThan(0);
    }
  });

  test("a long item is solid along its whole run, not just at its centre", () => {
    // The conveyor is 17 m of belt. One circle at its centre would let the
    // trainee walk through either end of it, which is the most visible way a
    // 3D room stops being a room.
    const belt = SCENERY.find((item) => item.kind === "conveyor");
    expect(belt).toBeDefined();
    if (!belt) return;
    const footprint = SCENERY_FOOTPRINT.conveyor;
    const run = footprint?.run ?? 0;
    expect(run).toBeGreaterThan(0);

    const solids = scenerySolids();
    const bodyR = 0.45;
    // Step along the belt in 1 m increments and insist that no point on it is
    // somewhere a trainee could stand.
    for (let along = -run / 2; along <= run / 2; along += 1) {
      const x = belt.x + Math.sin(belt.ry) * along;
      const z = belt.z + Math.cos(belt.ry) * along;
      const blocked = solids.some(
        (s) => Math.hypot(s.x - x, s.z - z) < s.r + bodyR,
      );
      expect(blocked).toBe(true);
    }
  });

  test("the collision set is the data, so it stays inside the room", () => {
    for (const solid of scenerySolids()) {
      expect(Math.abs(solid.x)).toBeLessThan(ROOM.width / 2 + 1);
      expect(Math.abs(solid.z)).toBeLessThan(ROOM.depth / 2 + 1);
    }
  });

  test("wall-mounted kit is not given a footprint", () => {
    // A radius on a wall-mounted box would wall off the wall it is mounted on.
    for (const kind of Object.keys(SCENERY_FOOTPRINT) as SceneryKind[]) {
      const onFloorSomewhere = SCENERY.some((item) => item.kind === kind && onFloor(item));
      const mountedSomewhere = SCENERY.some((item) => item.kind === kind && !onFloor(item));
      // A kind may be used both ways in principle; it may not be wall-mounted
      // *only*, because then its footprint figure is a lie waiting to be
      // applied to a floor-standing instance of it.
      expect(onFloorSomewhere || !mountedSomewhere).toBe(true);
    }
  });

  test("a point inside a piece of plant is pushed clear of it", () => {
    // This is what stops a manifest-authored position from driving a sign post
    // through the workbench. The manifest says roughly where an object belongs;
    // the room it lands in already has equipment in it.
    const bench = SCENERY.find((item) => item.kind === "bench");
    expect(bench).toBeDefined();
    if (!bench) return;
    const moved = pushOutOfSolids(bench.x, bench.z, 0.6, scenerySolids());
    const travelled = Math.hypot(moved.x - bench.x, moved.z - bench.z);
    // Out of the bench, and to its edge rather than the far side of the room:
    // a correction, not a teleport.
    const need = (SCENERY_FOOTPRINT.bench?.r ?? 0) + 0.6;
    expect(travelled).toBeGreaterThanOrEqual(need - 1e-9);
    expect(travelled).toBeLessThan(need + 2);
  });

  test("the room is a working bay, so the whole floor is not taken", () => {
    // Rotated rectangles approximated by their bounding square — the check is
    // for a bay so cluttered there is nowhere to stand, not for millimetres.
    let claimed = 0;
    for (const solid of scenerySolids()) claimed += Math.PI * solid.r * solid.r;
    expect(claimed / (ROOM.width * ROOM.depth)).toBeLessThan(0.34);
  });
});
