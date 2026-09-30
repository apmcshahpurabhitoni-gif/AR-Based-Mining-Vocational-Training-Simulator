/**
 * Fixed camera viewpoints, for looking at the room.
 *
 * Phase 0 of `docs/16-3d-environment-and-controls-plan.md`. The room had never
 * been seen by anyone — not by the author, who has no browser, and not by a
 * human, because the build has only ever been checked by a typechecker and a
 * unit test. Every visual change since the first one was reasoned about the
 * source and shipped unseen, which is not a way to make a room look right.
 *
 * A preset exists so that a screenshot is *comparable*. "Open the app and look
 * around" produces a different frame every time, from a different angle, with a
 * different set of labels — so two screenshots cannot be compared and a
 * reviewer cannot tell what changed. These are named, fixed, and locked: the
 * same URL gives the same frame on any device, which is the only property that
 * makes a reviewer's phone photo worth anything.
 *
 * Data, not code, for the same reason the equipment is data: adding a viewpoint
 * is a line here, and the test below can check all of them at once.
 *
 * Yaw convention matches the room: 0 faces -Z, into the space, because a
 * Three.js camera looks down its own -Z and `yaw = 0` is the value that means
 * "into the room". This is the bug that once made every trainee spawn facing a
 * wall.
 */

import { ROOM } from "./environment";

/** Eye height of a standing trainee, matching `Scene3D`. */
const EYE_H = 1.65;

export interface RoomView {
  /** URL value for `?view=`. */
  id: string;
  /** Shown on the lock badge, so a screenshot says where it was taken. */
  label: string;
  /** What this view is for checking. Read by a reviewer, never by a trainee. */
  checks: string;
  x: number;
  y: number;
  z: number;
  /** Radians. 0 faces -Z. */
  yaw: number;
  /** Radians. Positive looks up. */
  pitch: number;
}

/** Half the room, used to place views against a wall without hardcoding both. */
const W = ROOM.width / 2;
const D = ROOM.depth / 2;

export const ROOM_VIEWS: readonly RoomView[] = [
  {
    id: "entry",
    label: "Entry",
    // Where a trainee actually spawns. The first thing anyone sees, and the
    // one view that has to be right before anything else matters.
    checks: "What a trainee sees on the first step",
    x: 0,
    y: EYE_H,
    z: D - 1.2,
    yaw: 0,
    pitch: 0,
  },
  {
    id: "conveyor",
    label: "Conveyor",
    // Down the aisle beside the belt, looking along it. The reference room is
    // read along the conveyor, and a 15.6 m run only reads as long from along it.
    checks: "Conveyor length, trestles, belt height, aisle beside it",
    x: 6.0,
    y: EYE_H,
    z: 7.2,
    yaw: -0.34,
    pitch: -0.06,
  },
  {
    id: "backwall",
    label: "Back wall",
    // The kit a trainee looks for on entry, all on one wall: hose reel, first
    // aid, dust extractor.
    checks: "Wall-mounted kit, its heights, and the rock behind it",
    x: -3.0,
    y: EYE_H,
    z: 2.6,
    yaw: 0.22,
    pitch: 0.08,
  },
  {
    id: "tunnel",
    label: "Tunnel",
    // The way out. If the exit does not read as an exit from across the room,
    // "find the nearest emergency exit" is unanswerable by looking.
    checks: "Tunnel mouth, exit sign, walkway, whether the way out is obvious",
    x: 6.4,
    y: EYE_H,
    z: 6.0,
    yaw: 0,
    pitch: 0.04,
  },
  {
    id: "corner",
    label: "Corner",
    // The hardest view in the room: wide, deep, both walls at once. This is the
    // one that exposes flat ambient light and a ceiling with no scale.
    checks: "Overall light, ceiling span, wall junctions, the room's depth",
    x: -W + 1.4,
    y: EYE_H,
    z: D - 1.4,
    yaw: -0.62,
    pitch: 0.1,
  },
  {
    id: "ceiling",
    label: "Ceiling",
    // Looking up. Beams, services and lamps are what give a mine bay scale, and
    // they are invisible from every eye-level view.
    checks: "Roof beams, pipe run, lamp spacing, anything clipping",
    x: 0,
    y: EYE_H,
    z: 2.0,
    yaw: 0,
    pitch: 0.72,
  },
] as const;

export const DEFAULT_VIEW_ID = "entry";

/** Resolve a `?view=` value. Unknown values fall back rather than failing. */
export function resolveView(id: string | null | undefined): RoomView | null {
  if (!id) return null;
  return ROOM_VIEWS.find((v) => v.id === id.trim().toLowerCase()) ?? null;
}
