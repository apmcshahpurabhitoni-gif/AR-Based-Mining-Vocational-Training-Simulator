/**
 * The frozen module specifications, as data.
 *
 * `docs/12` and `docs/13` each carry a six-step table and a review gate. Those
 * tables are the contract for what each module teaches, and the review gates are
 * the scope of what a safety reviewer is being asked to sign off. They are
 * transcribed here so that three consumers read the same copy:
 *
 *   1. `spec-conformance.test.ts` — fails the build if a manifest drifts from a
 *      table, unless the difference is declared below with a reason
 *   2. `scripts/make-review-packet.ts` — prints the tables beside the shipped
 *      content, so the reviewer reads the requirement and the implementation
 *      together rather than in two documents
 *   3. anyone auditing whether the simulator matches the specification
 *
 * A transcription is a liability: it can itself be wrong. So it is not a
 * judgement — it is the spec's own wording, with the deviation list beside it
 * rather than buried in a commit message.
 *
 * Nothing here imports `bun:test`, so the generator and the browser can both
 * read it. `src/lib/spec-conformance.test.ts` is the thing that holds the
 * transcription honest against the manifests.
 */

import type { StepKind } from "./types";

/** One row of a spec's six-step table. */
export interface SpecStep {
  /** The id the spec uses. GAS's are `G-0n`; the manifest's are `B-0n`. */
  specId: string;
  kind: StepKind;
  critical: boolean;
  /** What the spec says the trainee should demonstrate. Verbatim. */
  behaviour: string;
}

/** docs/12 §"Six-step structure", verbatim. */
export const FIRE_SPEC: readonly SpecStep[] = [
  { specId: "A-01", kind: "observe", critical: false, behaviour: "Identify nearest exit" },
  { specId: "A-02", kind: "observe", critical: false, behaviour: "Raise the fire alarm" },
  {
    specId: "A-03",
    kind: "decide",
    critical: true,
    behaviour: "Select the appropriate extinguisher for the defined fire scenario",
  },
  { specId: "A-04", kind: "act", critical: false, behaviour: "Execute the approved PASS sequence" },
  {
    specId: "A-05",
    kind: "act",
    critical: true,
    behaviour: "Follow the scenario-specific safe withdrawal procedure",
  },
  {
    specId: "A-06",
    kind: "decide",
    critical: false,
    behaviour: "Proceed to the designated assembly point and follow reporting instructions",
  },
];

/** docs/13 §"Six-step structure", verbatim. */
export const GAS_SPEC: readonly SpecStep[] = [
  {
    specId: "G-01",
    kind: "observe",
    critical: false,
    behaviour: "Recognize the gas/confined-space warning condition",
  },
  { specId: "G-02", kind: "decide", critical: true, behaviour: "Select the safe immediate response" },
  {
    specId: "G-03",
    kind: "act",
    critical: true,
    behaviour: "Raise warning/communicate the emergency",
  },
  {
    specId: "G-04",
    kind: "act",
    critical: true,
    behaviour: "Withdraw or remain outside the defined hazardous area as instructed",
  },
  {
    specId: "G-05",
    kind: "decide",
    critical: true,
    behaviour: "Select the approved isolation/response action",
  },
  {
    specId: "G-06",
    kind: "decide",
    critical: false,
    behaviour: "Report/assemble according to the emergency procedure",
  },
];

/** A spec document: its steps, the manifest ids they map to, and its doc number. */
export interface ModuleSpec {
  /** docs/12 or docs/13. */
  doc: string;
  /** Human title, as the spec's own heading. */
  title: string;
  rows: readonly SpecStep[];
  manifestIds: readonly string[];
  /**
   * The spec's own review gate, verbatim. This is the scope of the review, and
   * it is a release blocker in both documents.
   */
  reviewGate: readonly string[];
  /** Any safety boundary the spec states, which the content must not contradict. */
  safetyBoundary?: readonly string[];
}

