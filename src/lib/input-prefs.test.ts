/**
 * The input rules, checked without a browser or a gamepad.
 *
 * Each guard below corresponds to a way the controls fail *silently* — the app
 * does not throw, the trainee just drifts into a wall or sprints when they meant
 * to stroll — so these are the tests worth having.
 */

import { describe, expect, test } from "bun:test";
import {
  DEADZONE,
  REACH_RADIUS,
  isTouchPrimary,
  lookPitch,
  lookYaw,
  prefersReducedMotion,
  reached,
  stickVector,
  type MediaQueryLike,
} from "./input-prefs";

/** A fake window whose media queries answer from a table. */
const fakeWindow = (answers: Record<string, boolean>): MediaQueryLike => ({
  matchMedia: (query: string) => ({ matches: answers[query] ?? false }),
});

describe("thumbsticks", () => {
  test("a resting stick is not a movement", () => {
    // The bug: a pad reporting 0.05 while nobody touches it, and the trainee
    // walks into the conveyor while trying to look at it.
    expect(stickVector(0.03, -0.02)).toEqual({ x: 0, y: 0 });
    expect(stickVector(0, 0)).toEqual({ x: 0, y: 0 });
  });

  test("the deadzone's edge is included, and just past it is not", () => {
    expect(stickVector(DEADZONE, 0)).toEqual({ x: 0, y: 0 });
    expect(stickVector(DEADZONE + 0.01, 0).x).toBeGreaterThan(0);
  });

  test("the first push off centre is slow, not instant", () => {
    // Rescaled rather than merely zeroed: a stick nudged a millimetre should
    // creep, not sprint.
    const nudge = stickVector(DEADZONE + 0.02, 0);
    expect(nudge.x).toBeGreaterThan(0);
    expect(nudge.x).toBeLessThan(0.1);
  });

  test("a diagonal push is not faster than a straight one", () => {
    // The classic gamepad bug: (1, 1) is √2 long, so walking at an angle moves
    // you 41% further per frame and the room feels like it speeds up.
    const straight = stickVector(1, 0);
    const diagonal = stickVector(1, 1);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 6);
    expect(Math.hypot(straight.x, straight.y)).toBeCloseTo(1, 6);
  });

  test("full deflection is exactly full deflection, not more", () => {
    const v = stickVector(0.6, 0.8);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
  });

  test("the direction the stick points in is preserved", () => {
    // Rescaling must not swap or mirror the axes, or forward becomes back.
    const v = stickVector(0.6, 0.8);
    expect(v.x / v.y).toBeCloseTo(0.6 / 0.8, 6);
  });

  test("a non-finite reading is treated as centred", () => {
    // A pad that reports NaN once would otherwise put NaN in the camera
    // position and the room would vanish with no error.
    const v = stickVector(Number.NaN, 0);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });
});

describe("looking", () => {
  test("yaw and pitch are separate rates in -1..1", () => {
    // The right stick turns the view without moving, which is how you look at
    // the far wall of a 26 m room without walking to it.
    expect(lookYaw(1)).toBeCloseTo(1, 6);
    expect(lookYaw(-1)).toBeCloseTo(-1, 6);
    expect(lookPitch(1)).toBeCloseTo(1, 6);
    expect(lookPitch(-1)).toBeCloseTo(-1, 6);
    expect(lookYaw(0)).toBe(0);
    expect(lookPitch(0)).toBe(0);
  });

  test("a resting stick does not drift the view", () => {
    // A pad left on a desk reporting 0.04 would slowly rotate the room on its
    // own, and the trainee would have no idea why.
    expect(lookYaw(0.04)).toBe(0);
    expect(lookPitch(0.04)).toBe(0);
  });

  test("the two axes do not bleed into each other", () => {
    // Pitch is clamped by the caller, so a diagonal push must not leak its
    // horizontal component into a turn the trainee did not ask for.
    expect(lookYaw(0, 0.5)).toBe(0);
    expect(lookPitch(0, 0.5)).toBe(0);
    expect(lookYaw(0.5)).toBeGreaterThan(0);
    expect(lookPitch(0.5)).toBeGreaterThan(0);
  });

  test("a deadzone of zero still works, rather than dividing by zero", () => {
    // Passed through by a caller with its own tuning. Without the clamp this
    // returns NaN, and NaN in a camera position is an invisible room.
    expect(lookPitch(1, 0)).toBe(1);
    expect(lookYaw(1, 0)).toBe(1);
    expect(lookYaw(0.5, 1)).toBe(0);
  });
});

describe("arriving", () => {
  test("close enough counts as arrived, and far away does not", () => {
    expect(reached(0)).toBe(true);
    expect(reached(REACH_RADIUS)).toBe(true);
    expect(reached(REACH_RADIUS + 0.01)).toBe(false);
  });

  test("the radius is a person, not a room", () => {
    // 2.2 m is arm's length plus the width of the thing. Any larger and the
    // room says "you have arrived" from across the bay, which teaches nothing.
    expect(REACH_RADIUS).toBeGreaterThan(1.5);
    expect(REACH_RADIUS).toBeLessThan(3);
  });
});

describe("reduced motion", () => {
  test("is honoured when the device asks for it", () => {
    expect(prefersReducedMotion(fakeWindow({ "(prefers-reduced-motion: reduce)": true }))).toBe(true);
    expect(prefersReducedMotion(fakeWindow({ "(prefers-reduced-motion: reduce)": false }))).toBe(false);
  });

  test("a browser that throws on the query gets less motion, not more", () => {
    // An old Android WebView is exactly where this project will be installed.
    const throwing: MediaQueryLike = {
      matchMedia: () => {
        throw new Error("unsupported");
      },
    };
    expect(prefersReducedMotion(throwing)).toBe(true);
  });

  test("no window at all is not a crash", () => {
    expect(prefersReducedMotion(null)).toBe(true);
    expect(prefersReducedMotion(undefined)).toBe(true);
  });
});

describe("touch detection", () => {
  test("a coarse pointer is touch; a mouse is not", () => {
    expect(isTouchPrimary(fakeWindow({ "(pointer: coarse)": true }))).toBe(true);
    expect(isTouchPrimary(fakeWindow({ "(pointer: coarse)": false }))).toBe(false);
  });

  test("a browser that throws is assumed to have a mouse", () => {
    // Opposite default to reduced motion, and deliberately: showing the
    // on-screen thumb controls on a desktop is clutter, and hiding them on a
    // phone is unusable. The guess that hurts least is the keyboard one.
    const throwing: MediaQueryLike = {
      matchMedia: () => {
        throw new Error("unsupported");
      },
    };
    expect(isTouchPrimary(throwing)).toBe(false);
  });
});
