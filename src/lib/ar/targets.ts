/**
 * The tracked marker set, and the order the `.mind` file stores them in.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate module
 * ---------------------------------------------------------------------------
 *
 * MindAR addresses tracked images by **array index**, not by name. The runtime
 * calls `addAnchor(0)`, `addAnchor(1)` and so on, and anchor `n` is whatever
 * image was `n`th in the list given to the compiler. Nothing checks that the
 * runtime and the compiler agree about that ordering.
 *
 * So if the compile script and the AR view each kept their own copy of the list,
 * inserting a marker in the middle would silently bind every anchor after it to
 * the wrong printed image. The symptom would be an object appearing on the wrong
 * marker — which reads as a tracking bug, not a bookkeeping one, and would be
 * chased in exactly the wrong place.
 *
 * Both sides import from here instead. `scripts/make-targets.ts` iterates this
 * list to build the file; `SceneAR` calls `targetIndexFor()` to bind an object
 * to its marker. A test asserts the compiled file has one target per entry, in
 * this order.
 *
 * ---------------------------------------------------------------------------
 * Which objects have markers
 * ---------------------------------------------------------------------------
 *
 * These are the `observe` targets in the shipped manifests — the steps where a
 * trainee has to physically locate something. `decide` and `act` steps present
 * their options together for comparison or ordering, which is a screen task, not
 * a search task; they run in the 3D room. So a step with no marker in this list
 * has no AR presentation, and `SceneAR` is not offered for it.
 *
 * Extending the set is one entry here plus one PNG: `bun run make:targets`.
 */

export const TRACKED_TARGETS = [
  "exit-sign",
  "fire-alarm",
  "gas-cylinder",
  "zone-barrier",
] as const;

export type TrackedTarget = (typeof TRACKED_TARGETS)[number];

/** Printed width of a marker, in metres. Props are scaled to match this. */
export const MARKER_PRINT_M = 0.15;

/** Human label per target, used on the printable sheet. */
export const TARGET_LABELS: Readonly<Record<TrackedTarget, string>> = {
  "exit-sign": "FIRE A-01 · NEAREST EXIT",
  "fire-alarm": "FIRE A-02 · FIRE ALARM",
  "gas-cylinder": "GAS B-01 · GAS CYLINDER",
  "zone-barrier": "GAS B-04 · ZONE BARRIER",
};

/**
 * The anchor index for an object id, or -1 when it has no printed marker and
 * therefore cannot be shown in the AR view.
 */
export function targetIndexFor(id: string): number {
  return (TRACKED_TARGETS as readonly string[]).indexOf(id);
}

/** True when at least one object in a step has a marker to track. */
export function hasARTarget(ids: readonly string[]): boolean {
  return ids.some((id) => targetIndexFor(id) >= 0);
}
