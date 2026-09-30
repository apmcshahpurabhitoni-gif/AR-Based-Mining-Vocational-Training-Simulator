/**
 * Content + registry tests.
 *
 * Two things are proven here:
 *   1. the shipped manifests satisfy every content rule (C3, C5, C8)
 *   2. the shipped manifests can actually clear the gate — a clean run scores
 *      100 and passes, which is the promise the demo and the certificate make
 */

import { describe, expect, test } from "bun:test";
import {
  APPROVED_CRITICAL_STEPS,
  MODULES,
  MODULE_CODES,
  getModule,
  getStep,
  isApprovedCritical,
  requireModule,
} from "./modules";
import { validateAllModules, validateManifest, formatIssues } from "./validate-content";
import { MARKERS, INTERACTABLES, distractorsFor, isInteractable } from "./markers";
import { objectsForStep } from "./room";
import { scoreModule, scoreOverall } from "./scoring";
import { evaluateGate, evaluateRecheck, sampleRecheckSteps } from "./gate";
import type { AttemptEvent, StepAttemptRecord } from "./types";
import { SHIPPED_LOCALES } from "./types";

describe("content validation", () => {
  test("shipped manifests have zero issues", () => {
    const issues = validateAllModules();
    expect(formatIssues(issues)).toBe("");
    expect(issues).toEqual([]);
  });

  test("an observe target from another module is rejected", () => {
    // Regression guard. The training room used to be furnished from a list
    // that lived only in the page, so a gas module could put a fire hose reel
    // in front of a trainee and grade a real gas consequence against it.
    const gas = requireModule("GAS");
    const step = gas.steps.find((s) => s.id === "B-01")!;
    const polluted = {
      ...gas,
      steps: gas.steps.map((s) =>
        s.id === step.id
          ? { ...s, targets: [{ ...s.targets![0]!, id: "fire-hose-reel", position: { x: 0.5, y: 0.5 } }] }
          : s,
      ),
    };
    const issues = validateManifest(polluted);
    expect(issues.some((i) => i.message.includes("fire-hose-reel"))).toBe(true);
  });

  test("every module has a marker vocabulary and no marker is shared", () => {
    const seen = new Map<string, string>();
    for (const code of MODULE_CODES) {
      const pool = MARKERS[code] ?? [];
      expect(pool.length).toBeGreaterThan(0);
      for (const marker of pool) {
        expect(seen.has(marker)).toBe(false);
        seen.set(marker, code);
      }
    }
    // Every observe target must be drawable from its own module's vocabulary.
    for (const code of MODULE_CODES) {
      const pool = new Set(MARKERS[code] ?? []);
      for (const step of MODULES[code]!.steps) {
        for (const target of step.targets ?? []) {
          expect(pool.has(target.id)).toBe(true);
        }
      }
    }
  });

  test("distractors are same-module and never the answer", () => {
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        const used = (step.targets ?? []).map((t) => t.id);
        if (used.length === 0) continue;
        const pool = new Set(MARKERS[code] ?? []);
        const picks = distractorsFor(code, used);
        expect(picks.length).toBeGreaterThan(0);
        for (const id of picks) {
          expect(used).not.toContain(id);
          expect(pool.has(id)).toBe(true);
        }
      }
    }
  });

  test("every module has an interactable vocabulary and no interactable is shared", () => {
    const seen = new Map<string, string>();
    for (const code of MODULE_CODES) {
      const pool = INTERACTABLES[code] ?? [];
      expect(pool.length).toBeGreaterThan(0);
      for (const id of pool) {
        expect(seen.has(id)).toBe(false);
        seen.set(id, code);
      }
    }
    // Every option a step can be answered with must be drawable, or the 3D
    // training environment cannot present that step at all.
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        for (const choice of step.choices ?? []) {
          expect(isInteractable(code, choice.id)).toBe(true);
        }
        for (const element of step.action?.elements ?? []) {
          expect(isInteractable(code, element)).toBe(true);
        }
      }
    }
  });

  test("a choice outside the interactable vocabulary is rejected", () => {
    // Same class of defect as the fire-hose-reel target, one surface over: an
    // option the manifest invented cannot be drawn, and a decide step whose
    // answer is not drawable is a step the 3D environment cannot deliver.
    const fire = requireModule("FIRE");
    const step = fire.steps.find((s) => s.id === "A-03")!;
    const polluted = {
      ...fire,
      steps: fire.steps.map((s) =>
        s.id === step.id
          ? { ...s, choices: [{ ...s.choices![0]!, id: "extinguisher-magic" }] }
          : s,
      ),
    };
    const issues = validateManifest(polluted);
    expect(issues.some((i) => i.message.includes("extinguisher-magic"))).toBe(true);
  });

  test("all six steps of both modules are drawable in the 3D training environment", () => {
    // docs/12: "Every target/action must be representable in the 3D training
    // environment." docs/13: "All six steps use semantic actions compatible
    // with the 3D training environment." This is the acceptance evidence for
    // both — it fails if any step loses its room.
    //
    // The one exception is a step carrying `pendingSafetyReview`, which is
    // *supposed* to have no room. It is not drawable yet because nobody has
    // approved what it would be drawing, and the assertion below is the other
    // half of that contract: a pending step has to exist, be in its sequence
    // position, and be critical. A step cannot be quietly deleted and a
    // placeholder cannot be quietly presented.
    for (const code of MODULE_CODES) {
      const module = MODULES[code]!;
      expect(module.steps.length).toBe(6);
      for (const step of module.steps) {
        const room = objectsForStep(step, code, "en");
        const ids = room.map((o) => o.id);

        if (step.pendingSafetyReview) {
          expect(room).toEqual([]);
          expect(step.critical).toBe(true);
          expect(step.failure.blocksCertificate).toBe(true);
          // And the candidates are named, so a reviewer can see what is waiting
          // for them rather than finding an empty slot.
          expect((step.choices ?? []).length).toBeGreaterThan(1);
          continue;
        }

        expect(room.length).toBeGreaterThan(0);

        if (step.kind === "observe") {
          // The target the step asks for is in the room, at its authored spot.
          for (const target of step.targets ?? []) {
            const obj = room.find((o) => o.id === target.id);
            expect(obj).toBeDefined();
            expect(obj!.authored).toBe(true);
          }
        } else if (step.kind === "decide") {
          // Every option is on the arc, and all of them are selectable — none
          // is demoted to scenery, which would grade a real option as a miss.
          expect(ids.sort()).toEqual((step.choices ?? []).map((c) => c.id).sort());
          for (const obj of room) expect(obj.role).toBe("interactable");
        } else {
          // The whole sequence, in order, numbered from one.
          expect(ids).toEqual(step.action?.elements ?? []);
          expect(room.map((o) => o.order)).toEqual(room.map((_, i) => i + 1));
        }
      }
    }
  });

  test("an act room shows progress without changing what is answerable", () => {
    const step = MODULES.FIRE!.steps.find((s) => s.id === "A-04")!;
    const fresh = objectsForStep(step, "FIRE", "en", 0);
    const partly = objectsForStep(step, "FIRE", "en", 2);
    // Same objects, same ids — only the done flags move. Tapping a completed
    // element is still a real out-of-order miss, which is the point of A-05.
    expect(partly.map((o) => o.id)).toEqual(fresh.map((o) => o.id));
    expect(fresh.every((o) => o.done === false)).toBe(true);
    expect(partly.filter((o) => o.done).map((o) => o.id)).toEqual(["pull-pin", "aim-base"]);
  });

  test("every module is registered and retrievable", () => {
    expect(MODULE_CODES.sort()).toEqual(["FIRE", "GAS"]);
    for (const code of MODULE_CODES) {
      expect(getModule(code)).toBeDefined();
      expect(requireModule(code).code).toBe(code);
    }
    expect(getModule("NOPE")).toBeUndefined();
    expect(() => requireModule("NOPE")).toThrow("Unknown module");
  });

  test("step lookup works by id", () => {
    expect(getStep("FIRE", "A-03")?.critical).toBe(true);
    expect(getStep("GAS", "A-03")).toBeUndefined();
  });

  test("critical roster matches the approved list exactly", () => {
    const flagged = MODULE_CODES.flatMap((c) =>
      MODULES[c]!.steps.filter((s) => s.critical).map((s) => s.id),
    ).sort();
    expect(flagged).toEqual([...APPROVED_CRITICAL_STEPS].sort());
    for (const id of APPROVED_CRITICAL_STEPS) {
      expect(isApprovedCritical(id)).toBe(true);
    }
    expect(isApprovedCritical("A-01")).toBe(false);
  });

  test("every shipped locale string is present on every step", () => {
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        for (const locale of SHIPPED_LOCALES) {
          expect(step.instruction[locale]?.trim().length ?? 0).toBeGreaterThan(0);
          expect(step.failure.consequence[locale]?.trim().length ?? 0).toBeGreaterThan(0);
          for (const hint of step.hints) {
            expect(hint[locale]?.trim().length ?? 0).toBeGreaterThan(0);
          }
          for (const target of step.targets ?? []) {
            expect(target.label[locale]?.trim().length ?? 0).toBeGreaterThan(0);
          }
          for (const choice of step.choices ?? []) {
            expect(choice.label[locale]?.trim().length ?? 0).toBeGreaterThan(0);
            expect(choice.consequence[locale]?.trim().length ?? 0).toBeGreaterThan(0);
          }
        }
        // `sat` is reserved and unfilled in the MVP.
        expect(step.instruction.sat).toBeUndefined();
      }
    }
  });

  test("Hindi content is not an English copy", () => {
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        expect(step.instruction.hi).not.toBe(step.instruction.en);
      }
    }
  });

  test("each answerable decide step has exactly one correct choice", () => {
    // And a step awaiting the safety reviewer has none, because naming a correct
    // answer there would be inventing a safety procedure. The rule is the same
    // rule: a decide step has one correct answer or it is not answerable yet.
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        if (step.kind !== "decide") continue;
        const correct = (step.choices ?? []).filter((c) => c.correct);
        if (step.pendingSafetyReview) {
          expect(correct).toHaveLength(0);
        } else {
          expect(correct).toHaveLength(1);
        }
      }
    }
  });

  test("seq is 0-based and contiguous", () => {
    for (const code of MODULE_CODES) {
      MODULES[code]!.steps.forEach((step, i) => {
        expect(step.seq).toBe(i);
      });
    }
  });

  test("the validator actually rejects broken content", () => {
    const broken = structuredClone(requireModule("FIRE"));
    // Strip the Hindi instruction from the first step.
    const first = broken.steps[0]!;
    delete (first.instruction as { hi?: string }).hi;
    const issues = validateManifest(broken);
    expect(issues.some((i) => i.message.includes('instruction has no "hi"'))).toBe(true);

    // Two correct answers on a decide step.
    const broken2 = structuredClone(requireModule("GAS"));
    const decide = broken2.steps.find((s) => s.kind === "decide")!;
    decide.choices![1]!.correct = true;
    const issues2 = validateManifest(broken2);
    expect(issues2.some((i) => i.message.includes("exactly one correct choice"))).toBe(true);

    // Critically-flagged step whose failure no longer blocks the certificate.
    const broken3 = structuredClone(requireModule("FIRE"));
    const crit = broken3.steps.find((s) => s.critical)!;
    crit.failure.blocksCertificate = false;
    const issues3 = validateManifest(broken3);
    expect(issues3.some((i) => i.message.includes("blocksCertificate is false"))).toBe(true);
  });
});

