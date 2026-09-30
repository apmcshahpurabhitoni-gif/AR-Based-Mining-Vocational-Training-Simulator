/**
 * The object vocabulary of the training space.
 *
 * These are the marker ids committed in docs/05 §3, and they are the only
 * object ids this project is allowed to put in front of a trainee. Each
 * belongs to exactly one module, which is the whole point: a gas-detection
 * room that offers a fire hose reel is a room that teaches nothing, and — worse
 * — tapping it records a real gas-safety consequence against an object that
 * does not exist in the module being trained.
 *
 * The set this replaced (`fire-hose-reel`, `switchboard`, `dust-extractor`,
 * `conveyor-drive`) existed only inside the training page. It appeared in no
 * manifest, no doc and no spec, and every one of those ids was wired straight
 * into the grading path. `validate-content` now fails the build if any id
 * outside this file reaches a module.
 *
 * This is a shape vocabulary, not curriculum. It says a gas cylinder is tall
 * and round so the trainee can find it. It says nothing about what is correct
 * near one — that is what R9 is for.
 *
 * ---------------------------------------------------------------------------
 * INTERACTABLES — the second vocabulary
 * ---------------------------------------------------------------------------
 *
 * `MARKERS` is the set of things you *find*. `INTERACTABLES` is the set of
 * things you *do something to*: the extinguisher options you choose between
 * on a `decide` step, and the sequence elements you perform in order on an
 * `act` step. They are kept apart because the two are graded in opposite ways.
 *
 * A marker is a target with distractors around it, and tapping the wrong
 * marker is a miss against the module's real vocabulary. An interactable is
 * the answer surface itself — every id on it is a legitimate option the
 * manifest deliberately offered, so none of them may be scattered as scenery
 * and none may be used as a distractor.
 *
 * Collapsing the two into one list is how invented ids got in last time. An
 * option that exists in neither list cannot be drawn, and `validate-content`
 * rejects a manifest that reaches for one.
 *
 * Four ids are deliberately in both lists, within their own module:
 * `assembly-point` and the two valves are real equipment you can walk to *and*
 * real answers you can select. A valve is not scenery when choosing which
 * valve to isolate.
 */

export const MARKERS: Readonly<Record<string, readonly string[]>> = {
  FIRE: [
    "exit-sign",
    "fire-alarm",
    "extinguisher-co2",
    "extinguisher-abc",
    "extinguisher-water",
    "assembly-point",
  ],
  GAS: [
    "gas-cylinder",
    "ppe-station",
    "permit-board",
    "zone-barrier",
    "valve-main",
    "valve-isolate",
    "refuge-chamber",
  ],
};

/**
 * Every id a step's `choices[].id` and `action.elements[]` may name. This is
 * what makes all six steps of a module renderable in the 3D training
 * environment — docs/12 "every target/action must be representable in the 3D
 * training environment" and docs/13 "all six steps use semantic actions
 * compatible with the 3D training environment".
 */
export const INTERACTABLES: Readonly<Record<string, readonly string[]>> = {
  FIRE: [
    // A-03 extinguisher selection
    "co2",
    "water",
    "abc",
    "foam",
    // A-04 PASS sequence
    "pull-pin",
    "aim-base",
    "squeeze",
    "sweep",
    // A-05 withdrawal order
    "person-1",
    "person-2",
    "person-3",
    // A-06 assembly / accountability
    "assembly-point",
    "return-to-work",
    "go-home",
  ],
  GAS: [
    // B-02 respiratory protection
    "sampler",
    "cloth-mask",
    "no-ppe",
    "canvas-gloves",
    // B-03 buddy system
    "two-buddy",
    "solo-fast",
    "three-buddy",
    "supervisor-inside",
    // B-05 isolation
    "valve-main",
    "valve-isolate",
    // B-06 report / assemble
    "refuge-chamber",
    "surface-exit",
    "continue-work",
  ],
};

/** A marker's name as a label. This is the spec's name, not new copy. */
export const markerLabel = (id: string): string => id.replace(/-/g, " ");

/**
 * Same-module markers a step does not already use, capped so the room stays
 * walkable. Falls back to FIRE only for an unregistered module code, which the
 * content validator rejects separately.
 */
export function distractorsFor(code: string, used: readonly string[]): string[] {
  const pool = MARKERS[code] ?? [];
  return pool.filter((id) => !used.includes(id)).slice(0, 3);
}

/** True when `id` is a legitimate choice or sequence element for this module. */
export function isInteractable(code: string, id: string): boolean {
  return (INTERACTABLES[code] ?? []).includes(id);
}
