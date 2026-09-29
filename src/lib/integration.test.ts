/**
 * Integration test: manifest -> attempts -> scores -> gate.
 *
 * This is the shape the real system will run in, using the actual module
 * structure from docs/06-content-spec.md. It proves the two shared modules
 * compose into the demo narrative: a coached pass must NOT earn a certificate,
 * and correcting it must.
 *
 * It also pins the client/server parity contract: the same pure functions run
 * on the device for live feedback and on the server for the authoritative
 * decision, so identical inputs must produce byte-identical output.
 */

import { describe, expect, test } from "bun:test";

import { evaluateGate, evaluateRecheck, isRecheckEligible, sampleRecheckSteps } from "./gate";
import { scoreModule, scoreOverall } from "./scoring";
import type {
  AttemptEvent,
  ModuleManifest,
  RecheckSample,
  Step,
  StepAttemptRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture: the real FIRE + GAS shape from docs/06-content-spec.md
// ---------------------------------------------------------------------------

let seq = 0;
const nextId = () => `evt-${(seq += 1)}`;

function step(o: Partial<Step> & { id: string }): Step {
  return {
    moduleCode: "FIRE",
    seq: 0,
    kind: "observe",
    critical: false,
    instruction: { en: "instruction", hi: "निर्देश" },
    narrationKey: `${o.id}.en`,
    success: { type: "identify" },
    failure: {
      kind: "penalty",
      consequence: { en: "try again", hi: "फिर कोशिश करें" },
      requiresRetry: true,
      blocksCertificate: false,
    },
    hints: [
      { en: "hint one", hi: "संकेत एक" },
      { en: "hint two", hi: "संकेत दो" },
    ],
    expectedMs: 10_000,
    ...o,
  } as Step;
}

const FIRE: ModuleManifest = {
  code: "FIRE",
  domain: "fire_and_explosion",
  title: { en: "Fire & Explosion", hi: "आग एवं विस्फोट" },
  version: "1.0.0",
  estimatedMinutes: 4,
  passScore: 80,
  steps: [
    step({ id: "A-01", seq: 0 }),
    step({ id: "A-02", seq: 1 }),
    step({
      id: "A-03",
      seq: 2,
      kind: "decide",
      critical: true,
      expectedMs: 8000,
      choices: [
        {
          id: "co2",
          label: { en: "CO2 extinguisher", hi: "सीओ2 बुझावा" },
          correct: true,
          consequence: { en: "Correct", hi: "सही" },
        },
        {
          id: "water",
          label: { en: "Water extinguisher", hi: "पानी का बुझावा" },
          correct: false,
          consequence: { en: "Water conducts", hi: "पानी चालक है" },
          misconception: "water_on_electrical",
        },
      ],
    }),
    step({ id: "A-04", seq: 3, kind: "act" }),
    step({ id: "A-05", seq: 4, kind: "act", critical: true }),
    step({ id: "A-06", seq: 5, kind: "decide" }),
  ],
};

const GAS: ModuleManifest = {
  code: "GAS",
  domain: "gas_leak_confined_space",
  title: { en: "Gas Leak & Confined Space", hi: "गैस रिसाव" },
  version: "1.0.0",
  estimatedMinutes: 4,
  passScore: 80,
  steps: [
    step({ id: "B-01", seq: 0, moduleCode: "GAS" }),
    step({ id: "B-02", seq: 1, moduleCode: "GAS", kind: "decide", critical: true }),
    step({ id: "B-03", seq: 2, moduleCode: "GAS", kind: "decide", critical: true }),
    step({ id: "B-04", seq: 3, moduleCode: "GAS" }),
    step({ id: "B-05", seq: 4, moduleCode: "GAS", kind: "act", critical: true }),
    step({ id: "B-06", seq: 5, moduleCode: "GAS", kind: "decide" }),
  ],
};

function ev(s: Step, o: Partial<AttemptEvent> = {}): StepAttemptRecord {
  return {
    eventId: nextId(),
    sessionId: "session-1",
    moduleCode: s.moduleCode,
    moduleVersion: "1.0.0",
    stepId: s.id,
    stepSeq: s.seq,
    critical: s.critical,
    outcome: "pass",
    attemptIndex: 1,
    elapsedMs: 4000,
    hintUsed: 0,
    selfRecovered: false,
    prompted: false,
    orderViolation: false,
    offline: false,
    clientTs: 1_700_000_000_000 + seq,
    locale: "hi",
    maxHints: Math.max(1, s.hints.length),
    expectedMs: s.expectedMs ?? 10_000,
    weight: s.weight ?? 1,
    ...o,
  };
}

function passAll(manifest: ModuleManifest): StepAttemptRecord[] {
  return manifest.steps.map((s) => ev(s));
}

/** Run the whole pipeline the way the server would. */
function evaluateAll(
  modules: ModuleManifest[],
  attemptsByModule: Record<string, StepAttemptRecord[]>,
  recheck?: ReturnType<typeof evaluateRecheck>,
) {
  const moduleScores = modules.map((m) => scoreModule(m, attemptsByModule[m.code] ?? []));
  const overall = scoreOverall(moduleScores);
  const gate = evaluateGate({
    moduleScores,
    manifests: modules,
    overall,
    ...(recheck ? { recheck } : {}),
  });
  return { moduleScores, overall, gate };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("integration — full pipeline", () => {
  test("a clean run of both modules, re-check retained, earns the certificate", () => {
    const attempts = { FIRE: passAll(FIRE), GAS: passAll(GAS) };
    const moduleScores = [scoreModule(FIRE, attempts.FIRE), scoreModule(GAS, attempts.GAS)];
    const overall = scoreOverall(moduleScores);
    const samples = sampleRecheckSteps({ manifests: [FIRE, GAS], moduleScores });
    const recheck = evaluateRecheck(
      samples,
      Object.fromEntries(samples.map((s) => [s.stepId, true])),
    );

    const { gate } = evaluateAll([FIRE, GAS], attempts, recheck);
    expect(gate.failed).toEqual([]);
    expect(gate.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The demo narrative
// ---------------------------------------------------------------------------

describe("integration — the deliberate failure beat (docs/08 §1)", () => {
  test("a wrong extinguisher choice blocks the certificate even if later corrected", () => {
    const a03 = FIRE.steps.find((s) => s.id === "A-03")!;
    const attempts = {
      FIRE: [
        ...FIRE.steps.filter((s) => s.id !== "A-03").map((s) => ev(s)),
        // The deliberate wrong answer, then a correct retry.
        ev(a03, {
          outcome: "fail",
          attemptIndex: 1,
          failureKind: "critical",
          misconception: "water_on_electrical",
        }),
        ev(a03, { outcome: "pass", attemptIndex: 2, selfRecovered: true }),
      ],
      GAS: passAll(GAS),
    };

    const moduleScores = [scoreModule(FIRE, attempts.FIRE), scoreModule(GAS, attempts.GAS)];
    const overall = scoreOverall(moduleScores);
    const samples: RecheckSample[] = [
      { stepId: "A-03", moduleCode: "FIRE", critical: true, reason: "critical-core" },
    ];
    const recheck = evaluateRecheck(samples, { "A-03": true });
    const { gate } = evaluateAll([FIRE, GAS], attempts, recheck);

    // G3 (critical first-attempt miss) and G4 (blocking failure) both hold it.
    expect(overall.criticalMisses).toBe(1);
    expect(overall.blockedFailures).toBe(1);
    expect(gate.passed).toBe(false);
    expect(gate.failed).toContain("G3");
    expect(gate.failed).toContain("G4");
  });

  test("the misconception tag survives into the step heatmap payload", () => {
    const a03 = FIRE.steps.find((s) => s.id === "A-03")!;
    const attempts = {
      FIRE: [
        ...FIRE.steps.filter((s) => s.id !== "A-03").map((s) => ev(s)),
        ev(a03, { outcome: "fail", attemptIndex: 1, misconception: "water_on_electrical" }),
        ev(a03, { outcome: "pass", attemptIndex: 2 }),
      ],
      GAS: passAll(GAS),
    };
    const fire = scoreModule(FIRE, attempts.FIRE);
    const a03Metrics = fire.steps.find((s) => s.stepId === "A-03");
    // This is exactly the row the admin heatmap renders.
    expect(a03Metrics?.topMisconception).toBe("water_on_electrical");
  });
});

// ---------------------------------------------------------------------------
// The cold re-check, end to end
// ---------------------------------------------------------------------------

describe("integration — cold re-check blocks a coached pass", () => {
  test("passing training then failing the re-check does not issue a certificate", () => {
    const attempts = { FIRE: passAll(FIRE), GAS: passAll(GAS) };
    const moduleScores = [scoreModule(FIRE, attempts.FIRE), scoreModule(GAS, attempts.GAS)];
    const samples = sampleRecheckSteps({ manifests: [FIRE, GAS], moduleScores });
    expect(samples.length).toBeGreaterThan(0);

    // Forget exactly one step, whichever one the sampler chose. The test must
    // not assume a particular sample — only that losing any of them fails.
    const forgotten = samples[0]!.stepId;
    const outcomes = Object.fromEntries(samples.map((s) => [s.stepId, s.stepId !== forgotten]));
    const recheck = evaluateRecheck(samples, outcomes);

    expect(recheck.passed).toBe(false);
    expect(recheck.missed).toEqual([forgotten]);
    expect(recheck.score).toBeCloseTo((samples.length - 1) / samples.length, 6);

    const { gate } = evaluateAll([FIRE, GAS], attempts, recheck);
    expect(gate.passed).toBe(false);
    expect(gate.failed).toContain("G7");
  });

  test("the re-check is ineligible until 90 s after module completion", () => {
    const completedAt = 1_700_000_000_000;
    expect(isRecheckEligible(completedAt, completedAt + 30_000)).toBe(false);
    expect(isRecheckEligible(completedAt, completedAt + 90_000)).toBe(true);
  });

  test("sampling always prioritises critical steps across both modules", () => {
    const moduleScores = [scoreModule(FIRE, passAll(FIRE)), scoreModule(GAS, passAll(GAS))];
    const samples = sampleRecheckSteps({ manifests: [FIRE, GAS], moduleScores });
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((s) => s.critical)).toBe(true);
    const modules = new Set(samples.map((s) => s.moduleCode));
    expect(modules.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Offline behaviour
// ---------------------------------------------------------------------------

describe("integration — offline attempts score identically", () => {
  test("the offline flag does not change the score", () => {
    const online = passAll(FIRE);
    const offline = passAll(FIRE).map((a) => ({ ...a, offline: true }));
    expect(scoreModule(FIRE, offline)).toEqual(scoreModule(FIRE, online));
  });
});

// ---------------------------------------------------------------------------
// Parity and determinism
// ---------------------------------------------------------------------------

describe("integration — client/server parity", () => {
  test("repeated evaluation of identical input is byte-identical", () => {
    const attempts = { FIRE: passAll(FIRE), GAS: passAll(GAS) };
    const a = evaluateAll([FIRE, GAS], attempts);
    const b = evaluateAll([FIRE, GAS], attempts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("attempt ordering on the wire does not affect the result", () => {
    const ordered = { FIRE: passAll(FIRE), GAS: passAll(GAS) };
    const shuffled = {
      FIRE: [...ordered.FIRE].reverse(),
      GAS: [...ordered.GAS].reverse(),
    };
    expect(scoreModule(FIRE, shuffled.FIRE)).toEqual(scoreModule(FIRE, ordered.FIRE));
  });

  test("a manifest version bump with no matching attempts scores 0, never crashes", () => {
    const bumped: ModuleManifest = { ...FIRE, version: "2.0.0" };
    const stale = passAll(FIRE).map((a) => ({ ...a, stepId: `renamed-${a.stepId}` }));
    const result = scoreModule(bumped, stale);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });

  test("the gate never issues a certificate when no modules were attempted", () => {
    const { gate } = evaluateAll([FIRE, GAS], {});
    expect(gate.passed).toBe(false);
  });
});
