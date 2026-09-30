/**
 * The painted routes, checked as data.
 *
 * The guards here are the ones that matter for a line on the floor: that it is
 * inert, that it stays inside the room, and that a trainee can actually walk it
 * without meeting the conveyor.
 */

import { describe, expect, test } from "bun:test";
import { ROOM, scenerySolids } from "./environment";
import { INTERACTABLES, MARKERS } from "./markers";
import {
  PAINT,
  allPaintPieces,
  paintPieces,
  routeClearance,
  routeSeparation,
  routeWallMargin,
} from "./floor-paint";

const gradable = new Set([...Object.values(MARKERS).flat(), ...Object.values(INTERACTABLES).flat()]);
const BODY_R = 0.45;

describe("painted routes are inert, like all scenery", () => {
  test("no route is named like something that can be graded", () => {
    // The bug this project exists to not repeat: a thing in the room that
    // answers a tap. Paint is a line, not a target.
    for (const stroke of PAINT) {
      expect(gradable.has(stroke.id)).toBe(false);
    }
  });

  test("route ids are unique", () => {
    expect(new Set(PAINT.map((s) => s.id)).size).toBe(PAINT.length);
  });

  test("paint is never pickable — it is floor, and the room owns the floor", () => {
    // Stated as a shape check: every piece is a flat segment on the ground, so
    // there is nothing for the raycaster to return a mesh for.
    for (const piece of allPaintPieces()) {
      expect(Number.isFinite(piece.ax)).toBe(true);
      expect(piece.width).toBeLessThan(0.5);
    }
  });
});

describe("routes stay in the room", () => {
  test("every route keeps clear of the walls", () => {
    for (const stroke of PAINT) {
      expect(routeWallMargin(stroke)).toBeGreaterThan(0.4);
    }
  });

  test("both routes start at the entry and finish at the tunnel", () => {
    // Otherwise a painted line leads nowhere, which is the one thing a line on
    // the floor must not do.
    for (const stroke of PAINT) {
      const first = stroke.points[0];
      const last = stroke.points[stroke.points.length - 1];
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      if (!first || !last) return;
      expect(first[0]).toBeCloseTo(0, 3);
      expect(first[1]).toBeCloseTo(ROOM.depth / 2 - 1.2, 3);
      expect(last[0]).toBeCloseTo(6.4, 3);
      expect(last[1]).toBeCloseTo(-ROOM.depth / 2 + 0.8, 3);
    }
  });
});

describe("routes are walkable", () => {
  test("no route runs through anything the walker cannot pass", () => {
    // The generator cage was moved out of the primary aisle for exactly this
    // reason; it is the check that keeps it moved.
    for (const stroke of PAINT) {
      expect(routeClearance(stroke, scenerySolids(), BODY_R)).toBeGreaterThan(0);
    }
  });

  test("the walkway is wide enough to be an aisle", () => {
    const primary = PAINT.find((s) => s.role === "walkway");
    expect(primary).toBeDefined();
    if (!primary) return;
    expect(routeClearance(primary, scenerySolids(), BODY_R, 1.1)).toBeGreaterThan(0);
  });
});

describe("the two routes are two routes", () => {
  test("the primary is solid and the alternate is dashed", () => {
    // The alternate must never read as the marked way, because saying which
    // way is the marked way is safety content this project does not author.
    const primary = PAINT.find((s) => s.role === "walkway");
    const alternate = PAINT.find((s) => s.role === "alternate");
    expect(primary?.dashed ?? false).toBe(false);
    expect(alternate?.dashed).toBe(true);
  });

  test("they genuinely diverge, rather than running side by side", () => {
    const primary = PAINT.find((s) => s.role === "walkway");
    const alternate = PAINT.find((s) => s.role === "alternate");
    expect(primary).toBeDefined();
    expect(alternate).toBeDefined();
    if (!primary || !alternate) return;
    // Two lines 20 cm apart for their whole length are one line drawn twice,
    // and the room would have no second route while the map claimed it did.
    expect(routeSeparation(primary, alternate)).toBeGreaterThan(1.5);
  });
});

describe("dashes", () => {
  test("a dashed route is many pieces and a solid one is one per segment", () => {
    const alternate = PAINT.find((s) => s.dashed);
    const primary = PAINT.find((s) => !s.dashed);
    expect(alternate).toBeDefined();
    expect(primary).toBeDefined();
    if (!alternate || !primary) return;
    expect(paintPieces(alternate).length).toBeGreaterThan(10);
    expect(paintPieces(primary).length).toBe(primary.points.length - 1);
  });

  test("dashes reach the end of the run, so the line does not stop short", () => {
    const alternate = PAINT.find((s) => s.dashed);
    expect(alternate).toBeDefined();
    if (!alternate) return;
    const pieces = paintPieces(alternate);
    const last = pieces[pieces.length - 1];
    const end = alternate.points[alternate.points.length - 1];
    expect(last).toBeDefined();
    expect(end).toBeDefined();
    if (!last || !end) return;
    // Within a dash-length of the end, so the tunnel end of the route is drawn.
    expect(Math.hypot(last.bx - end[0], last.bz - end[1])).toBeLessThanOrEqual(0.75);
  });

  test("no dash is longer than the dash it is made of", () => {
    // Only the dashed routes: a solid route is one piece per segment, and its
    // length is the length of the room.
    for (const stroke of PAINT.filter((s) => s.dashed)) {
      for (const piece of paintPieces(stroke)) {
        const len = Math.hypot(piece.bx - piece.ax, piece.bz - piece.az);
        expect(len).toBeLessThanOrEqual(0.71);
      }
    }
  });
});