/** Builds a perfect, first-try attempt row for every step of a module. */
function cleanRun(moduleCode: string): StepAttemptRecord[] {
  return MODULES[moduleCode]!.steps.map(
    (step): StepAttemptRecord => ({
      eventId: `evt-${moduleCode}-${step.id}`,
      sessionId: "sess-1",
      moduleCode,
      moduleVersion: MODULES[moduleCode]!.version,
      stepId: step.id,
      stepSeq: step.seq,
      critical: step.critical,
      outcome: "pass",
      attemptIndex: 0,
      elapsedMs: step.expectedMs ?? 20000,
      hintUsed: 0,
      selfRecovered: false,
      prompted: false,
      orderViolation: false,
      offline: false,
      clientTs: 1_700_000_000_000,
      locale: "en",
      maxHints: step.maxHints ?? step.hints.length,
      expectedMs: step.expectedMs ?? 20000,
      weight: step.weight ?? 1,
    }),
  );
}

describe("shipped content clears the gate", () => {
  for (const code of MODULE_CODES) {
    test(`${code}: a clean first-try run scores 100 and passes`, () => {
      const result = scoreModule(requireModule(code), cleanRun(code));
      expect(result.score).toBe(100);
      expect(result.passed).toBe(true);
      expect(result.criticalMisses).toBe(0);
      expect(result.blockedFailures).toBe(0);
      expect(result.completeness).toBe(1);
    });
  }

  test("both modules together pass G1-G8 with no re-check misses", () => {
    const manifests = MODULE_CODES.map((c) => requireModule(c));
    const scores = manifests.map((m) => scoreModule(m, cleanRun(m.code)));
    const overall = scoreOverall(scores);

    const samples = sampleRecheckSteps({ manifests, moduleScores: scores });
    expect(samples).toHaveLength(4);

    const gate = evaluateGate({
      manifests,
      moduleScores: scores,
      overall,
      recheck: evaluateRecheck(
        samples,
        Object.fromEntries(samples.map((s) => [s.stepId, true])),
      ),
    });
    expect(gate.failed).toEqual([]);
    expect(gate.passed).toBe(true);
    expect(gate.criteria).toHaveLength(8);
  });

  test("the re-check sampler leads with critical steps from real content", () => {
    const manifests = MODULE_CODES.map((c) => requireModule(c));
    const scores = manifests.map((m) => scoreModule(m, cleanRun(m.code)));
    const samples = sampleRecheckSteps({ manifests, moduleScores: scores });

    expect(samples).toHaveLength(4);
    // Every module contributes its critical core before any spread pick.
    const criticalPicks = samples.filter((s) => s.reason === "critical-core");
    expect(criticalPicks.length).toBeGreaterThanOrEqual(2);
    expect(criticalPicks.every((s) => s.critical)).toBe(true);
    // Results are sorted by step id and contain no duplicates.
    expect([...samples].sort((a, b) => a.stepId.localeCompare(b.stepId))).toEqual(samples);
    expect(new Set(samples.map((s) => s.stepId)).size).toBe(4);
  });
});

