/**
 * Runner state machine tests.
 *
 * These are the load-bearing tests for the product: the reducer is what runs
 * on a phone with no network, and every field it stamps on an AttemptEvent is
 * later consumed by the rubric and by the certificate gate.
 */

import { describe, expect, test } from "bun:test";
import {
  createRunnerState,
  runnerReduce,
  currentStep,
  currentRuntime,
  hintsRemaining,
  nextHint,
  selectSteps,
  toStepRecords,
  recheckOutcomes,
  isFullyGraded,
  t,
  progress,
  type RunnerEnv,
  type RunnerState,
} from "./runner";
import { MODULES, requireModule } from "./modules";
import { scoreModule, scoreOverall } from "./scoring";
import { evaluateGate, evaluateRecheck, sampleRecheckSteps } from "./gate";
import { resolveARMode, SHIPPED_MODES, type ARMode } from "./ar";
import type { Locale, ModuleManifest, Step } from "./types";

const FIRE = requireModule("FIRE");
const GAS = requireModule("GAS");

/** Deterministic env: clock and event ids are fully controlled. */
function makeEnv(startTime = 1_000_000, offline = false) {
  let now = startTime;
  let counter = 0;
  const env: RunnerEnv = {
    now,
    offline,
    newEventId: () => `evt-${String(++counter).padStart(4, "0")}`,
  };
  const advance = (ms: number) => {
    now += ms;
    env.now = now;
  };
  return { env, advance };
}

function start(manifest: ModuleManifest, locale: Locale = "en", at = 1_000_000) {
  const { env, advance } = makeEnv(at);
  const state = createRunnerState(manifest, {
    sessionId: "sess-1",
    locale,
    phase: "training",
    now: env.now,
  });
  return { state, env, advance };
}

/**
 * GAS with the pending step treated as if the reviewer had approved it.
 *
 * This is a **test fixture**, not content. GAS step 4 is a critical step whose
 * procedure, scenario and answer key are the safety reviewer's to supply, and
 * the real manifest is deliberately stuck on that step so no certificate can be
 * issued for the module. That is correct for the product and useless for tests
 * of machinery that does not care what the answer is — re-check sampling, gate
 * thresholds, offline sync, misconception reporting. Those need a module that
 * can actually be driven to the end, so they use this copy, which marks one
 * option correct and clears the flag.
 *
 * Nothing here reaches a trainee. The shipped manifest stays pending, and
 * `spec-conformance.test.ts` asserts that it does.
 */
const GAS_REVIEWED: ModuleManifest = {
  ...GAS,
  steps: GAS.steps.map((step) =>
    step.pendingSafetyReview
      ? {
          ...step,
          pendingSafetyReview: false,
          choices: step.choices?.map((c) => ({
            ...c,
            correct: c.id === "withdraw-from-hazard",
            misconception: c.misconception ?? "reviewed-outcome",
          })),
        }
      : step,
  ),
};

/** True when the run has stopped at a step nothing can answer. */
function stalledOnPendingReview(state: RunnerState, manifest: ModuleManifest): boolean {
  return currentStep(state, manifest)?.pendingSafetyReview === true;
}

/** Drive the runner through a step correctly. */
function solveStep(state: RunnerState, env: RunnerEnv, manifest: ModuleManifest, advance: (ms: number) => void) {
  const step = currentStep(state, manifest)!;
  // A step awaiting the qualified safety reviewer has no approved answer, so
  // there is nothing to dispatch. This mirrors the product: the training page
  // renders no options for it, and the runner cannot resolve it.
  if (step.pendingSafetyReview) return { state, step };
  advance(2000);
  if (step.kind === "observe") {
    for (const target of step.success.requiredTargets ?? []) {
      state = runnerReduce(state, { type: "tapTarget", targetId: target }, env, manifest);
    }
  } else if (step.kind === "decide") {
    const correct = step.choices!.find((c) => c.correct)!;
    state = runnerReduce(state, { type: "choose", choiceId: correct.id }, env, manifest);
  } else {
    for (const el of step.action!.elements) {
      state = runnerReduce(state, { type: "perform", elementId: el }, env, manifest);
    }
  }
  return { state, step };
}

