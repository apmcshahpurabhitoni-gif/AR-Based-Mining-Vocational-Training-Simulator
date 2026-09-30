/**
 * Render profile — what this device can afford.
 *
 * Phase 1 of `docs/16-3d-environment-and-controls-plan.md`: the performance
 * floor. The room was tuned on a desktop GPU, and the target is a phone in a
 * mine. Those are not the same machine, and the two settings that were wrong
 * are the two that are decided *before* the renderer exists:
 *
 *   `antialias`   is a WebGL context attribute. It cannot be changed after
 *                 construction, so the decision has to be made here rather than
 *                 in the render loop.
 *   pixel ratio   fixes the size of the framebuffer. On a 2.75× panel, capping
 *                 at 2 still rasterises 3× the pixels of a 1.5× one. Fill rate
 *                 — not geometry — is what makes these devices slow, so this
 *                 is the single biggest lever in the whole renderer.
 *
 * The rules are data and a function rather than a constant buried in
 * `Scene3D`, because "why is antialiasing off on this phone" has to be
 * answerable by reading this file, and because a rule that cannot be tested
 * against a table of devices is a rule nobody will re-check when the target
 * handset changes.
 *
 * The one deliberate concession: shadows stay on at every tier. They are what
 * stops a prop floating, and dropping them would be a visible quality
 * regression for a cost that Phase 1 removes elsewhere — the shadow map for
 * this room's single static light is rendered once rather than every frame,
 * which takes the shadow pass to nothing without changing a pixel of it.
 */

/** A device, as far as rendering is concerned. Every field is optional. */
export interface DeviceFacts {
  /** `window.devicePixelRatio`. */
  pixelRatio: number;
  /** CSS pixels. The short edge is what decides the class of device. */
  width: number;
  height: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  /** `navigator.deviceMemory` in GB. Chromium only; undefined elsewhere. */
  memoryGb?: number;
  /** `navigator.maxTouchPoints`. */
  touchPoints?: number;
}

export type RenderTier = "low" | "standard" | "high";

export interface RenderProfile {
  tier: RenderTier;
  /** Ceiling for `devicePixelRatio`. Never above 2 — beyond that it is
   *  fill rate for no visible gain. */
  maxPixelRatio: number;
  /** WebGL context MSAA. */
  antialias: boolean;
  /** Square edge length of the directional light's shadow map. */
  shadowMapSize: number;
  /** Plain-English reason, so the choice can be argued with. */
  reason: string;
}

/**
 * Framebuffer cost against a 1× baseline.
 *
 * The single most useful number for arguing about this file: it is what the
 * plan's "70% of the pixels" claim actually means, and it is arithmetic rather
 * than a benchmark, so it can be checked by hand.
 */
export function pixelCost(cap: number, devicePixelRatio: number): number {
  const dpr = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
  const ratio = Math.min(cap, dpr) / dpr;
  return Math.round(ratio * ratio * 1000) / 10;
}

function tierFor(f: DeviceFacts): RenderTier {
  const weak =
    (f.cores !== undefined && f.cores <= 4) ||
    (f.memoryGb !== undefined && f.memoryGb <= 2);

  /*
   * Touch is the signal; screen size is not.
   *
   * An earlier version also required a 900px short edge before calling a
   * device a desktop, which silently demoted 1280×800 laptop windows — a very
   * common resolution — to the mobile profile, taking MSAA away from machines
   * that could afford it. A machine with no touch screen is not a phone
   * whatever its resolution, so that is the only question this needs to ask.
   */
  if ((f.touchPoints ?? 0) === 0) return weak ? "low" : "high";

  // A touch device. Narrow, and it is a phone that cannot afford 1.5×.
  return weak || Math.min(f.width, f.height) <= 360 ? "low" : "standard";
}

const PROFILES: Record<RenderTier, Omit<RenderProfile, "tier" | "reason">> = {
  low: { maxPixelRatio: 1, antialias: false, shadowMapSize: 1024 },
  // The target. 1.5× already supersamples, so MSAA on top of it is paying for
  // the same edges twice.
  standard: { maxPixelRatio: 1.5, antialias: false, shadowMapSize: 1024 },
  high: { maxPixelRatio: 2, antialias: true, shadowMapSize: 2048 },
};

const REASONS: Record<RenderTier, string> = {
  low: "low-power device: 1× framebuffer, no MSAA",
  standard: "mobile: 1.5× framebuffer, no MSAA (the ratio already smooths edges)",
  high: "desktop: 2× framebuffer with MSAA",
};

/** Choose a profile. Pure — the table of devices is the test's, not a real one. */
export function renderProfile(facts: DeviceFacts): RenderProfile {
  const tier = tierFor(facts);
  return { tier, ...PROFILES[tier], reason: REASONS[tier] };
}

/**
 * A profile for a named tier, for `?quality=`.
 *
 * Exists so the renderer can be compared across settings on one device, which
 * is the only way to tell whether the change was worth it. A perf claim
 * measured on a different machine than the one that shipped is not a claim
 * about the machine that shipped.
 */
export function profileForTier(tier: RenderTier): RenderProfile {
  return { tier, ...PROFILES[tier], reason: REASONS[tier] };
}

export function isRenderTier(value: string | null | undefined): value is RenderTier {
  return value === "low" || value === "standard" || value === "high";
}

/**
 * One line describing the settings, for the on-screen readout.
 *
 * A frame rate without its settings attached is not a measurement, it is an
 * anecdote — "28 fps" means something very different at 1× with no shadows
 * than at 2× with MSAA. The readout prints this above the numbers so a
 * screenshot carries its own conditions.
 */
export function describeProfile(profile: RenderProfile): string {
  return [
    profile.tier,
    `${profile.maxPixelRatio}x`,
    profile.antialias ? "msaa" : "no msaa",
    `shadow ${profile.shadowMapSize}`,
  ].join(" · ");
}

/**
 * Read this device.
 *
 * A default, not a guess: an unknown device is treated as a desktop, because
 * the alternative is silently degrading a machine that could have coped. The
 * mobile path is reached by the signal that is actually reliable — a touch
 * screen — not by a user-agent string, which lies and is a maintenance
 * liability.
 */
export function readDeviceFacts(): DeviceFacts {
  if (typeof window === "undefined") {
    return { pixelRatio: 1, width: 1280, height: 800 };
  }
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const memory = (nav as { deviceMemory?: number } | undefined)?.deviceMemory;
  return {
    pixelRatio: window.devicePixelRatio || 1,
    width: window.innerWidth,
    height: window.innerHeight,
    cores: nav?.hardwareConcurrency,
    memoryGb: typeof memory === "number" ? memory : undefined,
    touchPoints: nav?.maxTouchPoints ?? 0,
  };
}
