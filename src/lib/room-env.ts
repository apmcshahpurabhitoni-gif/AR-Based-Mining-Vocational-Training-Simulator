/**
 * Environment map for the bay.
 *
 * Phase 2 of `docs/16-3d-environment-and-controls-plan.md`.
 *
 * The room already used `MeshStandardMaterial` — which is three.js's
 * physically-based material, with a metalness/roughness workflow — so "PBR"
 * here was never about the material class. What was missing was everything the
 * material needs in order to *behave* physically: an environment to reflect.
 *
 * A metal with nothing to reflect is black, and a rough surface with nothing
 * to reflect gets its ambient from `AmbientLight`, which is a constant. That
 * constant is the flatness. One image-based light replaces it with an ambient
 * term that has a direction, an occlusion sense and a colour, and every PBR
 * surface in the room improves at once without a single extra light.
 *
 * It is also, by a wide margin, the cheapest quality available here: one small
 * texture generated at startup, sampled per fragment, with no shadow pass, no
 * extra draw call and no per-frame CPU work. The alternative — more point
 * lights — costs a term in every fragment's light loop, forever.
 *
 * Painted rather than loaded. `docs/04` forbids downloading assets, and an
 * equirectangular canvas of a dim rock room with a warm band of lamps near the
 * ceiling is both smaller and more controllable than any photograph would be.
 * The lamps are placed from `room-lighting.ts`, so the reflections agree with
 * the fixtures that are actually in the room.
 */

import { CEILING_LAMPS } from "./room-lighting";

/** Small on purpose. A blurred environment map gains nothing from resolution. */
export const ENV_WIDTH = 256;
export const ENV_HEIGHT = 128;

/**
 * Paint the bay as a sphere of light, for the renderer to blur into an IBL.
 *
 * Latitude layout, top to bottom: the lamp band, a lit ceiling, the walls
 * falling into rock, and near-black floor. That gradient is the room's own
 * light distribution, and blurring it produces roughly what the real room
 * would bounce.
 *
 * Returns null when there is no 2D context, which is the same rule the surface
 * textures follow: an environment map is an improvement, and a missing one must
 * degrade to the ambient light that was there before rather than to a broken
 * scene.
 */
export function paintEnvironment(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = ENV_WIDTH;
  canvas.height = ENV_HEIGHT;
  const g = canvas.getContext("2d");
  if (!g) return null;

  const H = ENV_HEIGHT;

  // The band of light near the top: the ceiling, and the lamps on it.
  const ceiling = g.createLinearGradient(0, 0, 0, H * 0.34);
  ceiling.addColorStop(0, "#2a2119");
  ceiling.addColorStop(0.55, "#171310");
  ceiling.addColorStop(1, "#0d0b0a");
  g.fillStyle = ceiling;
  g.fillRect(0, 0, ENV_WIDTH, H * 0.34);

  // Rock walls, warm and dim.
  const walls = g.createLinearGradient(0, H * 0.34, 0, H * 0.72);
  walls.addColorStop(0, "#241d17");
  walls.addColorStop(1, "#14100d");
  g.fillStyle = walls;
  g.fillRect(0, H * 0.34, ENV_WIDTH, H * 0.72 - H * 0.34);

  // Floor. Nearly black, and that is correct: a mine floor is compacted rock
  // and dust, and a bright floor bounce is what makes CG rooms look like CG.
  g.fillStyle = "#090807";
  g.fillRect(0, H * 0.72, ENV_WIDTH, H * 0.28);

  /*
   * The lamps, as soft warm blobs on the ceiling band.
   *
   * Drawn from the fixture positions rather than invented, so the highlight a
   * trainee sees on a polished handrail is the highlight of a lamp they can
   * look up and find. On a sphere, a lamp at room `x` maps to a longitude, and
   * the room is a torus, so one lamp is painted twice.
   */
  for (const lamp of CEILING_LAMPS) {
    const u = (lamp.x / 26 + 0.5 + 1) % 1;
    for (const copy of [u, (u + 1) % 1]) {
      const cx = copy * ENV_WIDTH;
      const cy = H * 0.16;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, ENV_WIDTH * 0.11);
      glow.addColorStop(0, "rgba(255, 206, 140, 0.95)");
      glow.addColorStop(0.4, "rgba(255, 176, 87, 0.35)");
      glow.addColorStop(1, "rgba(255, 176, 87, 0)");
      g.fillStyle = glow;
      g.fillRect(cx - ENV_WIDTH * 0.12, cy - ENV_WIDTH * 0.12, ENV_WIDTH * 0.24, ENV_WIDTH * 0.24);
    }
  }

  return canvas;
}