/** Run a whole module with a perfect trainee. */
function runClean(manifest: ModuleManifest, locale: Locale = "en"): RunnerState {
  const { state, env, advance } = start(manifest, locale);
  let s = state;
  let guard = 0;
  while (!s.complete) {
    if (++guard > 500) throw new Error("runClean did not terminate");
    // A "clean run" stops at a step awaiting safety review, because that step
    // cannot be answered cleanly or otherwise. See GAS_REVIEWED.
    if (stalledOnPendingReview(s, manifest)) break;
    s = solveStep(s, env, manifest, advance).state;
    s = runnerReduce(s, { type: "continue" }, env, manifest);
  }
  return s;
}

/**
 * Run a whole module, getting one named step wrong on its FIRST attempt only,
 * then recovering unaided. The retry is deliberate: it is what makes the
 * "score recovers but the gate still blocks" assertion meaningful.
 */
function runWithMistake(manifest: ModuleManifest, wrongStepId: string, wrongChoiceId?: string) {
  const { state, env, advance } = start(manifest);
  let s = state;
  let guard = 0;
  while (!s.complete) {
    if (++guard > 500) throw new Error("runWithMistake did not terminate");
    const step = currentStep(s, manifest)!;
    if (step.pendingSafetyReview) break;
    advance(2000);

    const firstAttempt = (currentRuntime(s, manifest)?.attemptIndex ?? 0) === 0;
    if (step.id === wrongStepId && firstAttempt) {
      if (step.kind === "decide") {
        const wrong =
          step.choices!.find((c) => !c.correct && c.id === wrongChoiceId) ??
          step.choices!.find((c) => !c.correct)!;
        s = runnerReduce(s, { type: "choose", choiceId: wrong.id }, env, manifest);
      } else if (step.kind === "observe") {
        s = runnerReduce(s, { type: "tapTarget", targetId: "not-the-target" }, env, manifest);
      } else {
        // Any out-of-order act element fails the attempt.
        s = runnerReduce(s, { type: "perform", elementId: "not-a-real-element" }, env, manifest);
      }
      s = runnerReduce(s, { type: "continue" }, env, manifest);
      continue;
    }

    s = solveStep(s, env, manifest, advance).state;
    s = runnerReduce(s, { type: "continue" }, env, manifest);
  }
  return s;
}

describe("runner — construction", () => {
  test("a fresh runner starts at step 0 with no events", () => {
    const { state } = start(FIRE);
    expect(state.cursor).toBe(0);
    expect(state.events).toEqual([]);
    expect(state.complete).toBe(false);
    expect(currentStep(state, FIRE)?.id).toBe("A-01");
  });

  test("every shipped mode is reachable and the cut level is not", () => {
    // The feature flag in one assertion: each member of SHIPPED_MODES must be
    // both requested and resolved, so adding a level to the array without
    // teaching this function about it fails here rather than on a phone.
    for (const mode of SHIPPED_MODES) {
      expect(resolveARMode(mode)).toBe(mode);
    }
    expect(SHIPPED_MODES).toContain("marker");
    // L0 stays cut, and any unknown input resolves to the mode needing nothing.
    expect(resolveARMode("world")).toBe("guided");
    expect(resolveARMode(null)).toBe("guided");
    expect(resolveARMode(undefined)).toBe("guided");
    // The union still carries the cut level, so re-enabling it is config not a
    // refactor — docs/05 §2.
    const stillInTheUnion: ARMode = "world";
    expect(stillInTheUnion).toBe("world");
  });

  test("AR mode can be switched mid-run and falls back safely", () => {
    const { state, env } = start(FIRE);
    expect(state.arMode).toBe("guided");
    const next = runnerReduce(state, { type: "setArMode", mode: "reticle" }, env, FIRE);
    expect(next.arMode).toBe("reticle");
    const back = runnerReduce(next, { type: "setArMode", mode: "world" }, env, FIRE);
    expect(back.arMode).toBe("guided");
  });

  test("t() falls back to English for the unfilled sat locale", () => {
    expect(t({ en: "Exit", hi: "निकास" }, "en")).toBe("Exit");
    expect(t({ en: "Exit", hi: "निकास" }, "hi")).toBe("निकास");
    expect(t({ en: "Exit", hi: "निकास" }, "sat")).toBe("Exit");
  });

  test("selectSteps keeps original order and seq", () => {
    const subset = selectSteps(GAS, ["B-05", "B-02"]);
    expect(subset.steps.map((s) => s.id)).toEqual(["B-02", "B-05"]);
    expect(subset.steps.map((s) => s.seq)).toEqual([1, 4]);
    expect(subset.code).toBe("GAS");
  });
});