describe("content reacts to a trainee getting it wrong", () => {
  test("picking water on A-03 costs the module score and records the misconception", () => {
    const manifest = requireModule("FIRE");
    const rows = cleanRun("FIRE");
    const idx = rows.findIndex((r) => r.stepId === "A-03");
    const clean = rows[idx]!;
    // A miss on the first attempt, then an unaided recovery.
    const failed: StepAttemptRecord = {
      ...clean,
      eventId: "evt-A-03-fail",
      outcome: "fail",
      attemptIndex: 0,
      failureKind: "critical",
      misconception: "water_on_electrical",
    };
    const recovery: StepAttemptRecord = {
      ...clean,
      eventId: "evt-A-03-retry",
      outcome: "pass",
      attemptIndex: 1,
      selfRecovered: true,
    };
    rows.splice(idx, 1, failed, recovery);

    const result = scoreModule(manifest, rows);
    expect(result.criticalMisses).toBe(1);
    expect(result.blockedFailures).toBe(1);
    // The weighted score recovers because the trainee worked it out unaided —
    // which is exactly why a score alone must never be allowed to issue a
    // certificate. G3/G4 are what block it.
    expect(result.score).toBeGreaterThanOrEqual(manifest.passScore);
    expect(result.score).toBeLessThan(100);

    const stepMetrics = result.steps.find((s) => s.stepId === "A-03")!;
    expect(stepMetrics.topMisconception).toBe("water_on_electrical");
    expect(stepMetrics.criticalMiss).toBe(true);
    expect(stepMetrics.everPassed).toBe(true);

    // The cold re-check samples exactly what went wrong.
    const samples = sampleRecheckSteps({ manifests: [manifest], moduleScores: [result] });
    expect(samples.some((s) => s.stepId === "A-03")).toBe(true);

    // ...and failing that same step again cold fails the whole re-check.
    const outcomes = Object.fromEntries(samples.map((s) => [s.stepId, s.stepId !== "A-03"]));
    const recheck = evaluateRecheck(samples, outcomes);
    expect(recheck.passed).toBe(false);
    expect(recheck.missed).toEqual(["A-03"]);
    expect(recheck.score).toBeCloseTo(0.75, 5);

    const gate = evaluateGate({
      manifests: [manifest],
      moduleScores: [result],
      overall: scoreOverall([result]),
      recheck,
    });
    expect(gate.passed).toBe(false);
    // G1 (module score) is still met — G3/G4/G7 are what deny the certificate.
    expect(gate.criteria.find((c) => c.id === "G1")?.met).toBe(true);
    expect(gate.failed).toContain("G3");
    expect(gate.failed).toContain("G4");
    expect(gate.failed).toContain("G7");

    // Retake the re-check clean and only the hard failures remain.
    const cleanRecheck = evaluateRecheck(
      samples,
      Object.fromEntries(samples.map((s) => [s.stepId, true])),
    );
    const afterRecheck = evaluateGate({
      manifests: [manifest],
      moduleScores: [result],
      overall: scoreOverall([result]),
      recheck: cleanRecheck,
    });
    expect(afterRecheck.failed.sort()).toEqual(["G3", "G4"]);
    expect(afterRecheck.passed).toBe(false);
  });

  test("an AttemptEvent converted to a record keeps every scored field", () => {
    const event: AttemptEvent = {
      eventId: "evt-x",
      sessionId: "s1",
      moduleCode: "FIRE",
      moduleVersion: "1.0.0",
      stepId: "A-01",
      stepSeq: 0,
      critical: false,
      outcome: "pass",
      attemptIndex: 0,
      elapsedMs: 9000,
      hintUsed: 0,
      selfRecovered: false,
      prompted: false,
      orderViolation: false,
      offline: true,
      clientTs: 1,
      locale: "hi",
    };
    // Round-trip through JSON is what the offline queue actually does.
    const back = JSON.parse(JSON.stringify(event)) as AttemptEvent;
    expect(back).toEqual(event);
    expect(back.locale).toBe("hi");
    expect(back.offline).toBe(true);
  });
});
