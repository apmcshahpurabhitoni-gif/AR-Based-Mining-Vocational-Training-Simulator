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
import { DECLARED_DEVIATIONS, GAS_SPEC, SPECS, type SpecStep } from "./spec-tables";

/**
 * Both step tables live in `src/lib/spec-tables.ts`, not in this file, because
 * two more consumers need the same transcription: the review-packet generator
 * prints the requirement beside the shipped content, and a human auditing the
 * simulator reads it. One copy means a correction lands in one place.
 */

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
