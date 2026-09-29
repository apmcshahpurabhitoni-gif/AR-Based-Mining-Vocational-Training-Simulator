/**
 * KAVACH scoring rubric.
 *
 * This is the differentiator, so it is written as pure functions with no
 * runtime imports: the client imports it to show live scores offline, the
 * Convex actions import it to recompute authoritatively. One implementation,
 * no drift. See docs/03-product-spec.md §3.
 *
 * Design rules:
 *  - Never throws on malformed or partial data. A training app that crashes
 *    while scoring is worse than one that scores conservatively.
 *  - Every aggregate is recomputed from raw attempt rows. No stored scores.
 *  - A step the trainee never reached counts as incomplete, never as passed.
 */

import type {
  ModuleManifest,
  ModuleScore,
  Step,
  StepAttemptRecord,
  StepMetrics,
} from "./types";

// ---------------------------------------------------------------------------
// Rubric weights (docs/03-product-spec.md §3.3)
// ---------------------------------------------------------------------------

export const RUBRIC_WEIGHTS = {
  firstAttempt: 0.35,
  orderIntegrity: 0.15,
  selfRecovery: 0.15,
  /** Lower raw value is better, so it is inverted during aggregation. */
  hintDependency: 0.1,
  /** Lower raw value is better, so it is inverted during aggregation. */
  hesitation: 0.1,
  completeness: 0.15,
} as const;

const WEIGHT_SUM = Object.values(RUBRIC_WEIGHTS).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