describe("runner — observe steps", () => {
  test("tapping the required target passes and emits one event", () => {
    const { state, env, advance } = start(FIRE);
    advance(4000);
    let s = runnerReduce(state, { type: "tapTarget", targetId: "exit-sign" }, env, FIRE);
    const rt = currentRuntime(s, FIRE)!;
    expect(rt.resolved).toBe(true);
    expect(rt.passed).toBe(true);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({
      stepId: "A-01",
      outcome: "pass",
      attemptIndex: 0,
      elapsedMs: 4000,
      hintUsed: 0,
      prompted: false,
      selfRecovered: false,
      orderViolation: false,
      offline: false,
      locale: "en",
      critical: false,
      stepSeq: 0,
    });
  });

  test("tapping the wrong target fails with the step's consequence", () => {
    const { state, env, advance } = start(FIRE);
    advance(1000);
    const s = runnerReduce(state, { type: "tapTarget", targetId: "some-other-thing" }, env, FIRE);
    expect(currentRuntime(s, FIRE)!.passed).toBe(false);
    expect(s.events[0]!.failureKind).toBe("penalty");
    expect(s.outcomes["A-01"]).toBe(false);
  });

  test("tapping the same target twice does not double-count", () => {
    const { state, env, advance } = start(FIRE);
    advance(500);
    const once = runnerReduce(state, { type: "tapTarget", targetId: "exit-sign" }, env, FIRE);
    const twice = runnerReduce(once, { type: "tapTarget", targetId: "exit-sign" }, env, FIRE);
    expect(twice.events).toHaveLength(1);
  });
});

