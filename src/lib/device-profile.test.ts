import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ROCK_RING_COUNT, ROOM } from "./environment";
import {
  describeProfile,
  isRenderTier,
  pixelCost,
  profileForTier,
  renderProfile,
  type DeviceFacts,
  type RenderTier,
} from "./device-profile";
import { readoutLines } from "./frame-stats";

/** A named device, so a failure says which phone failed. */
function device(name: string, facts: Partial<DeviceFacts> = {}): DeviceFacts {
  const base: Record<string, DeviceFacts> = {
    // A 1080×2400 Android at 2.75× — the worst common case, and the one the
    // pixel-ratio cap exists for.
    "mid-range android": { pixelRatio: 2.75, width: 412, height: 915, cores: 8, memoryGb: 4, touchPoints: 5 },
    "budget android": { pixelRatio: 2, width: 360, height: 800, cores: 4, memoryGb: 2, touchPoints: 5 },
    "flagship android": { pixelRatio: 3, width: 412, height: 915, cores: 12, memoryGb: 8, touchPoints: 5 },
    "tablet": { pixelRatio: 2, width: 800, height: 1280, cores: 8, memoryGb: 4, touchPoints: 5 },
    "laptop": { pixelRatio: 2, width: 1440, height: 900, cores: 8, touchPoints: 0 },
    "desktop 1x": { pixelRatio: 1, width: 1920, height: 1080, cores: 8, touchPoints: 0 },
  };
  const found = base[name];
  if (!found) throw new Error(`unknown device ${name}`);
  return { ...found, ...facts };
}

describe("device profile — a phone gets a different room to a laptop", () => {
  test("the mid-range Android is the target and lands on standard", () => {
    expect(renderProfile(device("mid-range android")).tier).toBe("standard");
  });

  test("a budget phone drops to low, a laptop stays high", () => {
    expect(renderProfile(device("budget android")).tier).toBe("low");
    expect(renderProfile(device("laptop")).tier).toBe("high");
  });

  test("a touch device is never given the desktop profile", () => {
    // The dangerous case: a high-resolution tablet would otherwise be handed a
    // 2× framebuffer and MSAA, because its pixel count looks like a desktop's.
    for (const name of ["flagship android", "tablet", "mid-range android"]) {
      const profile = renderProfile(device(name));
      expect(profile.maxPixelRatio).toBeLessThanOrEqual(1.5);
      expect(profile.antialias).toBe(false);
    }
  });

  test("a mouse and keyboard is never demoted to low", () => {
    expect(renderProfile(device("desktop 1x")).maxPixelRatio).toBe(2);
  });

  test("weak signals are additive, and any one of them is enough", () => {
    const base = device("mid-range android");
    expect(renderProfile({ ...base, cores: 4 }).tier).toBe("low");
    expect(renderProfile({ ...base, memoryGb: 2 }).tier).toBe("low");
    expect(renderProfile({ ...base, width: 320, height: 640 }).tier).toBe("low");
  });

  test("a device that reports nothing useful is not guessed at", () => {
    // Unknown becomes desktop, which is the safe direction: the alternative is
    // silently degrading a machine that could have coped, and a wrong
    // down-grade is invisible while a wrong up-grade is merely slow.
    const bare: DeviceFacts = { pixelRatio: 2, width: 1280, height: 800 };
    expect(renderProfile(bare).tier).toBe("high");
  });

  test("a 1280x800 laptop window is a desktop, not a tablet", () => {
    // This one was a real bug. The rule used to also demand a 900px short edge
    // before calling a device a desktop, so this very common resolution was
    // demoted to the mobile profile and lost MSAA on a machine that could
    // afford it.
    expect(renderProfile(device("desktop 1x", { width: 1280, height: 800 })).tier).toBe("high");
  });

  test("the short edge decides, not the long one", () => {
    // A phone in landscape is still a phone.
    const landscape = device("mid-range android", { width: 915, height: 412 });
    expect(renderProfile(landscape).tier).toBe("standard");
  });
});

describe("device profile — antialiasing, which cannot be changed later", () => {
  test("off on every mobile tier, on at desktop", () => {
    expect(profileForTier("low").antialias).toBe(false);
    expect(profileForTier("standard").antialias).toBe(false);
    expect(profileForTier("high").antialias).toBe(true);
  });

  test("the ratio is never capped above 2, at any tier", () => {
    // Past 2 it is fill rate for no visible gain, and a 3× flagship would
    // otherwise rasterise 2.25× the pixels of a 2× one for nothing.
    for (const tier of ["low", "standard", "high"] as RenderTier[]) {
      expect(profileForTier(tier).maxPixelRatio).toBeLessThanOrEqual(2);
    }
  });

  test("shadows survive every tier", () => {
    // Dropping them is the one "optimisation" Phase 1 refuses: contact shadows
    // are what stop a prop floating, and the saving was taken from the shadow
    // pass instead. See the header.
    for (const tier of ["low", "standard", "high"] as RenderTier[]) {
      expect(profileForTier(tier).shadowMapSize).toBeGreaterThanOrEqual(1024);
    }
  });
});

