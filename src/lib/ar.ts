/**
 * AR modes.
 *
 * docs/05-ar-technical-spec.md §2. Four levels were specced; two ship.
 *
 *   L0 world   — full world tracking, no markers. Cut: needs a calibrated
 *                device and a prepared room, which the demo cannot assume.
 *   L1 marker  — printed fiducials tracked in view. Cut: requires markers to be
 *                printed and placed before a session can start.
 *   L2 reticle — aim-and-tap against normalised screen positions. SHIPS. The
 *                primary mode: it needs a camera feed, nothing else.
 *   L3 guided  — non-AR, fully guided prompt. SHIPS. The fallback for devices
 *                without a usable camera, and the mode the demo always works in.
 *
 * The `ARMode` union keeps all four members so re-enabling L0/L1 later is a
 * configuration change rather than a refactor.
 */

export type ARMode = "world" | "marker" | "reticle" | "guided";

/** Levels that are actually implemented and reachable in the MVP. */
export const SHIPPED_MODES = ["reticle", "guided"] as const satisfies readonly ARMode[];
export type ShippedARMode = (typeof SHIPPED_MODES)[number];

/**
 * Resolve any requested mode to one that ships. Unknown, null, and the cut
 * levels all fall back to `guided` — the mode that needs nothing prepared.
 */
export function resolveARMode(requested: ARMode | null | undefined): ShippedARMode {
  return requested === "reticle" ? "reticle" : "guided";
}

/** Human-facing capability requirement, shown when we fall back. */
export function modeRequirement(mode: ShippedARMode): "camera" | "none" {
  return mode === "reticle" ? "camera" : "none";
}