describe("runner — decide steps", () => {
  test("the correct choice passes with no misconception tag", () => {
    const s = runWithMistake(FIRE, "A-06");
    const a06 = s.events.filter((e) => e.stepId === "A-06").at(-1)!;
    expect(a06.outcome).toBe("pass");
    expect(a06.misconception).toBeUndefined();
    expect(a06.failureKind).toBeUndefined();
  });

  test("the wrong choice fails, stamps the misconception, and forces a retry", () => {
    const { state, env, advance } = start(FIRE);
    let s = state;
    // A-01, A-02 clean.
    for (let i = 0; i < 2; i++) {
      s = solveStep(s, env, FIRE, advance).state;
      s = runnerReduce(s, { type: "continue" }, env, FIRE);
    }
    expect(currentStep(s, FIRE)!.id).toBe("A-03");

    advance(2000);
    s = runnerReduce(s, { type: "choose", choiceId: "water" }, env, FIRE);
    const rt = currentRuntime(s, FIRE)!;
    expect(rt.passed).toBe(false);
    expect(rt.misconception).toBe("water_on_electrical");
    expect(rt.feedback).toContain("conducts");
    expect(s.events.at(-1)).toMatchObject({
      stepId: "A-03",
      outcome: "fail",
      attemptIndex: 0,
      failureKind: "critical",
      misconception: "water_on_electrical",
    });
    expect(s.outcomes["A-03"]).toBe(false);

    // Continue -> retry, attempt index up, counters reset.
    s = runnerReduce(s, { type: "continue" }, env, FIRE);
    const retried = currentRuntime(s, FIRE)!;
    expect(retried.attemptIndex).toBe(1);
    expect(retried.resolved).toBe(false);
    expect(retried.satisfiedTargets).toEqual([]);
    expect(s.cursor).toBe(2);

    // The retry succeeds, unaided -> selfRecovered.
    advance(1500);
    s = runnerReduce(s, { type: "choose", choiceId: "co2" }, env, FIRE);
    const retryEvent = s.events.at(-1)!;
    expect(retryEvent.outcome).toBe("pass");
    expect(retryEvent.attemptIndex).toBe(1);
    expect(retryEvent.selfRecovered).toBe(true);
    expect(retryEvent.failureKind).toBeUndefined();
    expect(retryEvent.misconception).toBeUndefined();
    // ...but the first-attempt grade is NOT erased.
    expect(s.outcomes["A-03"]).toBe(false);
    // Two rows for one step: append-only, never rewritten.
    expect(s.events.filter((e) => e.stepId === "A-03")).toHaveLength(2);
  });

  test("a hint consumed on the retry clears selfRecovered and sets prompted", () => {
    const { state, env, advance } = start(GAS);
    let s = state;
    s = solveStep(s, env, GAS, advance).state;
    s = runnerReduce(s, { type: "continue" }, env, GAS);
    expect(currentStep(s, GAS)!.id).toBe("B-02");

    s = runnerReduce(s, { type: "choose", choiceId: "cloth-mask" }, env, GAS);
    expect(s.outcomes["B-02"]).toBe(false);
    s = runnerReduce(s, { type: "continue" }, env, GAS);
    expect(currentRuntime(s, GAS)!.attemptIndex).toBe(1);

    expect(hintsRemaining(s, currentStep(s, GAS)!)).toBe(1);
    expect(nextHint(s, GAS)).toContain("closed-circuit");
    s = runnerReduce(s, { type: "hint" }, env, GAS);
    expect(hintsRemaining(s, currentStep(s, GAS)!)).toBe(0);

    advance(1000);
    s = runnerReduce(s, { type: "choose", choiceId: "sampler" }, env, GAS);
    const ev = s.events.at(-1)!;
    expect(ev.outcome).toBe("pass");
    expect(ev.attemptIndex).toBe(1);
    expect(ev.hintUsed).toBe(1);
    expect(ev.prompted).toBe(true);
    // A pass that needed help is not self-recovery.
    expect(ev.selfRecovered).toBe(false);
  });

  test("hints are capped at maxHints", () => {
    const { state, env } = start(FIRE);
    let s = state;
    for (let i = 0; i < 10; i++) {
      s = runnerReduce(s, { type: "hint" }, env, FIRE);
    }
    expect(s.hintsUsed).toBe(3); // A-01 has 3 hints
    expect(nextHint(s, FIRE)).toBeUndefined();
  });
});

describe("runner — act steps and ordering", () => {
  test("the correct sequence passes and records no order violation", () => {
    const { state, env, advance } = start(FIRE);
    let s = state;
    // Skip to A-04 (PASS technique).
    while (currentStep(s, FIRE)!.id !== "A-04") {
      s = solveStep(s, env, FIRE, advance).state;
      s = runnerReduce(s, { type: "continue" }, env, FIRE);
    }
    advance(1000);
    for (const el of ["pull-pin", "aim-base", "squeeze", "sweep"]) {
      s = runnerReduce(s, { type: "perform", elementId: el }, env, FIRE);
    }
    expect(currentRuntime(s, FIRE)!.passed).toBe(true);
    expect(s.events.at(-1)!.orderViolation).toBe(false);
    expect(s.events.at(-1)!.stepId).toBe("A-04");
  });

  test("one out-of-order element fails the attempt and sticks", () => {
    const { state, env, advance } = start(FIRE);
    let s = state;
    while (currentStep(s, FIRE)!.id !== "A-04") {
      s = solveStep(s, env, FIRE, advance).state;
      s = runnerReduce(s, { type: "continue" }, env, FIRE);
    }
    advance(500);
    s = runnerReduce(s, { type: "perform", elementId: "pull-pin" }, env, FIRE);
    s = runnerReduce(s, { type: "perform", elementId: "squeeze" }, env, FIRE); // wrong
    expect(s.events.at(-1)).toMatchObject({ outcome: "fail", orderViolation: true });
    expect(currentRuntime(s, FIRE)!.orderViolation).toBe(true);
    // A later correct tap in the SAME attempt is ignored: it is already graded.
    const before = s.events.length;
    s = runnerReduce(s, { type: "perform", elementId: "aim-base" }, env, FIRE);
    expect(s.events.length).toBe(before);
  });

  test("G8 fails once any ordering violation is recorded", () => {
    const s = runWithMistake(FIRE, "A-04");
    const score = scoreModule(FIRE, toStepRecords(s, FIRE));
    expect(score.orderIntegrity).toBeLessThan(1);
    const gate = evaluateGate({
      manifests: [FIRE],
      moduleScores: [score],
      overall: scoreOverall([score]),
      recheck: evaluateRecheck([], {}, 0),
    });
    expect(gate.criteria.find((c) => c.id === "G8")?.met).toBe(false);
    expect(gate.failed).toContain("G8");
  });
});

