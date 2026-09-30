/**
 * Spawn framing, checked without a renderer.
 *
 * The camera is the one thing in this project a test can be certain about, and
 * the failures it prevents are the ones nobody reports: a step that opens with
 * the thing it is about behind the trainee's head looks identical to a step that
 * works.
 */

import { describe, expect, test } from "bun:test";
import { ENTRY, ROOM, scenerySolids } from "./environment";
import {
  HALF_FOV,
  angleOffCentre,
  entryFrame,
  observeFrame,
  yawTowards,
} from "./spawn-framing";

const BODY_R = 0.45;

/** Every place in the room a target could plausibly be mounted or placed. */
function anchors(): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let x = -ROOM.width / 2 + 0.7; x <= ROOM.width / 2; x += 2) {
    for (let z = -ROOM.depth / 2 + 0.7; z <= ROOM.depth / 2; z += 2) out.push({ x, z });
  }
  return out;
}

describe("the entry frame", () => {
  test("stands at the entry, looking into the room", () => {
    const frame = entryFrame();
    expect(frame.x).toBe(ENTRY.x);
    expect(frame.z).toBe(ENTRY.z);
    // Yaw 0 is -Z, which is into the room from the entry. The old value was PI,
    // which faced the near wall from 1.2 m away.
    expect(frame.yaw).toBe(0);
  });
});

describe("an observe step frames the thing it is about", () => {
  test("the target is dead ahead from every wall position in the room", () => {
    for (const anchor of anchors()) {
      const frame = observeFrame(anchor, scenerySolids(), BODY_R);
      expect(angleOffCentre(frame, anchor)).toBeLessThan(1e-6);
    }
  });

  test("the target is inside the field of view, with room to spare", () => {
    // Not "in front" — inside the frustum. A target 40 degrees off centre on a
    // 78-degree view is on screen, and 45 degrees is not.
    for (const anchor of anchors()) {
      const frame = observeFrame(anchor, scenerySolids(), BODY_R);
      expect(angleOffCentre(frame, anchor)).toBeLessThan(HALF_FOV);
    }
  });

  test("the trainee is stood back far enough to see the object and its neighbours", () => {
    for (const anchor of anchors()) {
      const frame = observeFrame(anchor, scenerySolids(), BODY_R);
      const d = Math.hypot(anchor.x - frame.x, anchor.z - frame.z);
      // Too close and it is a close-up of a rectangle; too far and the label
      // has faded out before the trainee has read it.
      expect(d).toBeGreaterThan(3);
      expect(d).toBeLessThan(12);
    }
  });
});

describe("the camera is never spawned inside the room's furniture", () => {
  test("no spawn point lands in a wall", () => {
    const limitX = ROOM.width / 2 - 0.7 - BODY_R;
    const limitZ = ROOM.depth / 2 - 0.7 - BODY_R;
    for (const anchor of anchors()) {
      const { x, z } = observeFrame(anchor, scenerySolids(), BODY_R);
      expect(Math.abs(x)).toBeLessThanOrEqual(limitX + 1e-6);
      expect(Math.abs(z)).toBeLessThanOrEqual(limitZ + 1e-6);
    }
  });

  test("no spawn point lands inside a piece of plant", () => {
    for (const anchor of anchors()) {
      const { x, z } = observeFrame(anchor, scenerySolids(), BODY_R);
      for (const s of scenerySolids()) {
        const d = Math.hypot(x - s.x, z - s.z);
        expect(d).toBeGreaterThanOrEqual(s.r + BODY_R - 1e-6);
      }
    }
  });

  test("a target in the middle of the bay still gets a valid frame", () => {
    // The degenerate case: no direction away from the room centre, which would
    // divide by zero and produce a NaN camera position.
    const frame = observeFrame({ x: 0, z: 0 }, scenerySolids(), BODY_R);
    expect(Number.isFinite(frame.x)).toBe(true);
    expect(Number.isFinite(frame.z)).toBe(true);
    expect(Number.isFinite(frame.yaw)).toBe(true);
    expect(angleOffCentre(frame, { x: 0, z: 0 })).toBeLessThan(1e-6);
  });
});

describe("framing is deterministic", () => {
  test("the same target gives the same frame, every time", () => {
    // A cold re-check has to be comparable to the training it re-tests, and that
    // extends to where the camera started.
    const a = observeFrame({ x: -12.6, z: -9.3 }, scenerySolids(), BODY_R);
    const b = observeFrame({ x: -12.6, z: -9.3 }, scenerySolids(), BODY_R);
    expect(a).toEqual(b);
  });
});

describe("yaw", () => {
  test("yaw 0 looks into the room, not at the near wall", () => {
    // The value this project got wrong once. A camera looks down -Z.
    expect(yawTowards(0, 8.8, 0, -9)).toBeCloseTo(0, 6);
  });

  test("looking back at the entry is a half turn", () => {
    expect(Math.abs(yawTowards(0, 0, 0, 9))).toBeCloseTo(Math.PI, 6);
  });

  test("looking right is a quarter turn, and the sign is right", () => {
    // Right of -Z is +X, which is a negative yaw. Getting this backwards turns
    // every spawn 180 degrees out.
    expect(yawTowards(0, 0, 5, 0)).toBeCloseTo(-Math.PI / 2, 6);
  });
});
