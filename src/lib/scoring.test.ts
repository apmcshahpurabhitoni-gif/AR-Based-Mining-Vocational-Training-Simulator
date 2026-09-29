/**
 * Tests for the KAVACH scoring rubric.
 *
 * These encode the behavioural contract from docs/03-product-spec.md §3.
 * If a weight or threshold changes, the spec changes with it — update both.
 */

import { describe, expect, test } from "bun:test";

import {
  RUBRIC_WEIGHTS,
  clamp01,
  computeStepMetrics,
  expectedMsFor,
  groupAttemptsByStep,
  hesitationFor,
  mean,
  scoreModule,
  scoreOverall,
} from "./scoring";
import type {
  AttemptEvent,
  ModuleManifest,
  Step,
  StepAttemptRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let eventCounter = 0;
function resetEvents() {
  eventCounter = 0;
}

function attempt(
  overrides: Partial<AttemptEvent> & Pick<AttemptEvent, "stepId" | "outcome">,
  step: Step,
): StepAttemptRecord {
  eventCounter += 1;
  return {
    eventId: `e${eventCounter}`,
    sessionId: "s1",
    moduleCode: step.moduleCode,
    moduleVersion: "1.0.0",
    stepSeq: step.seq,
    critical: step.critical,
    attemptIndex: 1,
    elapsedMs: 5000,
    hintUsed: 0,
    selfRecovered: false,
    prompted: false,
    orderViolation: false,
    offline: false,
    clientTs: 1_700_000_000_000 + eventCounter,
    locale: "en",
    maxHints: Math.max(1, step.hints.length),
    expectedMs: expectedMsFor(step),
    weight: step.weight ?? 1,
    ...overrides,
  };
}

function makeStep(overrides: Partial<Step> & Pick<Step, "id">): Step {
  const base: Step = {
    id: overrides.id,
    moduleCode: "FIRE",
    seq: 0,
    kind: "observe",
    critical: false,
    instruction: { en: "do", hi: "करो" },
    narrationKey: `${overrides.id}.en`,
    success: { type: "identify" },
    failure: {
      kind: "penalty",
      consequence: { en: "no", hi: "नहीं" },
      requiresRetry: true,
      blocksCertificate: false,
    },
    hints: [
      { en: "h1", hi: "ए" },
      { en: "h2", hi: "बी" },
    ],
    expectedMs: 10_000,
  };
  return { ...base, ...overrides };
}

function makeManifest(steps: Step[], passScore = 80): ModuleManifest {
  return {
    code: "FIRE",
    domain: "fire_and_explosion",
    title: { en: "Fire & Explosion", hi: "आग" },
    version: "1.0.0",
    estimatedMinutes: 4,
    passScore,
    steps: steps.map((s, i) => ({ ...s, seq: i })),
  };
}

/** Two plain steps, both easy. */
const easyStep = makeStep({ id: "A-01", kind: "observe" });
const easyStep2 = makeStep({ id: "A-02", kind: "observe", seq: 1 });
/** A critical decision step. */
const criticalStep = makeStep({
  id: "A-03",
  kind: "decide",
  critical: true,
  expectedMs: 8000,
  choices: [
    { id: "co2", label: { en: "CO2", hi: "सीओ2" }, correct: true, consequence: { en: "ok", hi: "ठीक" } },
  ],
});

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

describe("numeric helpers", () => {
  test("clamp01 bounds and rejects non-finite", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });

  test("mean of empty list is 0, not NaN", () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
  });

  test("rubric weights sum to 1", () => {
    const sum = Object.values(RUBRIC_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------------------
// Hesitation
// ---------------------------------------------------------------------------

describe("hesitationFor", () => {
  test("is 0 at or under the expected time", () => {
    expect(hesitationFor(5000, 10_000)).toBe(0);
    expect(hesitationFor(10_000, 10_000)).toBe(0);
  });

  test("ramps linearly to 1 at 3x expected", () => {
    // (20000 - 10000) / (2 * 10000) = 0.5
    expect(hesitationFor(20_000, 10_000)).toBeCloseTo(0.5, 6);
    expect(hesitationFor(30_000, 10_000)).toBeCloseTo(1, 6);
  });

  test("saturates above 3x expected", () => {
    expect(hesitationFor(120_000, 10_000)).toBe(1);
  });

  test("is 0 when no time budget is defined rather than dividing by zero", () => {
    expect(hesitationFor(5000, 0)).toBe(0);
    expect(hesitationFor(5000, NaN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Step metrics
// ---------------------------------------------------------------------------

describe("computeStepMetrics", () => {
  test("a step with no attempts is incomplete, never passed", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, []);
    expect(m.everPassed).toBe(false);
    expect(m.completeness).toBe(0);
    expect(m.firstAttemptAccuracy).toBe(0);
    expect(m.attemptCount).toBe(0);
    expect(m.criticalMiss).toBe(false);
  });

  test("first-attempt pass scores full firstAttemptAccuracy", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, [attempt({ stepId: "A-01", outcome: "pass" }, easyStep)]);
    expect(m.firstAttemptAccuracy).toBe(1);
    expect(m.everPassed).toBe(true);
    expect(m.completeness).toBe(1);
  });

  test("fail then pass: firstAttemptAccuracy stays 0 (C4)", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "fail", attemptIndex: 1 }, easyStep),
      attempt({ stepId: "A-01", outcome: "pass", attemptIndex: 2 }, easyStep),
    ]);
    // Passing on the retry does not erase the first-try miss.
    expect(m.firstAttemptAccuracy).toBe(0);
    expect(m.everPassed).toBe(true);
    expect(m.completeness).toBe(1);
  });

  test("self-recovery is credited for a clean pass and for an unaided recovery", () => {
    resetEvents();
    // Failing then working it out unaided is strong evidence of independence.
    const selfRecovered = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "fail", attemptIndex: 1 }, easyStep),
      attempt({ stepId: "A-01", outcome: "pass", attemptIndex: 2, selfRecovered: true }, easyStep),
    ]);
    expect(selfRecovered.selfRecovery).toBe(1);

    // A clean first-try pass is the strongest form of independence, not a
    // non-event. It must also score 1 or a flawless run can never reach 100.
    const straightPass = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "pass" }, easyStep),
    ]);
    expect(straightPass.selfRecovery).toBe(1);
  });

  test("a pass that required an external prompt earns no self-recovery credit", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "fail", attemptIndex: 1 }, easyStep),
      attempt(
        { stepId: "A-01", outcome: "pass", attemptIndex: 2, prompted: true },
        easyStep,
      ),
    ]);
    expect(m.everPassed).toBe(true);
    expect(m.selfRecovery).toBe(0);
  });

  test("critical first-attempt miss is a hard fail (C4, G3)", () => {
    resetEvents();
    const m = computeStepMetrics(criticalStep, [
      attempt({ stepId: "A-03", outcome: "fail", attemptIndex: 1 }, criticalStep),
    ]);
    expect(m.criticalMiss).toBe(true);

    const recovered = computeStepMetrics(criticalStep, [
      attempt({ stepId: "A-03", outcome: "fail", attemptIndex: 1 }, criticalStep),
      attempt({ stepId: "A-03", outcome: "pass", attemptIndex: 2 }, criticalStep),
    ]);
    expect(recovered.criticalMiss).toBe(true);
    expect(recovered.everPassed).toBe(true);
  });

  test("non-critical step never sets criticalMiss", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "fail" }, easyStep),
    ]);
    expect(m.criticalMiss).toBe(false);
  });

  test("a critical failure kind sets blockedFailure regardless of step.critical", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "fail", failureKind: "critical" }, easyStep),
    ]);
    expect(m.blockedFailure).toBe(true);
  });

  test("hint dependency uses hints consumed on the passing attempt", () => {
    resetEvents();
    // maxHints is 2 (from the fixture), 1 hint used -> 0.5
    const m = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "pass", hintUsed: 1 }, easyStep),
    ]);
    expect(m.hintDependency).toBeCloseTo(0.5, 6);
  });

  test("hint dependency is clamped at 1 when hints over-consumed", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "pass", hintUsed: 9 }, easyStep),
    ]);
    expect(m.hintDependency).toBe(1);
  });

  test("struggling on a never-passed step uses the worst observed hints", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "fail", attemptIndex: 1, hintUsed: 0 }, easyStep),
      attempt({ stepId: "A-01", outcome: "fail", attemptIndex: 2, hintUsed: 2 }, easyStep),
    ]);
    expect(m.everPassed).toBe(false);
    expect(m.hintDependency).toBeCloseTo(1, 6);
  });

  test("any ordering violation costs the point", () => {
    resetEvents();
    const m = computeStepMetrics(easyStep, [
      attempt({ stepId: "A-01", outcome: "pass", attemptIndex: 1 }, easyStep),
      attempt({ stepId: "A-01", outcome: "pass", attemptIndex: 2, orderViolation: true }, easyStep),
    ]);
    expect(m.orderIntegrity).toBe(0);
  });

  test("topMisconception picks the most frequent, earliest on ties", () => {
    resetEvents();
    const m = computeStepMetrics(criticalStep, [
      attempt({ stepId: "A-03", outcome: "fail", attemptIndex: 1, misconception: "water_on_electrical" }, criticalStep),
      attempt({ stepId: "A-03", outcome: "fail", attemptIndex: 2, misconception: "wrong_fire_class" }, criticalStep),
      attempt({ stepId: "A-03", outcome: "fail", attemptIndex: 3, misconception: "water_on_electrical" }, criticalStep),
    ]);
    expect(m.topMisconception).toBe("water_on_electrical");
  });

  test("no misconception tag when there were no tagged failures", () => {
    resetEvents();
    const m = computeStepMetrics(criticalStep, [
      attempt({ stepId: "A-03", outcome: "pass" }, criticalStep),
    ]);
    expect(m.topMisconception).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe("groupAttemptsByStep", () => {
  test("orders attempts by attemptIndex regardless of input order", () => {
    resetEvents();
    const manifest = makeManifest([easyStep, easyStep2]);
    const grouped = groupAttemptsByStep(manifest, [
      attempt({ stepId: "A-01", outcome: "pass", attemptIndex: 2 }, easyStep),
      attempt({ stepId: "A-01", outcome: "fail", attemptIndex: 1 }, easyStep),
    ]);
    const bucket = grouped.get("A-01") ?? [];
    expect(bucket.map((b) => b.attemptIndex)).toEqual([1, 2]);
    expect(bucket[0]?.outcome).toBe("fail");
  });

  test("ignores attempts for steps not in the manifest (version-bump safety)", () => {
    resetEvents();
    const manifest = makeManifest([easyStep]);
    const ghost = makeStep({ id: "A-99" });
    const grouped = groupAttemptsByStep(manifest, [
      attempt({ stepId: "A-99", outcome: "pass" }, ghost),
    ]);
    expect(grouped.get("A-99")).toBeUndefined();
    expect(grouped.get("A-01")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Module score
// ---------------------------------------------------------------------------

describe("scoreModule", () => {
  test("a flawless fast run scores 100", () => {
    resetEvents();
    const manifest = makeManifest([easyStep, easyStep2]);
    const attempts = [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000 }, easyStep),
      attempt({ stepId: "A-02", outcome: "pass", elapsedMs: 4000 }, easyStep2),
    ];
    const result = scoreModule(manifest, attempts);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.criticalMisses).toBe(0);
    expect(result.completeness).toBe(1);
    expect(result.selfRecoveryRate).toBe(1);
  });

  test("an unattempted step earns no credit from its inverted metrics", () => {
    resetEvents();
    // hintDependency and hesitation are both 0 for an untouched step. Because
    // they are inverted weights, naive arithmetic would award ~20% for
    // restraint never demonstrated. A skipped step must score 0.
    const m = computeStepMetrics(easyStep, []);
    expect(m.hintDependency).toBe(0);
    expect(m.hesitation).toBe(0);
    expect(scoreModule(makeManifest([easyStep]), []).score).toBe(0);
  });

  test("an unattempted module scores 0 and does not pass", () => {
    resetEvents();
    const result = scoreModule(makeManifest([easyStep, easyStep2]), []);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.completeness).toBe(0);
  });

  test("half-completed module is capped below the pass threshold", () => {
    resetEvents();
    const manifest = makeManifest([easyStep, easyStep2]);
    const result = scoreModule(manifest, [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000 }, easyStep),
    ]);
    // One of two steps never attempted -> roughly half the score, since an
    // unattempted step contributes 0 rather than partial credit.
    expect(result.score).toBeLessThan(80);
    expect(result.passed).toBe(false);
  });

  test("fail-then-pass with no hints still loses the firstAttempt weight", () => {
    resetEvents();
    const clean = scoreModule(makeManifest([easyStep]), [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000 }, easyStep),
    ]);
    const recovered = scoreModule(makeManifest([easyStep]), [
      attempt({ stepId: "A-01", outcome: "fail", attemptIndex: 1, elapsedMs: 4000 }, easyStep),
      attempt(
        { stepId: "A-01", outcome: "pass", attemptIndex: 2, elapsedMs: 4000, selfRecovered: true },
        easyStep,
      ),
    ]);
    expect(recovered.score).toBeLessThan(clean.score);
  });

  test("hint usage lowers the score (inverted weight)", () => {
    resetEvents();
    const noHints = scoreModule(makeManifest([easyStep]), [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000, hintUsed: 0 }, easyStep),
    ]);
    const allHints = scoreModule(makeManifest([easyStep]), [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000, hintUsed: 2 }, easyStep),
    ]);
    expect(allHints.score).toBeLessThan(noHints.score);
  });

  test("hesitation lowers the score (inverted weight)", () => {
    resetEvents();
    const fast = scoreModule(makeManifest([easyStep]), [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000 }, easyStep),
    ]);
    const slow = scoreModule(makeManifest([easyStep]), [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 40_000 }, easyStep),
    ]);
    expect(slow.score).toBeLessThan(fast.score);
  });

  test("ordering violation lowers the score", () => {
    resetEvents();
    const ordered = scoreModule(makeManifest([easyStep]), [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000 }, easyStep),
    ]);
    const outOfOrder = scoreModule(makeManifest([easyStep]), [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000, orderViolation: true }, easyStep),
    ]);
    expect(outOfOrder.score).toBeLessThan(ordered.score);
  });

  test("critical miss and blocked failures are counted", () => {
    resetEvents();
    const result = scoreModule(makeManifest([criticalStep]), [
      attempt({ stepId: "A-03", outcome: "fail", failureKind: "critical" }, criticalStep),
    ]);
    expect(result.criticalMisses).toBe(1);
    expect(result.blockedFailures).toBe(1);
  });

  test("step weights let a critical step dominate its module", () => {
    resetEvents();
    const light = makeStep({ id: "A-03", critical: true, weight: 1 });
    const heavy = makeStep({ id: "A-03", critical: true, weight: 10 });
    const failLight = scoreModule(makeManifest([light]), [
      attempt({ stepId: "A-03", outcome: "fail" }, light),
    ]);
    const failHeavy = scoreModule(makeManifest([heavy]), [
      attempt({ stepId: "A-03", outcome: "fail" }, heavy),
    ]);
    // A single-step module fails either way, so assert the weight mechanism
    // directly via a mixed module instead.
    const mixedLight = makeManifest([light, makeStep({ id: "A-04", seq: 1 })]);
    const mixedHeavy = makeManifest([heavy, makeStep({ id: "A-04", seq: 1 })]);
    resetEvents();
    const lightRun = scoreModule(mixedLight, [
      attempt({ stepId: "A-03", outcome: "fail" }, light),
      attempt({ stepId: "A-04", outcome: "pass", elapsedMs: 4000 }, makeStep({ id: "A-04" })),
    ]);
    resetEvents();
    const heavyRun = scoreModule(mixedHeavy, [
      attempt({ stepId: "A-03", outcome: "fail" }, heavy),
      attempt({ stepId: "A-04", outcome: "pass", elapsedMs: 4000 }, makeStep({ id: "A-04" })),
    ]);
    expect(heavyRun.score).toBeLessThan(lightRun.score);
    expect(failLight.score).toBeLessThanOrEqual(100);
    expect(failHeavy.score).toBeLessThanOrEqual(100);
  });

  test("score is always an integer within 0..100", () => {
    resetEvents();
    const manifest = makeManifest([easyStep, easyStep2, criticalStep]);
    for (const outcome of ["pass", "fail"] as const) {
      const s = scoreModule(manifest, [
        attempt({ stepId: "A-01", outcome, elapsedMs: 7331 }, easyStep),
        attempt({ stepId: "A-02", outcome, elapsedMs: 9999 }, easyStep2),
        attempt({ stepId: "A-03", outcome, elapsedMs: 5555 }, criticalStep),
      ]);
      expect(Number.isInteger(s.score)).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Overall
// ---------------------------------------------------------------------------

describe("scoreOverall", () => {
  test("empty input is all zeros, not NaN", () => {
    const overall = scoreOverall([]);
    expect(overall.overallScore).toBe(0);
    expect(overall.firstAttemptAccuracy).toBe(0);
    expect(overall.criticalMisses).toBe(0);
  });

  test("pools step metrics across modules and sums hard failures", () => {
    resetEvents();
    const m1 = scoreModule(makeManifest([easyStep, easyStep2]), [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 4000 }, easyStep),
      attempt({ stepId: "A-02", outcome: "pass", elapsedMs: 4000 }, easyStep2),
    ]);
    const m2 = scoreModule(
      makeManifest([makeStep({ id: "B-01", moduleCode: "GAS", critical: true })]),
      [attempt({ stepId: "B-01", outcome: "fail" }, makeStep({ id: "B-01", moduleCode: "GAS", critical: true }))],
    );
    const overall = scoreOverall([m1, m2]);
    expect(overall.criticalMisses).toBe(1);
    // Three steps, one first-attempt pass out of two, one outright fail.
    expect(overall.firstAttemptAccuracy).toBeCloseTo(2 / 3, 6);
  });

  test("is deterministic across repeated evaluation of the same data", () => {
    resetEvents();
    const manifest = makeManifest([easyStep, easyStep2]);
    const attempts = [
      attempt({ stepId: "A-01", outcome: "pass", elapsedMs: 6123 }, easyStep),
      attempt({ stepId: "A-02", outcome: "pass", elapsedMs: 4455 }, easyStep2),
    ];
    const a = scoreModule(manifest, attempts);
    const b = scoreModule(manifest, attempts);
    expect(a.score).toBe(b.score);
    expect(a.steps.map((s) => s.firstAttemptAccuracy)).toEqual(
      b.steps.map((s) => s.firstAttemptAccuracy),
    );
  });
});
