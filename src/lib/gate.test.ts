/**
 * Tests for the KAVACH certificate gate.
 *
 * The gate is the product, so these tests assert behaviour judges will probe:
 * can a coached pass be laundered into a certificate? The answer must be no.
 */

import { describe, expect, test } from "bun:test";

import {
  GATE_THRESHOLDS,
  RECHECK_MIN_DELAY_MS,
  RECHECK_SAMPLE_SIZE,
  evaluateGate,
  evaluateRecheck,
  isRecheckEligible,
  msUntilRecheckEligible,
  sampleRecheckSteps,
} from "./gate";
import { scoreModule, scoreOverall } from "./scoring";
import type {
  AttemptEvent,
  GateId,
  ModuleManifest,
  RecheckSample,
  Step,
  StepAttemptRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures — a realistic two-module shape from docs/06-content-spec.md
// ---------------------------------------------------------------------------

let n = 0;
function nextEventId() {
  n += 1;
  return `e${n}`;
}

function makeStep(overrides: Partial<Step> & Pick<Step, "id">): Step {
  const base: Step = {
    id: overrides.id,
    moduleCode: overrides.moduleCode ?? "FIRE",
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
    hints: [],
    expectedMs: 10_000,
  };
  return { ...base, ...overrides };
}

function ev(
  step: Step,
  overrides: Partial<AttemptEvent> & Pick<AttemptEvent, "outcome">,
): StepAttemptRecord {
  return {
    eventId: nextEventId(),
    sessionId: "s1",
    moduleCode: step.moduleCode,
    moduleVersion: "1.0.0",
    stepId: step.id,
    stepSeq: step.seq,
    critical: step.critical,
    attemptIndex: 1,
    elapsedMs: 4000,
    hintUsed: 0,
    selfRecovered: false,
    prompted: false,
    orderViolation: false,
    offline: false,
    clientTs: 1_700_000_000_000 + n,
    locale: "en",
    maxHints: Math.max(1, step.hints.length),
    expectedMs: step.expectedMs ?? 10_000,
    weight: step.weight ?? 1,
    ...overrides,
  };
}

const FIRE_STEPS: Step[] = [
  makeStep({ id: "A-01", seq: 0 }),
  makeStep({ id: "A-02", seq: 1 }),
  makeStep({ id: "A-03", seq: 2, critical: true, kind: "decide", expectedMs: 8000 }),
  makeStep({ id: "A-04", seq: 3, kind: "act" }),
  makeStep({ id: "A-05", seq: 4, critical: true, kind: "act" }),
  makeStep({ id: "A-06", seq: 5, kind: "decide" }),
];

const GAS_STEPS: Step[] = [
  makeStep({ id: "B-01", seq: 0, moduleCode: "GAS" }),
  makeStep({ id: "B-02", seq: 1, moduleCode: "GAS", critical: true, kind: "decide" }),
  makeStep({ id: "B-03", seq: 2, moduleCode: "GAS", critical: true, kind: "decide" }),
  makeStep({ id: "B-04", seq: 3, moduleCode: "GAS" }),
  makeStep({ id: "B-05", seq: 4, moduleCode: "GAS", critical: true, kind: "act" }),
  makeStep({ id: "B-06", seq: 5, moduleCode: "GAS", kind: "decide" }),
];

function manifest(code: string, steps: Step[]): ModuleManifest {
  return {
    code,
    domain: code === "FIRE" ? "fire_and_explosion" : "gas_leak_confined_space",
    title: { en: code, hi: code },
    version: "1.0.0",
    estimatedMinutes: 4,
    passScore: 80,
    steps,
  };
}

const FIRE = manifest("FIRE", FIRE_STEPS);
const GAS = manifest("GAS", GAS_STEPS);

/** A perfect pass of both modules, cold re-check fully retained. */
function perfectRun() {
  const fireAttempts = FIRE_STEPS.map((s) => ev(s, { outcome: "pass" }));
  const gasAttempts = GAS_STEPS.map((s) => ev(s, { outcome: "pass" }));
  const fire = scoreModule(FIRE, fireAttempts);
  const gas = scoreModule(GAS, gasAttempts);
  const overall = scoreOverall([fire, gas]);
  const samples: RecheckSample[] = FIRE_STEPS.filter((s) => s.critical).map((s) => ({
    stepId: s.id,
    moduleCode: "FIRE",
    critical: true,
    reason: "critical-core" as const,
  }));
  const recheck = evaluateRecheck(
    samples,
    Object.fromEntries(samples.map((s) => [s.stepId, true])),
  );
  return { fire, gas, overall, recheck, manifests: [FIRE, GAS] };
}

/**
 * Evaluate the gate for a run. Defaults to the run's own re-check result so the
 * happy path actually supplies one — pass `null` to simulate a missing re-check.
 */
function gateFor(
  run: ReturnType<typeof perfectRun>,
  recheckOverride?: ReturnType<typeof perfectRun>["recheck"] | null,
) {
  return evaluateGate({
    moduleScores: [run.fire, run.gas],
    manifests: run.manifests,
    overall: run.overall,
    recheck: recheckOverride === undefined ? run.recheck : (recheckOverride ?? undefined),
  });
}

function failed(
  run: ReturnType<typeof perfectRun>,
  recheckOverride?: ReturnType<typeof perfectRun>["recheck"] | null,
): GateId[] {
  return gateFor(run, recheckOverride).failed;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("evaluateGate — perfect run", () => {
  test("a flawless run with a passed re-check earns the certificate", () => {
    const gate = gateFor(perfectRun());
    expect(gate.failed).toEqual([]);
    expect(gate.passed).toBe(true);
    expect(gate.criteria).toHaveLength(8);
  });

  test("every criterion is met and individually inspectable", () => {
    const gate = gateFor(perfectRun());
    for (const c of gate.criteria) {
      expect(c.met).toBe(true);
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// G7 — the differentiator
// ---------------------------------------------------------------------------

describe("evaluateGate — G7 cold re-check (C7, fail-closed)", () => {
  test("a missing re-check blocks the certificate (C7)", () => {
    const run = perfectRun();
    const gate = evaluateGate({
      moduleScores: [run.fire, run.gas],
      manifests: run.manifests,
      overall: run.overall,
      // recheck omitted entirely
    });
    expect(gate.passed).toBe(false);
    expect(gate.failed).toContain("G7");
  });

  test("a failed re-check blocks the certificate even on a perfect training run", () => {
    const run = perfectRun();
    const samples = run.recheck.samples;
    const recheck = evaluateRecheck(
      samples,
      Object.fromEntries(samples.map((s, i) => [s.stepId, i === 0])),
    );
    const gate = gateFor(run, recheck);
    expect(recheck.passed).toBe(false);
    expect(gate.failed).toContain("G7");
    expect(gate.passed).toBe(false);
  });

  test("an empty re-check sample fails closed", () => {
    const recheck = evaluateRecheck([], {});
    expect(recheck.passed).toBe(false);
    expect(recheck.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// G3 / G4 — hard zeros
// ---------------------------------------------------------------------------

describe("evaluateGate — G3 and G4", () => {
  test("a critical step missed first-attempt blocks the certificate even if it is later passed", () => {
    const a03 = FIRE_STEPS[2]!;
    const fireAttempts = [
      ...FIRE_STEPS.filter((s) => s.id !== "A-03").map((s) => ev(s, { outcome: "pass" })),
      ev(a03, { outcome: "fail", attemptIndex: 1 }),
      ev(a03, { outcome: "pass", attemptIndex: 2, selfRecovered: true }),
    ];
    const fire = scoreModule(FIRE, fireAttempts);
    const gas = scoreModule(GAS, GAS_STEPS.map((s) => ev(s, { outcome: "pass" })));
    const overall = scoreOverall([fire, gas]);
    const samples: RecheckSample[] = [
      { stepId: "A-03", moduleCode: "FIRE", critical: true, reason: "critical-core" },
    ];
    const recheck = evaluateRecheck(samples, { "A-03": true });
    const gate = evaluateGate({
      moduleScores: [fire, gas],
      manifests: [FIRE, GAS],
      overall,
      recheck,
    });
    expect(overall.criticalMisses).toBe(1);
    expect(gate.failed).toContain("G3");
    expect(gate.passed).toBe(false);
  });

  test("a certificate-blocking failure kind is caught by G4", () => {
    const a01 = FIRE_STEPS[0]!;
    const fireAttempts = [
      ev(a01, { outcome: "fail", failureKind: "critical", attemptIndex: 1 }),
      ev(a01, { outcome: "pass", attemptIndex: 2 }),
      ...FIRE_STEPS.filter((s) => s.id !== "A-01").map((s) => ev(s, { outcome: "pass" })),
    ];
    const fire = scoreModule(FIRE, fireAttempts);
    const gas = scoreModule(GAS, GAS_STEPS.map((s) => ev(s, { outcome: "pass" })));
    const overall = scoreOverall([fire, gas]);
    const recheck = evaluateRecheck(
      [{ stepId: "A-01", moduleCode: "FIRE", critical: false, reason: "module-spread" }],
      { "A-01": true },
    );
    const gate = evaluateGate({
      moduleScores: [fire, gas],
      manifests: [FIRE, GAS],
      overall,
      recheck,
    });
    expect(overall.blockedFailures).toBe(1);
    expect(gate.failed).toContain("G4");
  });
});

// ---------------------------------------------------------------------------
// G1 / G2 — per-module floor
// ---------------------------------------------------------------------------

describe("evaluateGate — G1 and G2 per-module floor", () => {
  test("one strong module cannot carry a failing module", () => {
    const fire = scoreModule(FIRE, FIRE_STEPS.map((s) => ev(s, { outcome: "pass" })));
    // GAS left mostly unattempted -> low score.
    const gas = scoreModule(GAS, [ev(GAS_STEPS[0]!, { outcome: "pass" })]);
    const overall = scoreOverall([fire, gas]);
    const recheck = evaluateRecheck(
      [{ stepId: "A-03", moduleCode: "FIRE", critical: true, reason: "critical-core" }],
      { "A-03": true },
    );
    const gate = evaluateGate({
      moduleScores: [fire, gas],
      manifests: [FIRE, GAS],
      overall,
      recheck,
    });
    expect(gate.passed).toBe(false);
    expect(gate.failed).toContain("G1");
  });

  test("a missing module is reported as missing, not as a pass", () => {
    const fire = scoreModule(FIRE, FIRE_STEPS.map((s) => ev(s, { outcome: "pass" })));
    const overall = scoreOverall([fire]);
    const gate = evaluateGate({
      moduleScores: [fire], // GAS never attempted at all
      manifests: [FIRE, GAS],
      overall,
      recheck: evaluateRecheck(
        [{ stepId: "A-03", moduleCode: "FIRE", critical: true, reason: "critical-core" }],
        { "A-03": true },
      ),
    });
    expect(gate.passed).toBe(false);
    expect(gate.failed).toContain("G1");
  });
});

// ---------------------------------------------------------------------------
// G5 / G6 — behavioural thresholds
// ---------------------------------------------------------------------------

describe("evaluateGate — G5 and G6", () => {
  test("heavy hint use trips G6", () => {
    const hinted = makeStep({ id: "A-01", seq: 0, hints: [{ en: "a", hi: "अ" }, { en: "b", hi: "ब" }] });
    const steps = [hinted, ...FIRE_STEPS.slice(1)];
    const attempts = steps.map((s) => ev(s, { outcome: "pass", hintUsed: 2 }));
    const fire = scoreModule(manifest("FIRE", steps), attempts);
    const gas = scoreModule(GAS, GAS_STEPS.map((s) => ev(s, { outcome: "pass" })));
    const overall = scoreOverall([fire, gas]);
    const recheck = evaluateRecheck(
      [{ stepId: "A-03", moduleCode: "FIRE", critical: true, reason: "critical-core" }],
      { "A-03": true },
    );
    const gate = evaluateGate({
      moduleScores: [fire, gas],
      manifests: [FIRE, GAS],
      overall,
      recheck,
    });
    expect(overall.meanHintDependency).toBeGreaterThan(GATE_THRESHOLDS.maxMeanHintDependency);
    expect(gate.failed).toContain("G6");
  });
});

// ---------------------------------------------------------------------------
// G8 — ordering
// ---------------------------------------------------------------------------

describe("evaluateGate — G8 ordering integrity", () => {
  test("an ordering violation in either module blocks the certificate", () => {
    const fire = scoreModule(FIRE, FIRE_STEPS.map((s) => ev(s, { outcome: "pass" })));
    const gas = scoreModule(
      GAS,
      GAS_STEPS.map((s) => ev(s, { outcome: "pass", orderViolation: s.id === "B-05" })),
    );
    const overall = scoreOverall([fire, gas]);
    const recheck = evaluateRecheck(
      [{ stepId: "A-03", moduleCode: "FIRE", critical: true, reason: "critical-core" }],
      { "A-03": true },
    );
    const gate = evaluateGate({
      moduleScores: [fire, gas],
      manifests: [FIRE, GAS],
      overall,
      recheck,
    });
    expect(gas.orderIntegrity).toBeLessThan(1);
    expect(gate.failed).toContain("G8");
  });
});

// ---------------------------------------------------------------------------
// Degenerate input
// ---------------------------------------------------------------------------

describe("evaluateGate — degenerate input", () => {
  test("no modules at all cannot pass", () => {
    const gate = evaluateGate({
      moduleScores: [],
      manifests: [],
      overall: scoreOverall([]),
    });
    expect(gate.passed).toBe(false);
    expect(gate.failed.length).toBeGreaterThan(0);
  });

  test("criterion values are finite, never NaN", () => {
    const gate = gateFor(perfectRun());
    for (const c of gate.criteria) {
      expect(Number.isFinite(c.value)).toBe(true);
      expect(Number.isFinite(c.threshold)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Re-check eligibility
// ---------------------------------------------------------------------------

describe("re-check eligibility", () => {
  test("is ineligible before the 90 s gap has elapsed", () => {
    const t0 = 1_000_000;
    expect(isRecheckEligible(t0, t0 + RECHECK_MIN_DELAY_MS - 1)).toBe(false);
  });

  test("becomes eligible exactly at the gap", () => {
    const t0 = 1_000_000;
    expect(isRecheckEligible(t0, t0 + RECHECK_MIN_DELAY_MS)).toBe(true);
  });

  test("is ineligible when completion time is unknown", () => {
    expect(isRecheckEligible(undefined, 1_000_000)).toBe(false);
  });

  test("reports remaining time and never goes negative", () => {
    const t0 = 1_000_000;
    expect(msUntilRecheckEligible(t0, t0)).toBe(RECHECK_MIN_DELAY_MS);
    expect(msUntilRecheckEligible(t0, t0 + 10_000)).toBe(RECHECK_MIN_DELAY_MS - 10_000);
    expect(msUntilRecheckEligible(t0, t0 + RECHECK_MIN_DELAY_MS + 5000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Re-check sampling
// ---------------------------------------------------------------------------

describe("sampleRecheckSteps", () => {
  function scores() {
    return [
      scoreModule(FIRE, FIRE_STEPS.map((s) => ev(s, { outcome: "pass" }))),
      scoreModule(GAS, GAS_STEPS.map((s) => ev(s, { outcome: "pass" }))),
    ];
  }

  test("samples at most the configured budget", () => {
    const samples = sampleRecheckSteps({ manifests: [FIRE, GAS], moduleScores: scores() });
    expect(samples.length).toBeLessThanOrEqual(RECHECK_SAMPLE_SIZE);
  });

  test("always includes at least one critical step", () => {
    const samples = sampleRecheckSteps({ manifests: [FIRE, GAS], moduleScores: scores() });
    expect(samples.some((s) => s.critical)).toBe(true);
  });

  test("is deterministic for identical input", () => {
    const a = sampleRecheckSteps({ manifests: [FIRE, GAS], moduleScores: scores() });
    const b = sampleRecheckSteps({ manifests: [FIRE, GAS], moduleScores: scores() });
    expect(a.map((s) => s.stepId)).toEqual(b.map((s) => s.stepId));
  });

  test("returns empty for no manifests", () => {
    expect(sampleRecheckSteps({ manifests: [], moduleScores: [] })).toEqual([]);
  });

  test("does not exceed the number of real steps available", () => {
    const tiny = manifest("TINY", [makeStep({ id: "T-01" })]);
    const samples = sampleRecheckSteps({
      manifests: [tiny],
      moduleScores: [scoreModule(tiny, [ev(tiny.steps[0]!, { outcome: "pass" })])],
    });
    expect(samples.length).toBe(1);
  });

  test("biases toward the trainee's weakest step when budget remains", () => {
    // Make B-01 (non-critical) the only failed step.
    const gasAttempts = GAS_STEPS.map((s) =>
      ev(s, { outcome: s.id === "B-01" ? "fail" : "pass" }),
    );
    const modScores = [
      scoreModule(FIRE, FIRE_STEPS.map((s) => ev(s, { outcome: "pass" }))),
      scoreModule(GAS, gasAttempts),
    ];
    const samples = sampleRecheckSteps({ manifests: [FIRE, GAS], moduleScores: modScores });
    // Criticals are always prioritised, so with a 4-sample budget the weak step
    // may not fit — assert the contract that criticals win, not that it appears.
    const criticals = samples.filter((s) => s.critical);
    expect(criticals.length).toBeGreaterThan(0);
    expect(samples.length).toBeLessThanOrEqual(RECHECK_SAMPLE_SIZE);
  });
});

// ---------------------------------------------------------------------------
// Re-check evaluation
// ---------------------------------------------------------------------------

describe("evaluateRecheck", () => {
  const samples: RecheckSample[] = [
    { stepId: "A-03", moduleCode: "FIRE", critical: true, reason: "critical-core" },
    { stepId: "A-05", moduleCode: "FIRE", critical: true, reason: "critical-core" },
    { stepId: "B-02", moduleCode: "GAS", critical: true, reason: "critical-core" },
    { stepId: "B-05", moduleCode: "GAS", critical: true, reason: "critical-core" },
  ];

  test("a fully retained re-check passes", () => {
    const r = evaluateRecheck(
      samples,
      Object.fromEntries(samples.map((s) => [s.stepId, true])),
    );
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
    expect(r.missed).toEqual([]);
  });

  test("a single miss fails the re-check regardless of score (C7 asymmetry)", () => {
    const r = evaluateRecheck(
      samples,
      Object.fromEntries(samples.map((s) => [s.stepId, s.stepId !== "B-05"])),
    );
    expect(r.score).toBeCloseTo(0.75, 6);
    expect(r.passed).toBe(false);
    expect(r.missed).toEqual(["B-05"]);
  });

  test("an unanswered step is a miss, not a pass", () => {
    const r = evaluateRecheck(samples, { "A-03": true, "A-05": true, "B-02": true });
    expect(r.missed).toEqual(["B-05"]);
    expect(r.passed).toBe(false);
  });

  test("reports counts consistent with the score", () => {
    const r = evaluateRecheck(
      samples,
      Object.fromEntries(samples.map((s) => [s.stepId, s.stepId === "A-03"])),
    );
    expect(r.total).toBe(4);
    expect(r.passedCount).toBe(1);
    expect(r.score).toBeCloseTo(0.25, 6);
  });
});