export const SPECS: Readonly<Record<string, ModuleSpec>> = {
  FIRE: {
    doc: "docs/12",
    title: "FIRE Module Specification",
    rows: FIRE_SPEC,
    manifestIds: ["A-01", "A-02", "A-03", "A-04", "A-05", "A-06"],
    reviewGate: [
      "Qualified mining safety review of extinguisher mapping, PASS instruction, alarm/withdrawal procedure, assembly/accountability wording, and Hindi/Santali safety language.",
      "No claim that FIRE content is safety-validated may be made before that review.",
    ],
    safetyBoundary: [
      "The module must not encode an unconditional universal rule such as “always fight” or “always evacuate first.” Scenario conditions must determine whether the trainee is expected to raise the alarm, fight an incipient fire, withdraw, or seek assistance.",
      "Extinguisher selection must be tied to the explicitly defined fire type and available equipment and reviewed against applicable Indian mine-safety requirements.",
      "A-05 must describe the approved scenario procedure, not an invented universal “nearest first” ordering.",
    ],
  },
  GAS: {
    doc: "docs/13",
    title: "GAS Module Specification",
    rows: GAS_SPEC,
    manifestIds: ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06"],
    reviewGate: [
      "Qualified mining safety review of all procedures and language content.",
    ],
    safetyBoundary: [
      "Exact gas types, detector thresholds, respiratory-protection rules, isolation procedures, confined-space controls, and re-entry conditions must come from approved mine procedures and qualified review.",
      "The simulator must never imply that an untrained worker should enter a suspected hazardous atmosphere to investigate.",
      "Each wrong choice must map to a documented misconception. Critical unsafe actions block qualification on first attempt. Hindi/Santali wording requires appropriate language and safety review.",
    ],
  },
};

/**
 * Differences that are real, known, and not yet resolved.
 *
 * Each key is `<module>/<step>.<field>`. A difference not listed here fails
 * `spec-conformance.test.ts`. Deleting an entry is how a deviation gets
 * resolved — and for `GAS/B-04.kind` it is a one-word change to `decide` if the
 * reviewer agrees that a choice between two outcomes is not a sequence.
 */
export const DECLARED_DEVIATIONS: Readonly<Record<string, string>> = {
  "GAS/B-04.kind":
    "docs/13 labels step 4 `act`, but what it describes — 'withdraw OR remain " +
    "outside, as instructed' — is a choice between two outcomes, not an ordered " +
    "sequence. Shipping it as an `act` would assert a withdrawal order that no " +
    "approved procedure states. It is modelled as `decide` with three " +
    "candidates until the reviewer supplies the procedure. This is the " +
    "reviewer's call to overturn.",
  "GAS/B-03.kind":
    "docs/13 step 3 is `act` (raise warning / communicate the emergency). The " +
    "shipped step is a `decide` on buddy arrangement, which is closer to " +
    "docs/13 step 2's 'select the safe immediate response' than to step 3. A " +
    "raise-the-warning action is therefore not taught anywhere in GAS. " +
    "Requires approved content, so it is declared rather than invented.",
  "GAS/B-05.kind":
    "docs/13 step 5 is `decide` (select the approved isolation/response " +
    "action); the shipped step is an `act` performing the valve isolation " +
    "sequence. Same behaviour, different mechanism. Declare or correct on " +
    "review.",
  "GAS/B-0n.ids":
    "The manifest numbers GAS steps B-01..B-06; docs/13 numbers them " +
    "G-01..G-06. The ids are load-bearing — they key stored attempt records " +
    "and the re-check sampler — so renaming them is a data migration, not a " +
    "cosmetic change, and it must not happen before the reviewer signs off the " +
    "content those steps carry.",
};

/** The doc a module's spec lives in, for messages. */
export const specDocFor = (code: string): string => SPECS[code]?.doc ?? "docs/12";
