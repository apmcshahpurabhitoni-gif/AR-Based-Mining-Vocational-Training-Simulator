import { describe, expect, test } from "bun:test";
import { ROOM } from "./environment";
import { DEFAULT_VIEW_ID, ROOM_VIEWS, resolveView } from "./room-views";
import { FrameMeter, readoutLines } from "./frame-stats";

describe("room views — a screenshot has to be repeatable", () => {
  test("every view sits inside the room, at a standing eye height", () => {
    // A preset outside the geometry renders the inside of a wall, which is a
    // black screenshot — indistinguishable from a bug in the renderer, and
    // the one thing a reviewer cannot be asked to debug.
    for (const v of ROOM_VIEWS) {
      expect(Math.abs(v.x)).toBeLessThan(ROOM.width / 2);
      expect(Math.abs(v.z)).toBeLessThan(ROOM.depth / 2);
      expect(v.y).toBeGreaterThan(0);
      expect(v.y).toBeLessThan(ROOM.height);
    }
  });

  test("every view looks somewhere finite and level enough to be legible", () => {
    for (const v of ROOM_VIEWS) {
      expect(Number.isFinite(v.yaw)).toBe(true);
      expect(Number.isFinite(v.pitch)).toBe(true);
      // Past straight up or straight down the frame is ceiling or floor, which
      // tells a reviewer nothing about the room.
      expect(Math.abs(v.pitch)).toBeLessThan(1.4);
    }
  });

  test("ids are unique and url-safe", () => {
    const ids = ROOM_VIEWS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  test("the views cover the brief — the room is judged from a fixed set", () => {
    // Five of the six reference angles from docs/16 phase 0. If one is renamed
    // or dropped, a reviewer's saved URL stops resolving, so the set is pinned.
    expect(ROOM_VIEWS.map((v) => v.id)).toEqual([
      "entry",
      "conveyor",
      "backwall",
      "tunnel",
      "corner",
      "ceiling",
    ]);
  });

  test("the entry view is the actual spawn, or screenshots mislead", () => {
    // `Scene3D` spawns at (0, 1.65, depth/2 - 1.2). If the two drift apart,
    // the "entry" screenshot stops showing what a trainee actually sees.
    const entry = ROOM_VIEWS.find((v) => v.id === "entry")!;
    expect(entry.x).toBe(0);
    expect(entry.y).toBe(1.65);
    expect(entry.z).toBeCloseTo(ROOM.depth / 2 - 1.2, 6);
    expect(entry.yaw).toBe(0);
  });

  test("every view says what it is for", () => {
    // A reviewer who does not know why a frame exists cannot tell whether the
    // thing they are looking at is a defect or the thing the view was chosen to
    // show.
    for (const v of ROOM_VIEWS) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.checks.length).toBeGreaterThan(10);
    }
  });
});

describe("room views — resolving a url", () => {
  test("finds a view by id", () => {
    expect(resolveView("tunnel")?.id).toBe("tunnel");
  });

  test("is tolerant of case and stray whitespace", () => {
    // These get typed by hand into a phone's browser bar.
    expect(resolveView("  TUNNEL ")?.id).toBe("tunnel");
  });

  test("no parameter means no lock, which is the normal way to play", () => {
    // The most important case: a trainee must never be locked out of moving.
    expect(resolveView(null)).toBeNull();
    expect(resolveView(undefined)).toBeNull();
    expect(resolveView("")).toBeNull();
  });

  test("an unknown value is not an error, it is no lock", () => {
    // A stale bookmark should show a normal room, not a black screen.
    expect(resolveView("nope")).toBeNull();
  });

  test("the default view id exists in the set", () => {
    expect(ROOM_VIEWS.some((v) => v.id === DEFAULT_VIEW_ID)).toBe(true);
  });
});

describe("frame stats — the numbers the room is judged on", () => {
  /** Push `n` frames of a fixed duration. */
  function run(meter: FrameMeter, ms: number, n: number) {
    let last: ReturnType<FrameMeter["read"]> | null = null;
    for (let i = 0; i < n; i++) last = meter.push(ms);
    return last!;
  }

  test("an empty meter reports zero rather than NaN", () => {
    const meter = new FrameMeter();
    const s = meter.read();
    expect(s.fps).toBe(0);
    expect(s.worstMs).toBe(0);
    expect(Number.isNaN(s.fps)).toBe(false);
  });

  test("60 frames of 16.67 ms is 60 fps", () => {
    const stats = run(new FrameMeter(), 1000 / 60, 20);
    expect(stats.fps).toBeGreaterThanOrEqual(58);
    expect(stats.fps).toBeLessThanOrEqual(60);
    expect(stats.meanMs).toBeGreaterThan(16);
    expect(stats.meanMs).toBeLessThan(17.5);
  });

  test("the worst frame survives the average", () => {
    // The whole reason `worstMs` exists. A room that runs at 30 fps with one
    // 400 ms stall in the window averages to a perfectly respectable 28, and
    // that stall is exactly what a trainee reports as "it froze".
    const meter = new FrameMeter();
    for (let i = 0; i < 20; i++) meter.push(33);
    const stats = meter.push(400);
    expect(stats.worstMs).toBe(400);
    expect(stats.fps).toBeLessThan(30);
  });

  test("the window is bounded, so an old stall does not haunt the readout", () => {
    const meter = new FrameMeter();
    for (let i = 0; i < 60; i++) meter.push(500);
    const stats = run(meter, 16, 60);
    // The 500 ms frames have rolled out of the window.
    expect(stats.worstMs).toBeLessThan(100);
    expect(stats.fps).toBeGreaterThan(50);
  });

  test("a nonsensical frame time cannot poison the window", () => {
    // A NaN or a backwards clock from a coalesced event would otherwise drag
    // the mean down and the readout would print a nonsense fps for a second.
    const meter = new FrameMeter();
    meter.push(NaN);
    meter.push(-5);
    const stats = meter.push(16);
    expect(Number.isFinite(stats.fps)).toBe(true);
    expect(stats.fps).toBeGreaterThan(0);
    expect(stats.worstMs).toBeLessThan(50);
  });

  test("reset clears the window", () => {
    const meter = new FrameMeter();
    run(meter, 500, 10);
    meter.reset();
    expect(meter.read().frames).toBe(0);
  });
});

describe("frame stats — the readout line", () => {
  const stats = { fps: 58, worstMs: 41, meanMs: 16.7, frames: 45 };

  test("carries every number a reviewer needs", () => {
    const text = readoutLines(stats, 214, 184_320, "hose-reel-back");
    expect(text).toContain("58 fps");
    expect(text).toContain("16.7 ms");
    expect(text).toContain("41 ms");
    expect(text).toContain("214 calls");
    expect(text).toContain("184k tris");
    expect(text).toContain("hose-reel-back");
  });

  test("a long stall is flagged, not left as one more number", () => {
    expect(readoutLines({ ...stats, worstMs: 480 }, 1, 1, "")).toContain("stall");
    expect(readoutLines(stats, 1, 1, "")).not.toContain("stall");
  });

  test("aiming at nothing says so", () => {
    expect(readoutLines(stats, 1, 1, "")).toContain("aimed -");
  });

  test("small triangle counts are not abbreviated", () => {
    expect(readoutLines(stats, 1, 850, "")).toContain("850 tris");
    expect(readoutLines(stats, 1, 12_400, "")).toContain("12k tris");
  });
});