describe("device profile — the pixel arithmetic, which can be checked by hand", () => {
  test("a 2.75× phone at the old cap of 2 was still rasterising 1.65× the work", () => {
    // The old line was `min(dpr, 2)`, so this is the cost that was being paid
    // on the most common Android panel in existence.
    expect(pixelCost(2, 2.75)).toBeCloseTo((2 / 2.75) ** 2 * 100, 0);
    expect(pixelCost(2, 2.75)).toBeGreaterThan(50);
  });

  test("the standard tier more than halves the fill cost on that same phone", () => {
    expect(pixelCost(1.5, 2.75)).toBeLessThan(32);
  });

  test("a device already below the cap is not made worse", () => {
    // A 1× screen must stay at 1×, or the "optimisation" would have doubled
    // the work on exactly the devices least able to afford it.
    expect(pixelCost(1.5, 1)).toBe(100);
    expect(pixelCost(1.5, 1.25)).toBe(100);
  });

  test("a nonsense pixel ratio does not produce nonsense arithmetic", () => {
    expect(pixelCost(1.5, NaN)).toBe(100);
    expect(pixelCost(1.5, 0)).toBe(100);
    expect(Number.isFinite(pixelCost(1.5, Infinity))).toBe(true);
  });
});

describe("device profile — overriding it, so a claim can be tested on the device it shipped on", () => {
  test("only the three real tiers are accepted", () => {
    expect(isRenderTier("low")).toBe(true);
    expect(isRenderTier("standard")).toBe(true);
    expect(isRenderTier("high")).toBe(true);
    expect(isRenderTier("ultra")).toBe(false);
    expect(isRenderTier(null)).toBe(false);
    expect(isRenderTier("")).toBe(false);
  });

  test("each tier can be asked for by name", () => {
    expect(profileForTier("low").tier).toBe("low");
    expect(profileForTier("high").tier).toBe("high");
  });

  test("every profile explains itself", () => {
    for (const tier of ["low", "standard", "high"] as RenderTier[]) {
      expect(profileForTier(tier).reason.length).toBeGreaterThan(10);
    }
    expect(renderProfile(device("laptop")).reason).toContain("desktop");
    expect(renderProfile(device("mid-range android")).reason).toContain("mobile");
  });
});

describe("device profile — the readout carries its own conditions", () => {
  test("a frame rate is printed with the settings that produced it", () => {
    // "28 fps" means something very different at 1× with no MSAA than at 2×
    // with it. A screenshot without the settings is an anecdote, not a
    // measurement.
    const stats = { fps: 28, worstMs: 44, meanMs: 35.7, frames: 45 };
    const text = readoutLines(stats, 210, 180_000, "", describeProfile(profileForTier("standard")));
    expect(text).toContain("standard · 1.5x · no msaa · shadow 1024");
    expect(text).toContain("28 fps");
  });

  test("the readout still works with no profile attached", () => {
    const stats = { fps: 60, worstMs: 17, meanMs: 16.6, frames: 45 };
    const text = readoutLines(stats, 1, 1, "");
    expect(text).not.toContain("undefined");
    expect(text.startsWith("60 fps")).toBe(true);
  });
});

/**
 * Phase 1's renderer changes, guarded.
 *
 * These are source guards, and that is the only mechanism available: the
 * settings in question are WebGL context attributes and a loop bound inside an
 * effect, none of which exist without a rendering context to run in. Each one
 * below is a specific fact about the code, not a check that a word is present,
 * and each was confirmed to fail when the change is reverted.
 */
describe("phase 1 — the renderer cannot drift back to untuned constants", () => {
  const src = readFileSync("src/components/Scene3D.tsx", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  test("antialias is no longer a hard-coded true", () => {
    // It is a context attribute: it cannot be set after construction, so
    // leaving it as a literal is the bug this whole phase is about.
    expect(code).not.toMatch(/antialias:\s*true/);
    expect(code).toMatch(/antialias:\s*profileRef\.current\.antialias/);
  });

  test("the pixel ratio is capped by the profile, not by a literal", () => {
    expect(code).not.toMatch(/setPixelRatio\(Math\.min\(window\.devicePixelRatio,\s*\d+\)\)/);
    expect(code).toMatch(/setPixelRatio\(Math\.min\(window\.devicePixelRatio,\s*profileRef\.current\.maxPixelRatio\)\)/);
  });

  test("the shadow map is rendered once, not every frame", () => {
    expect(code).toMatch(/shadowMap\.autoUpdate\s*=\s*false/);
    expect(code).toMatch(/shadowMap\.needsUpdate\s*=\s*true/);
    // Once. A `needsUpdate` inside the frame loop would restore the cost the
    // `autoUpdate` line removes, and still look correct in the source.
    expect(code.match(/shadowMap\.needsUpdate\s*=\s*true/g)?.length).toBe(1);
  });

  test("the rock ring is one instanced draw, not twenty-six", () => {
    expect(code).toMatch(/new InstancedMesh\(rockGeo, rockMat, ROCK_RING_COUNT\)/);
    // The old loop body. Its return means the instancing has been undone while
    // an InstancedMesh is still in the file somewhere.
    expect(code).not.toMatch(/const rock = new Mesh\(rockGeo, rockMat\)/);
  });

  test("the rock ring count is the data layer's, so the budget is testable", () => {
    expect(code).toMatch(/ROCK_RING_COUNT/);
    // A literal 26 in the renderer would put the count back where the budget
    // cannot see it.
    expect(code).not.toMatch(/i < 26/);
    expect(ROCK_RING_COUNT).toBeGreaterThan(0);
  });

  test("the instanced ring is not pickable", () => {
    // An InstancedMesh in the pickable list raycasts all 26 boulders at once,
    // and scenery must never be gradeable.
    const pickable = code.slice(code.indexOf("pickable"), code.indexOf("pickable") + 600);
    expect(pickable).not.toMatch(/rockRing|rockGeo/);
  });

  test("the room is unchanged in size, so nothing else moved", () => {
    // Phase 1 is a performance phase. If a dimension changed, every preset,
    // every collision radius and every distance fade in the product would need
    // re-checking, and it would be invisible in a diff of a "perf" change.
    expect(ROOM.width).toBe(26);
    expect(ROOM.depth).toBe(20);
    expect(ROOM.height).toBe(4.6);
  });
});