describe("runner — full runs", () => {
  test("a clean run of FIRE emits exactly one event per step and scores 100", () => {
    const s = runClean(FIRE);
    expect(s.complete).toBe(true);
    expect(s.events).toHaveLength(FIRE.steps.length);
    expect(s.events.map((e) => e.stepId)).toEqual(FIRE.steps.map((st) => st.id));
    expect(s.outcomes && Object.values(s.outcomes).every(Boolean)).toBe(true);

    const records = toStepRecords(s, FIRE);
    const score = scoreModule(FIRE, records);
    expect(score.score).toBe(100);
    expect(score.criticalMisses).toBe(0);
    expect(score.blockedFailures).toBe(0);
    expect(score.meanHesitation).toBeLessThan(0.5);
  });

  test("GAS cannot be completed, so it cannot be certified", () => {
    // The real module, not the fixture. docs/13 step 4 is critical and its
    // procedure has not been approved, so the run stops there — and because the
    // module is never completed, the gate's existing "every module meets its
    // pass score" requirement fails on its own. No new gate rule was added for
    // this; the content simply cannot be finished.
    const s = runClean(GAS);
    expect(s.complete).toBe(false);
    expect(stalledOnPendingReview(s, GAS)).toBe(true);
    expect(s.outcomes?.["B-04"]).toBeUndefined();

    const gate = evaluateGate({
      manifests: [FIRE, GAS],
      moduleScores: [scoreModule(FIRE, toStepRecords(runClean(FIRE), FIRE))],
      overall: scoreOverall([scoreModule(FIRE, toStepRecords(runClean(FIRE), FIRE))]),
      recheck: evaluateRecheck([], {}, 0),
    });
    expect(gate.passed).toBe(false);
    expect(gate.failed).toContain("G1");
  });

  test("a clean run of GAS scores 100 once step 4 is approved", () => {
    // The promise the demo and the certificate make, held against the module as
    // it will be after review. See GAS_REVIEWED for why the shipped manifest is
    // not the one being driven here.
    const s = runClean(GAS_REVIEWED);
    const score = scoreModule(GAS_REVIEWED, toStepRecords(s, GAS_REVIEWED));
    expect(score.score).toBe(100);
  });

  test("the demo failure beat: water on a live electrical fire", () => {
    const s = runWithMistake(FIRE, "A-03", "water");
    const records = toStepRecords(s, FIRE);
    const score = scoreModule(FIRE, records);

    expect(score.criticalMisses).toBe(1);
    expect(score.blockedFailures).toBe(1);
    const metrics = score.steps.find((m) => m.stepId === "A-03")!;
    expect(metrics.topMisconception).toBe("water_on_electrical");
    expect(metrics.criticalMiss).toBe(true);

    // Solo entry is the GAS equivalent. Driven against the reviewed fixture so
    // the run reaches step 4; the misconception being reported is from step 3.
    const g = runWithMistake(GAS_REVIEWED, "B-03", "solo-fast");
    const gScore = scoreModule(GAS_REVIEWED, toStepRecords(g, GAS_REVIEWED));
    expect(gScore.steps.find((m) => m.stepId === "B-03")!.topMisconception).toBe("solo_entry");
    expect(gScore.criticalMisses).toBe(1);
  });

  test("a clean run in Hindi produces identical scores", () => {
    const en = runClean(FIRE, "en");
    const hi = runClean(FIRE, "hi");
    const enScore = scoreModule(FIRE, toStepRecords(en, FIRE));
    const hiScore = scoreModule(FIRE, toStepRecords(hi, FIRE));
    expect(hiScore.score).toBe(enScore.score);
    expect(hi.events.every((e) => e.locale === "hi")).toBe(true);
  });
});