/** Clamp to [0, 1], mapping non-finite input to 0. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Clamp to [lo, hi], mapping non-finite input to lo. */
function clampRange(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Safe ratio that never divides by zero and never returns NaN. */
function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

/** Mean over a possibly-empty list. Empty list is 0, not NaN. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return Number.isFinite(sum) ? sum / values.length : 0;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Group attempt rows by stepId, preserving step order from the manifest.
 * Attempts for unknown steps are ignored — a manifest version bump must never
 * corrupt scoring of a live session (docs/04-data-model.md §5).
 */
export function groupAttemptsByStep(
  manifest: ModuleManifest,
  attempts: StepAttemptRecord[],
): Map<string, StepAttemptRecord[]> {
  const byStep = new Map<string, StepAttemptRecord[]>();
  for (const step of manifest.steps) byStep.set(step.id, []);

  for (const attempt of attempts) {
    const bucket = byStep.get(attempt.stepId);
    if (bucket) bucket.push(attempt);
  }

  // Deterministic order within a step: attempt index, then client timestamp.
  for (const bucket of byStep.values()) {
    bucket.sort((a, b) => a.attemptIndex - b.attemptIndex || a.clientTs - b.clientTs);
  }
  return byStep;
}

// ---------------------------------------------------------------------------
// Per-step metrics (docs/03-product-spec.md §3.2)
// ---------------------------------------------------------------------------

/**
 * Expected time for a step: explicit step value, then action value, then a
 * conservative default. Without a budget the hesitation metric is meaningless,
 * so it degrades to 0 (no penalty) rather than dividing by zero.
 */
export function expectedMsFor(step: Step): number {
  return step.expectedMs ?? step.action?.expectedMs ?? 0;
}

export function maxHintsFor(step: Step): number {
  return step.maxHints ?? step.hints.length;
}

export function weightFor(step: Step): number {
  const w = step.weight;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}

/**
 * Hesitation: how far the trainee ran past the expected time, saturating at 1
 * once they are 3x over (expected + 2*expected). 0 when no budget is defined.
 */
export function hesitationFor(elapsedMs: number, expectedMs: number): number {
  if (!Number.isFinite(expectedMs) || expectedMs <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return clamp01((elapsedMs - expectedMs) / (2 * expectedMs));
}

/**
 * Hints consumed on the attempt that actually passed. If the step was never
 * passed we use the worst observed value, so struggling is never rewarded.
 */
function hintUsedForPass(records: StepAttemptRecord[]): number {
  const passing = records.filter((r) => r.outcome === "pass");
  if (passing.length === 0) {
    return records.reduce((max, r) => Math.max(max, r.hintUsed), 0);
  }
  return Math.max(...passing.map((r) => r.hintUsed));
}

/** Elapsed time of the attempt that passed; last attempt if never passed. */
function elapsedForPass(records: StepAttemptRecord[]): number {
  const passing = records.filter((r) => r.outcome === "pass");
  if (passing.length === 0) {
    return records.length > 0 ? (records[records.length - 1]?.elapsedMs ?? 0) : 0;
  }
  return Math.max(...passing.map((r) => r.elapsedMs));
}

/**
 * Compute metrics for one step.
 *
 * A step with no attempts yields a fully-zeroed, incomplete record — it is
 * never scored as passed. That is what makes `completeness` meaningful.
 */
export function computeStepMetrics(
  step: Step,
  records: StepAttemptRecord[],
): StepMetrics {
  const base: StepMetrics = {
    stepId: step.id,
    critical: step.critical,
    firstAttemptAccuracy: 0,
    hintDependency: 0,
    hesitation: 0,
    selfRecovery: 0,
    orderIntegrity: 0,
    completeness: 0,
    attemptCount: records.length,
    everPassed: false,
    criticalMiss: false,
    blockedFailure: false,
  };

  if (records.length === 0) return base;

  const first = records[0];
  if (!first) return base;

  const everPassed = records.some((r) => r.outcome === "pass");
  const maxHints = Math.max(1, maxHintsFor(step));
  const expectedMs = expectedMsFor(step);

  // Most frequent misconception among failed attempts (C8 / heatmap).
  const misconceptionCounts = new Map<string, number>();
  for (const r of records) {
    if (r.outcome === "fail" && r.misconception) {
      misconceptionCounts.set(r.misconception, (misconceptionCounts.get(r.misconception) ?? 0) + 1);
    }
  }
  let topMisconception: string | undefined;
  let topCount = 0;
  for (const [tag, count] of misconceptionCounts) {
    // Strictly greater keeps the earliest-seen tag on ties: deterministic.
    if (count > topCount) {
      topMisconception = tag;
      topCount = count;
    }
  }

  return {
    stepId: step.id,
    critical: step.critical,
    firstAttemptAccuracy: first.outcome === "pass" ? 1 : 0,
    // Self-recovery is credited whether the trainee got it right first time or
    // worked it out unaided after a miss. A clean pass is the strongest form of
    // independence, not a non-event; only a pass that needed help scores 0 here.
    // firstAttemptAccuracy already penalises the first-try miss, so crediting
    // self-recovery here does not double-count the failure.
    selfRecovery: records.some((r) => r.outcome === "pass" && !r.prompted) ? 1 : 0,
    hintDependency: clamp01(ratio(hintUsedForPass(records), maxHints)),
    hesitation: hesitationFor(elapsedForPass(records), expectedMs),
    // Any ordering violation at any point costs the point, not just the first.
    orderIntegrity: records.some((r) => r.orderViolation) ? 0 : 1,
    completeness: everPassed ? 1 : 0,
    attemptCount: records.length,
    everPassed,
    // C4: only a FIRST-attempt miss on a critical step hard-fails.
    criticalMiss: step.critical && first.outcome === "fail",
    blockedFailure: records.some(
      (r) => r.outcome === "fail" && r.failureKind === "critical",
    ),
    ...(topMisconception ? { topMisconception } : {}),
  };
}

// ---------------------------------------------------------------------------
// Module score (docs/03-product-spec.md §3.3)
// ---------------------------------------------------------------------------

/**
 * Weighted 0..100 score for one module.
 *
 * Step weights (when a step declares one) modulate each step's contribution,
 * so a module can make a critical step count for more than an observe step.
 * With uniform weights this reduces exactly to the spec formula.
 */
export function scoreModule(
  manifest: ModuleManifest,
  attempts: StepAttemptRecord[],
): ModuleScore {
  const byStep = groupAttemptsByStep(manifest, attempts);
  const metrics: StepMetrics[] = [];
  const stepWeights: number[] = [];

  for (const step of manifest.steps) {
    const stepMetrics = computeStepMetrics(step, byStep.get(step.id) ?? []);
    metrics.push(stepMetrics);
    stepWeights.push(weightFor(step));
  }

  const weightTotal = stepWeights.reduce((a, b) => a + b, 0) || 1;

  // Per-step rubric value, then a weight-modulated mean.
  //
  // A step that was never passed contributes ZERO, not the inverse of its
  // metrics. hintDependency and hesitation are inverted weights ("lower is
  // better"), so an untouched step — where both are 0 — would otherwise earn
  // full marks for restraint it never demonstrated. Gating on everPassed is
  // what makes a skipped step score 0 instead of ~20.
  const perStepValue = metrics.map((m) => {
    if (!m.everPassed) return 0;
    const v =
      RUBRIC_WEIGHTS.firstAttempt * m.firstAttemptAccuracy +
      RUBRIC_WEIGHTS.orderIntegrity * m.orderIntegrity +
      RUBRIC_WEIGHTS.selfRecovery * m.selfRecovery +
      RUBRIC_WEIGHTS.hintDependency * (1 - m.hintDependency) +
      RUBRIC_WEIGHTS.hesitation * (1 - m.hesitation) +
      RUBRIC_WEIGHTS.completeness * m.completeness;
    return v / WEIGHT_SUM;
  });

  const weightedSum = perStepValue.reduce((acc, v, i) => acc + v * (stepWeights[i] ?? 1), 0);
  const score = Math.round(clampRange(weightedSum / weightTotal, 0, 1) * 100);

  const firstAttemptAccuracy = mean(metrics.map((m) => m.firstAttemptAccuracy));
  const orderIntegrity = mean(metrics.map((m) => m.orderIntegrity));
  const selfRecoveryRate = mean(metrics.map((m) => m.selfRecovery));
  const meanHintDependency = mean(metrics.map((m) => m.hintDependency));
  const meanHesitation = mean(metrics.map((m) => m.hesitation));
  const completeness = mean(metrics.map((m) => m.completeness));
  const criticalMisses = metrics.filter((m) => m.criticalMiss).length;
  const blockedFailures = metrics.filter((m) => m.blockedFailure).length;

  return {
    moduleCode: manifest.code,
    score,
    passed: score >= manifest.passScore,
    steps: metrics,
    completeness,
    firstAttemptAccuracy,
    orderIntegrity,
    selfRecoveryRate,
    meanHintDependency,
    meanHesitation,
    criticalMisses,
    blockedFailures,
  };
}

// ---------------------------------------------------------------------------
// Cross-module aggregate
// ---------------------------------------------------------------------------

export interface OverallScore {
  /** Weight-modulated mean across every step of every module. */
  overallScore: number;
  firstAttemptAccuracy: number;
  orderIntegrity: number;
  meanHintDependency: number;
  meanHesitation: number;
  selfRecoveryRate: number;
  completeness: number;
  criticalMisses: number;
  blockedFailures: number;
}

/**
 * Aggregate across modules by pooling step metrics, so a module with more
 * steps does not silently dominate the overall figure.
 */
export function scoreOverall(moduleScores: ModuleScore[]): OverallScore {
  const all = moduleScores.flatMap((m) => m.steps);
  return {
    overallScore:
      all.length === 0
        ? 0
        : Math.round(
            moduleScores.length === 0
              ? 0
              : moduleScores.reduce((a, m) => a + m.score, 0) / moduleScores.length,
          ),
    firstAttemptAccuracy: mean(all.map((s) => s.firstAttemptAccuracy)),
    orderIntegrity: mean(all.map((s) => s.orderIntegrity)),
    meanHintDependency: mean(all.map((s) => s.hintDependency)),
    meanHesitation: mean(all.map((s) => s.hesitation)),
    selfRecoveryRate: mean(all.map((s) => s.selfRecovery)),
    completeness: mean(all.map((s) => s.completeness)),
    criticalMisses: moduleScores.reduce((a, m) => a + m.criticalMisses, 0),
    blockedFailures: moduleScores.reduce((a, m) => a + m.blockedFailures, 0),
  };
}
