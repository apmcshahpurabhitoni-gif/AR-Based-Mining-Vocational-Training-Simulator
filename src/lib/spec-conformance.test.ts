/**
 * Conformance with the frozen module specifications.
 *
 * `docs/12` and `docs/13` each carry a six-step table: sequence, id, kind,
 * criticality, expected behaviour. Those two tables are the contract for what
 * each module teaches, and until this file existed nothing checked the shipped
 * manifests against them. A step could be quietly reclassified, or a critical
 * step quietly un-flagged, and the only evidence would have been someone
 * reading the JSON and the spec side by side and noticing.
 *
 * Both tables are transcribed below. Any difference between a manifest and its
 * table is a failure, *unless* it is listed in `DECLARED_DEVIATIONS` with a
 * reason — because some differences are real and known, and pretending they
 * are not would only invite someone to "fix" the spec to match the code.
 *
 * The point is asymmetric on purpose. New drift fails CI. A declared deviation
 * does not, but it cannot be forgotten either: it lives in this file with a
 * reason, which is where the next reviewer will look.
 */

import { describe, expect, test } from "bun:test";
import { MODULES, MODULE_CODES } from "./modules";
import { objectsForStep } from "./room";
import type { StepKind } from "./types";

/** One row of a spec's six-step table. */
interface SpecStep {
  /** The id the spec uses. GAS's are `G-0n`; the manifest's are `B-0n`. */
  specId: string;
  kind: StepKind;
  critical: boolean;
  /** What the spec says the trainee should demonstrate. */
  behaviour: string;
}

/** docs/12 §"Six-step structure", verbatim. */
const FIRE_SPEC: readonly SpecStep[] = [
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
const GAS_SPEC: readonly SpecStep[] = [
  {
    specId: "G-01",
    kind: "observe",
    critical: false,
    behaviour: "Recognize the gas/confined-space warning condition",
  },
  { specId: "G-02", kind: "decide", critical: true, behaviour: "Select the safe immediate response" },
  { specId: "G-03", kind: "act", critical: true, behaviour: "Raise warning/communicate the emergency" },
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

/** The spec table, keyed by module code, with the manifest id each row maps to. */
const SPECS: Readonly<Record<string, { rows: readonly SpecStep[]; manifestIds: readonly string[] }>> =
  {
    FIRE: { rows: FIRE_SPEC, manifestIds: ["A-01", "A-02", "A-03", "A-04", "A-05", "A-06"] },
    GAS: { rows: GAS_SPEC, manifestIds: ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06"] },
  };

/**
 * Differences that are real, known, and not yet resolved.
 *
 * Each key is `<module>/<step>.<field>`. A difference not listed here fails the
 * test below. Deleting an entry is how a deviation gets resolved — and for
 * `GAS/B-04.kind` it is a one-word change to `decide` if the reviewer agrees
 * that a choice between two outcomes is not a sequence.
 */
const DECLARED_DEVIATIONS: Readonly<Record<string, string>> = {
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

/** Fields this file compares. `id` is compared through the id map above. */
type Field = "kind" | "critical";

describe("manifests conform to the frozen module specs", () => {
  for (const code of MODULE_CODES) {
    const module = MODULES[code]!;
    const spec = SPECS[code];
    expect(spec).toBeDefined();
    if (!spec) continue;

    test(`${code} has one step per spec row, in order`, () => {
      expect(module.steps.length).toBe(spec.rows.length);
      expect(module.steps.map((s) => s.id)).toEqual([...spec.manifestIds]);
    });

    for (const [i, row] of spec.rows.entries()) {
      const manifestId = spec.manifestIds[i]!;
      const step = module.steps[i];
      expect(step).toBeDefined();
      if (!step) continue;

      for (const field of ["kind", "critical"] as const) {
        const declared = DECLARED_DEVIATIONS[`${code}/${manifestId}.${field}`];
        if (declared) {
          // The deviation is real, so it is asserted here rather than skipped:
          // this test should fail if the deviation is ever quietly "fixed" in
          // one direction only.
          test(`${code}/${manifestId} has a declared deviation from docs/${code === "FIRE" ? "12" : "13"}`, () => {
            expect(step[field]).not.toBe(row[field]);
            expect(declared.length).toBeGreaterThan(20);
          });
          continue;
        }

        test(`${code}/${manifestId} matches docs/${code === "FIRE" ? "12" : "13"} (${field})`, () => {
          expect(step[field]).toBe(row[field]);
        });
      }
    }
  }

  test("every declared deviation is still a real deviation", () => {
    // A deviation entry that no longer describes a difference is a lie in the
    // safety record: it says "we know this differs from the spec" about
    // something that now matches. Collect what actually differs and require the
    // two sets to be identical.
    const actual = new Set<string>();
    for (const code of MODULE_CODES) {
      const spec = SPECS[code];
      if (!spec) continue;
      spec.rows.forEach((row, i) => {
        const manifestId = spec.manifestIds[i]!;
        const step = MODULES[code]!.steps[i];
        if (!step) return;
        for (const field of ["kind", "critical"] as const) {
          if (step[field] !== row[field]) actual.add(`${code}/${manifestId}.${field}`);
        }
      });
    }
    // The GAS id-prefix deviation is not a per-step field difference, so it is
    // declared at the module level and is not part of this set.
    actual.delete("GAS/B-0n.ids");

    const declared = new Set(
      Object.keys(DECLARED_DEVIATIONS).filter((key) => !key.includes("B-0n")),
    );
    expect([...actual].sort()).toEqual([...declared].sort());
  });

  test("the GAS id prefix deviation is recorded against the real ids", () => {
    expect(DECLARED_DEVIATIONS["GAS/B-0n.ids"]).toBeDefined();
    for (const row of GAS_SPEC) {
      expect(MODULES.GAS!.steps.some((s) => s.id === row.specId)).toBe(false);
    }
  });
});

describe("a step awaiting safety review is inert everywhere", () => {
  const pending = MODULES.GAS!.steps.find((s) => s.pendingSafetyReview);
  expect(pending).toBeDefined();
  if (!pending) return;

  test("it produces no room, so nothing about it can be tapped or graded", () => {
    expect(objectsForStep(pending, "GAS", "en")).toEqual([]);
  });

  test("it is critical, so the gate shape docs/13 asks for is already in place", () => {
    // docs/13 makes this step critical. It is flagged critical now, so the day
    // the reviewer supplies the procedure the hard-fail behaviour is already
    // wired — and until then the module cannot be completed at all.
    expect(pending.critical).toBe(true);
    expect(pending.failure.kind).toBe("critical");
    expect(pending.failure.blocksCertificate).toBe(true);
  });

  test("no option in it is marked correct, because no answer is approved", () => {
    // Asserting one would be inventing a safety answer. All-false also means
    // that even if something presented this step by mistake, it could not be
    // passed.
    expect((pending.choices ?? []).every((c) => !c.correct)).toBe(true);
  });

  test("the misconception docs/13 requires is named", () => {
    // docs/13: the simulator must never imply that an untrained worker should
    // enter a suspected hazardous atmosphere to investigate. The step has to
    // capture that misconception, so the option representing it exists and is
    // tagged.
    const unsafe = (pending.choices ?? []).find((c) => c.id === "enter-to-investigate");
    expect(unsafe).toBeDefined();
    expect(unsafe!.misconception).toBe("unsafe-entry");
  });

  test("it declares itself as pending in every shipped locale", () => {
    expect(pending.instruction.en).toContain("PENDING");
    expect(pending.instruction.hi).toContain("लंबित");
  });
});