describe("runner — offline", () => {
  test("events are produced identically with no network", () => {
    const { env, advance } = makeEnv(1_000_000, true);
    let s = createRunnerState(FIRE, {
      sessionId: "s1",
      locale: "en",
      now: env.now,
    });
    while (!s.complete) {
      s = solveStep(s, env, FIRE, advance).state;
      s = runnerReduce(s, { type: "continue" }, env, FIRE);
    }
    expect(s.events.every((e) => e.offline)).toBe(true);
    expect(s.events).toHaveLength(FIRE.steps.length);
    // Offline runs score exactly the same as online ones.
    expect(scoreModule(FIRE, toStepRecords(s, FIRE)).score).toBe(100);
  });

  test("event ids are unique across a run — the sync idempotency key", () => {
    const s = runWithMistake(FIRE, "A-03", "water");
    const ids = s.events.map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    // 6 steps + 1 retry = 7 events.
    expect(ids).toHaveLength(FIRE.steps.length + 1);
  });
});

describe("runner — cold re-check", () => {
  function runRecheck(manifests: ModuleManifest[], missIds: string[] = []) {
    const moduleScores = manifests.map((m) => scoreModule(m, toStepRecords(runClean(m), m)));
    const samples = sampleRecheckSteps({ manifests, moduleScores });
    const combined: ModuleManifest = {
      ...manifests[0]!,
      code: "RECHECK",
      steps: manifests.flatMap((m) => m.steps).filter((s) => samples.some((x) => x.stepId === s.id)),
    };

    const { env, advance } = makeEnv(5_000_000);
    let s = createRunnerState(combined, {
      sessionId: "recheck-1",
      locale: "en",
      phase: "recheck",
      now: env.now,
    });
    let guard = 0;
    while (!s.complete) {
      if (++guard > 100) throw new Error("recheck did not terminate");
      const step = currentStep(s, combined)!;
      advance(1500);
      if (step.kind === "decide") {
        const choice = missIds.includes(step.id)
          ? step.choices!.find((c) => !c.correct)!
          : step.choices!.find((c) => c.correct)!;
        s = runnerReduce(s, { type: "choose", choiceId: choice.id }, env, combined);
      } else if (step.kind === "observe") {
        const target = missIds.includes(step.id) ? "wrong-target" : step.success.requiredTargets![0]!;
        s = runnerReduce(s, { type: "tapTarget", targetId: target }, env, combined);
      } else {
        const elements = step.action!.elements;
        if (missIds.includes(step.id)) {
          s = runnerReduce(s, { type: "perform", elementId: "out-of-order" }, env, combined);
        } else {
          for (const el of elements) {
            s = runnerReduce(s, { type: "perform", elementId: el }, env, combined);
          }
        }
      }
      s = runnerReduce(s, { type: "continue" }, env, combined);
    }
    return { state: s, samples };
  }

  test("a fully retained re-check passes", () => {
    // Driven against the reviewed GAS fixture: these three tests are about
    // sampling, scoring and gate thresholds, none of which care what step 4
    // says. See GAS_REVIEWED.
    const { state, samples } = runRecheck([FIRE, GAS_REVIEWED]);
    expect(state.complete).toBe(true);
    expect(isFullyGraded(state, { ...FIRE, steps: FIRE.steps.filter((s) => samples.some((x) => x.stepId === s.id)) })).toBe(true);
    const result = evaluateRecheck(samples, recheckOutcomes(state));
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  test("one missed sample fails the whole re-check — no retries", () => {
    const { state, samples } = runRecheck([FIRE, GAS_REVIEWED], ["A-03"]);
    const result = evaluateRecheck(samples, recheckOutcomes(state));
    expect(result.passed).toBe(false);
    expect(result.missed).toEqual(["A-03"]);
    expect(result.passedCount).toBe(samples.length - 1);
    // The failed step was NOT retried: exactly one event per sampled step.
    expect(state.events).toHaveLength(samples.length);
  });

  test("a failed re-check blocks the certificate even after perfect training", () => {
    const { state, samples } = runRecheck([FIRE, GAS_REVIEWED], ["B-03"]);
    const manifests = [FIRE, GAS_REVIEWED];
    const moduleScores = manifests.map((m) => scoreModule(m, toStepRecords(runClean(m), m)));
    const recheck = evaluateRecheck(samples, recheckOutcomes(state));

    const gate = evaluateGate({
      manifests,
      moduleScores,
      overall: scoreOverall(moduleScores),
      recheck,
    });
    expect(gate.failed).toEqual(["G7"]);
    expect(gate.passed).toBe(false);
    expect(gate.criteria.find((c) => c.id === "G7")!.detail).toContain("3/4");
  });

  test("re-checks never offer hints", () => {
    const { env } = makeEnv(1);
    const s = createRunnerState(selectSteps(FIRE, ["A-03"]), {
      sessionId: "r",
      locale: "en",
      phase: "recheck",
      now: env.now,
    });
    const withHint = runnerReduce(s, { type: "hint" }, env, FIRE);
    expect(withHint.hintsUsed).toBe(0);
    expect(hintsRemaining(withHint, currentStep(withHint, FIRE)!)).toBe(0);
  });
});

describe("runner — guards", () => {
  test("actions are ignored on a resolved step and after completion", () => {
    const { state, env, advance } = start(FIRE);
    advance(100);
    const resolved = runnerReduce(state, { type: "tapTarget", targetId: "exit-sign" }, env, FIRE);
    const ignored = runnerReduce(resolved, { type: "tapTarget", targetId: "exit-sign" }, env, FIRE);
    expect(ignored.events).toHaveLength(1);

    const done = runClean(FIRE);
    const after = runnerReduce(done, { type: "tapTarget", targetId: "exit-sign" }, env, FIRE);
    expect(after.events).toHaveLength(FIRE.steps.length);
    expect(after.cursor).toBe(FIRE.steps.length);
  });

  test("continue on an unresolved step does nothing", () => {
    const { state, env } = start(FIRE);
    const next = runnerReduce(state, { type: "continue" }, env, FIRE);
    expect(next.cursor).toBe(0);
    expect(next).toBe(state);
  });

  test("an unknown choice or element id is ignored", () => {
    const { state, env } = start(FIRE);
    const s1 = runnerReduce(state, { type: "choose", choiceId: "nope" }, env, FIRE);
    expect(s1.events).toHaveLength(0);
    const s2 = runnerReduce(state, { type: "perform", elementId: "nope" }, env, FIRE);
    expect(s2.events).toHaveLength(0);
  });

  test("progress tracks position and passes", () => {
    const { state, env, advance } = start(FIRE);
    expect(progress(state, FIRE)).toEqual({ index: 1, total: 6, passed: 0 });
    const s = solveStep(state, env, FIRE, advance).state;
    const c = runnerReduce(s, { type: "continue" }, env, FIRE);
    expect(progress(c, FIRE)).toEqual({ index: 2, total: 6, passed: 1 });
  });

  test("toStepRecords attaches the rubric metadata for every event", () => {
    const s = runClean(FIRE);
    const records = toStepRecords(s, FIRE);
    const a03 = records.find((r) => r.stepId === "A-03")!;
    expect(a03.maxHints).toBe(2);
    expect(a03.expectedMs).toBe(20000);
    expect(a03.weight).toBe(3);
    expect(records.every((r) => r.weight >= 1 && r.maxHints >= 0)).toBe(true);
  });

  test("every shipped step is answerable, except those deliberately pending review", () => {
    // The exception is the point: a step awaiting the qualified safety reviewer
    // is *supposed* to be unanswerable, and this asserts that it is unanswerable
    // for the right reason — no approved answer, so nothing marked correct —
    // rather than by being quietly empty or dropped.
    for (const manifest of Object.values(MODULES)) {
      for (const step of manifest.steps as Step[]) {
        if (step.pendingSafetyReview) {
          if (step.kind === "decide") {
            expect(step.choices!.filter((c) => c.correct)).toHaveLength(0);
            expect(step.choices!.length).toBeGreaterThan(1);
          }
          expect(step.critical).toBe(true);
          continue;
        }
        if (step.kind === "decide") {
          expect(step.choices!.filter((c) => c.correct)).toHaveLength(1);
        }
        if (step.kind === "act") {
          expect(step.action!.elements.length).toBeGreaterThan(0);
        }
        if (step.kind === "observe") {
          expect(step.success.requiredTargets!.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
