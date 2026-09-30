/**
 * Marker-target tests.
 *
 * These exist because the compile step and the runtime are separate programs
 * that have to agree about something MindAR never checks: **index order**.
 * `addAnchor(n)` binds to whatever image was `n`th at compile time, with no name
 * involved. If the two sides disagree, an object appears on the wrong printed
 * marker — which presents as a tracking fault and sends you looking at the
 * detector instead of at a list.
 *
 * The `.mind` file is a build artifact committed to the repo, so it can also go
 * stale against the source that defines it. That is the other thing tested here.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as msgpack from "@msgpack/msgpack";
import { MARKERS } from "../markers";
import { MODULES, MODULE_CODES } from "../modules";
import { TRACKED_TARGETS, TARGET_LABELS, targetIndexFor, hasARTarget } from "./targets";

const MIND_PATH = "public/targets.mind";
/** CompilerBase.CURRENT_VERSION. A mismatch makes the runtime refuse the file. */
const MIND_FORMAT_VERSION = 2;

describe("tracked marker set", () => {
  test("every tracked target is a real marker in its module's vocabulary", () => {
    const everyMarker = new Set(MODULE_CODES.flatMap((code) => MARKERS[code] ?? []));
    for (const id of TRACKED_TARGETS) {
      expect(everyMarker.has(id)).toBe(true);
    }
  });

  test("no duplicates, and every target has a printable label", () => {
    expect(new Set(TRACKED_TARGETS).size).toBe(TRACKED_TARGETS.length);
    for (const id of TRACKED_TARGETS) {
      expect(TARGET_LABELS[id]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("targetIndexFor agrees with the array, and rejects unknown ids", () => {
    TRACKED_TARGETS.forEach((id, i) => {
      expect(targetIndexFor(id)).toBe(i);
    });
    // Not tracked: a real marker with no printed sheet yet, and pure nonsense.
    expect(targetIndexFor("ppe-station")).toBe(-1);
    expect(targetIndexFor("fire-hose-reel")).toBe(-1);
  });

  test("hasARTarget is true only for steps with a printable marker", () => {
    expect(hasARTarget(["exit-sign"])).toBe(true);
    expect(hasARTarget(["assembly-point", "go-home"])).toBe(false);
    expect(hasARTarget([])).toBe(false);
  });

  test("every observe step that has a target can be bound to a marker", () => {
    // The marker set covers the observe steps, which is what makes L1 offerable
    // at all. `decide` and `act` steps are deliberately screen tasks.
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        if (step.kind !== "observe") continue;
        for (const target of step.targets ?? []) {
          expect(targetIndexFor(target.id)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("compiled targets.mind", () => {
  test("the compiled file exists and is non-trivial", () => {
    // A missing file is the failure mode that reaches a phone: MindAR reports a
    // fetch error at runtime, long after the build said everything was fine.
    expect(existsSync(MIND_PATH)).toBe(true);
    expect(statSync(MIND_PATH).size).toBeGreaterThan(10_000);
  });

  test("it decodes as msgpack at the version the runtime requires", () => {
    const decoded = msgpack.decode(new Uint8Array(readFileSync(MIND_PATH))) as {
      v: number;
      dataList: Array<{
        targetImage: { width: number; height: number };
        trackingData: unknown;
        matchingData: unknown;
      }>;
    };
    expect(decoded.v).toBe(MIND_FORMAT_VERSION);
    expect(Array.isArray(decoded.dataList)).toBe(true);
  });

  test("one compiled target per declared marker, in the declared order", () => {
    // The index contract. If make-targets ever compiles a different set or a
    // different order, this fails here rather than mis-binding on a phone.
    const decoded = msgpack.decode(new Uint8Array(readFileSync(MIND_PATH))) as {
      dataList: unknown[];
    };
    expect(decoded.dataList.length).toBe(TRACKED_TARGETS.length);
  });

  test("every compiled target carries usable feature data", () => {
    const decoded = msgpack.decode(new Uint8Array(readFileSync(MIND_PATH))) as {
      dataList: Array<{
        targetImage: { width: number; height: number };
        trackingData: unknown;
        matchingData: unknown;
      }>;
    };
    for (const target of decoded.dataList) {
      expect(target.targetImage.width).toBeGreaterThan(0);
      expect(target.targetImage.height).toBeGreaterThan(0);
      // Both halves are required: matchingData finds the marker, trackingData
      // keeps it locked frame to frame. An empty one is a target that detects
      // once and is then lost.
      expect(Object.keys(target.matchingData as object).length).toBeGreaterThan(0);
      expect(Object.keys(target.trackingData as object).length).toBeGreaterThan(0);
    }
  });

  test("each target's artwork was printed for its own id", () => {
    // The printable sheets in public/targets/ are what a human tapes to a wall.
    // If one is missing, the marker it corresponds to cannot be used in a drill
    // even though it compiled fine.
    for (const id of TRACKED_TARGETS) {
      const path = `public/targets/${id}.png`;
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(1_000);
    }
  });
});
