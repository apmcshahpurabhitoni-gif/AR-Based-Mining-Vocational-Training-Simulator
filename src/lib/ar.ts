/**
 * AR modes.
 *
 * docs/05-ar-technical-spec.md §2/§3. Four levels are specced; three ship.
 *
 *   L0 world   — full world tracking, no markers. Cut: needs a calibrated
 *                device and a prepared room, which the demo cannot assume, and
 *                WebXR immersive-ar does not exist on iOS Safari at all.
 *   L1 marker  — printed fiducials tracked in the camera feed. SHIPS. The
 *                production presentation path per docs/05 §3: the object is
 *                drawn on the real marker, over the live camera.
 *   L2 reticle — aim-and-tap against normalised screen positions. SHIPS. The
 *                fallback for a device with a camera but no printed markers.
 *   L3 guided  — non-AR, fully guided prompt. SHIPS. The mode that needs
 *                nothing prepared, and the one the demo always works in.
 *
 * The `ARMode` union keeps all four members so re-enabling L0 later is a
 * configuration change rather than a refactor.
 *
 * ---------------------------------------------------------------------------
 * The feature flag
 * ---------------------------------------------------------------------------
 *
 * `SHIPPED_MODES` is the single place that decides which levels are reachable.
 * `resolveARMode` is total: any input — an unknown string, null, undefined, or a
 * cut level like "world" — resolves to something that ships, so no caller has to
 * handle a mode that has no renderer. Removing `"marker"` from this array is a
 * complete rollback of the AR feature: the union still knows the name, requests
 * for it fall through to `guided`, and nothing else changes.
 */

export type ARMode = "world" | "marker" | "reticle" | "guided";

/** Levels that are actually implemented and reachable in the MVP. */
export const SHIPPED_MODES = ["marker", "reticle", "guided"] as const satisfies readonly ARMode[];
export type ShippedARMode = (typeof SHIPPED_MODES)[number];

/**
 * Resolve any requested mode to one that ships.
 *
 * Unknown, null, and the cut level `world` all fall back to `guided` — the mode
 * that needs nothing prepared. `marker` and `reticle` are passed through because
 * both need a camera, and whether one is actually available is a runtime
 * question answered by capability detection, not by this function.
 */
export function resolveARMode(requested: ARMode | null | undefined): ShippedARMode {
  if (requested === "marker") return "marker";
  if (requested === "reticle") return "reticle";
  return "guided";
}

/** Human-facing capability requirement, shown when we fall back. */
export function modeRequirement(mode: ShippedARMode): "camera" | "none" {
  return mode === "guided" ? "none" : "camera";
}

/** True when the mode puts a camera feed behind the training surface. */
export function modeUsesCamera(mode: ShippedARMode): boolean {
  return mode !== "guided";
}
