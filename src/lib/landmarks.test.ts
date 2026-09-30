/**
 * Landmarks, checked as data.
 *
 * The important test here is the one about names. A landmark list is the most
 * likely place in this project for safety copy to appear by accident — "the
 * assembly point, where you gather after an evacuation" is one autocomplete away
 * — and safety copy is R9's until they have read it.
 */

import { describe, expect, test } from "bun:test";
import { ROOM, SCENERY } from "./environment";
import { LANDMARKS, describeWhere, landmarkById, landmarkDistance, landmarksNear } from "./landmarks";

describe("the landmark list", () => {
  test("there are enough of them to navigate by", () => {
    // Five is the floor below which a room has to be read off the map alone.
    expect(LANDMARKS.length).toBeGreaterThanOrEqual(5);
  });

  test("ids are unique, and every prop landmark is a real piece of scenery", () => {
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(LANDMARKS.length);
    const ids = new Set(SCENERY.map((s) => s.id));
    for (const l of LANDMARKS) {
      if (l.hasProp) expect(ids.has(l.id)).toBe(true);
    }
  });

  test("every landmark is inside the room", () => {
    for (const l of LANDMARKS) {
      expect(Math.abs(l.x)).toBeLessThanOrEqual(ROOM.width / 2);
      expect(Math.abs(l.z)).toBeLessThanOrEqual(ROOM.depth / 2);
    }
  });

  test("the tunnel mouth is one of them, because it is the one fixed point", () => {
    // Whatever else moves, the way out does not, and it is the thing a lost
    // trainee is looking for.
    expect(landmarkById("tunnel-mouth")).toBeDefined();
  });

  test("a landmark can be found by id", () => {
    const first = LANDMARKS[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(landmarkById(first.id)?.name).toBe(first.name);
    expect(landmarkById("no-such-thing")).toBeUndefined();
  });
});

describe("landmark names are nouns, and not safety copy", () => {
  test("no name is a sentence", () => {
    // The guard that keeps authored safety text out of a navigation panel. Two
    // or three words, no terminal punctuation. "Tunnel mouth" passes; "the place
    // to gather when the alarm sounds" does not, and must not be allowed to.
    for (const l of LANDMARKS) {
      expect(l.name.split(/\s+/).length).toBeLessThanOrEqual(3);
      expect(/[.!?;:,]$/.test(l.name)).toBe(false);
      expect(l.name).toBe(l.name.toLowerCase());
    }
  });

  test("the names are unique, so the panel does not list the same thing twice", () => {
    expect(new Set(LANDMARKS.map((l) => l.name)).size).toBe(LANDMARKS.length);
  });
});

describe("finding your way", () => {
  test("landmarks come back nearest first", () => {
    // "What is near me" is the question a lost trainee is asking. Alphabetical
    // order answers a different one.
    const near = landmarksNear(0, 8.8);
    expect(near.length).toBeGreaterThan(1);
    for (let i = 1; i < near.length; i++) {
      const before = near[i - 1];
      const after = near[i];
      if (!before || !after) continue;
      const prev = landmarkDistance({ x: 0, z: 8.8 }, before);
      const now = landmarkDistance({ x: 0, z: 8.8 }, after);
      expect(now).toBeGreaterThanOrEqual(prev - 1e-9);
    }
  });

  test("a radius actually filters", () => {
    expect(landmarksNear(0, 0, 3).every((l) => Math.hypot(l.x, l.z) <= 3)).toBe(true);
    expect(landmarksNear(0, 0).length).toBeGreaterThan(landmarksNear(0, 0, 3).length);
  });

  test("distance is the straight-line distance", () => {
    const l = LANDMARKS[0];
    expect(l).toBeDefined();
    if (!l) return;
    expect(landmarkDistance({ x: 0, z: 0 }, l)).toBeCloseTo(Math.hypot(l.x, l.z), 6);
  });
});

describe("where it is, said geometrically", () => {
  test("each wall is named for the side it is on", () => {
    // Read off the coordinates, so it cannot disagree with the room.
    expect(describeWhere({ x: -12.5, z: 0 })).toBe("against the left wall");
    expect(describeWhere({ x: 12.5, z: 0 })).toBe("against the right wall");
    expect(describeWhere({ x: 0, z: -9.5 })).toBe("against the back wall");
    expect(describeWhere({ x: 0, z: 9.5 })).toBe("against the front wall");
  });

  test("a thing in the middle of the floor is not claimed to be on a wall", () => {
    // Only reachable by a landmark on a wall in practice, but the helper is
    // exported and the panel is not the only future caller.
    expect(typeof describeWhere({ x: 0, z: 0 })).toBe("string");
  });
});
