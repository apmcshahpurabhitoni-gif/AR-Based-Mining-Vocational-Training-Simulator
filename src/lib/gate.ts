/**
 * KAVACH certificate gate.
 *
 * This is the product. docs/03-product-spec.md §3.4-3.5.
 *
 * Every incumbent in the space certifies attendance or content delivered.
 * G7 — the cold-retention re-check — is the one criterion nobody else has, and
 * it exists because the research (Msweli et al. 2026; Scorgie et al. 2024)
 * finds immersive training produces short-term gains only. A certificate that
 * survives a cold re-check is a claim about retention, not attendance.
 *
 * Pure functions, no runtime imports: shared by the client (live gate display)
 * and the Convex actions (authoritative evaluation).
 */

import type { OverallScore } from "./scoring";
import { mean } from "./scoring";
import type {
  GateCriterionResult,
  GateId,
  GateResult,
  ModuleManifest,
  ModuleScore,
  RecheckResult,
  RecheckSample,
  Step,
  StepMetrics,
} from "./types";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const GATE_THRESHOLDS = {
  /** G1/G2 — per-module minimum score. */
  minModuleScore: 80,
  /** G5 — overall first-attempt accuracy. */
  minFirstAttemptAccuracy: 0.8,
  /** G6 — mean hint dependency, lower is better. */
  maxMeanHintDependency: 0.3,
  /** G7 — fraction of cold-re-check samples that must pass. */
  minRecheckScore: 0.8,
  /** G3/G4 — hard zeros. */
  maxCriticalMisses: 0,
  maxBlockedFailures: 0,
} as const;

/** G8 is a boolean: ordering integrity must hold in BOTH modules. */
const REQUIRED_ORDER_INTEGRITY = 1;

/** docs/03-product-spec.md §3.5 — eligibility gap before the cold re-check. */
export const RECHECK_MIN_DELAY_MS = 90_000;

/** Number of steps sampled in a cold re-check. */
export const RECHECK_SAMPLE_SIZE = 4;

// ---------------------------------------------------------------------------
// Criterion construction
// ---------------------------------------------------------------------------

function criterion(
  id: GateId,
  label: string,
  met: boolean,
  value: number,
  threshold: number,
  detail: string,
): GateCriterionResult {
  return { id, label, met, value, threshold, detail };
}

/**
 * Gate input. Deliberately narrow so it can be built from persisted rows on
 * the server or from in-memory state on the client.
 */
export interface GateInput {
  /** Scored modules, in any order; matched to manifests by code. */
  moduleScores: ModuleScore[];
  /** Manifests, used for passScore and module identification. */
  manifests: ModuleManifest[];
  /** Overall pooled score across all modules. */
  overall: OverallScore;
  /** Result of the cold re-check. Omitted means the gate cannot pass. */
  recheck?: RecheckResult;
  /** Epoch ms the re-check became eligible. Optional for display only. */
  recheckEligibleAt?: number;
  /** Now, injectable for deterministic tests. */
  now?: number;
}

export type ModuleGateStatus = "pass" | "fail" | "missing";

export interface ModuleGateEntry {
  code: string;
  title: string;
  status: ModuleGateStatus;
  score: number;
  threshold: number;
}

/**
 * Evaluate G1-G8.
 *
 * `passed` is true only when every criterion is met. Note G7: a missing
 * re-check result fails the gate. The gate is fail-closed by design (C7) —
 * skipping the re-check must never be a way to earn a certificate.
 */
export function evaluateGate(input: GateInput): GateResult {
  const t = GATE_THRESHOLDS;
  const { moduleScores, manifests, overall, recheck } = input;

  const criteria: GateCriterionResult[] = [];

  // -- G1 / G2: every module must independently meet its own passScore ------
  const moduleGate: ModuleGateEntry[] = manifests.map((manifest) => {
    const scored = moduleScores.find((m) => m.moduleCode === manifest.code);
    const score = scored?.score ?? 0;
    const threshold = manifest.passScore ?? t.minModuleScore;
    return {
      code: manifest.code,
      title: manifest.title.en,
      status: !scored ? "missing" : score >= threshold ? "pass" : "fail",
      score,
      threshold,
    };
  });

  const moduleFails = moduleGate.filter((m) => m.status !== "pass");
  const allModuleLabels = moduleGate.map((m) => `${m.code} ${m.score}/${m.threshold}`).join(", ");

  criteria.push(
    criterion(
      "G1",
      "Every module meets its pass score",
      moduleGate.length > 0 && moduleFails.length === 0,
      moduleGate.length - moduleFails.length,
      moduleGate.length,
      allModuleLabels || "no manifests supplied",
    ),
  );

  // G2 is retained as a distinct criterion for auditability even though G1
  // already covers the aggregate. It asserts the same invariant, so it can
  // never disagree with G1 — a deliberate redundancy, not a bug.
  criteria.push(
    criterion(
      "G2",
      "Module pass scores are not superseded by the overall score",
      moduleFails.length === 0,
      overall.overallScore,
      t.minModuleScore,
      `overall ${overall.overallScore}; per-module floor is enforced independently`,
    ),
  );

  // -- G3: zero critical-step first-attempt misses (C4) --------------------
  criteria.push(
    criterion(
      "G3",
      "No critical step missed on first attempt",
      overall.criticalMisses <= t.maxCriticalMisses,
      overall.criticalMisses,
      t.maxCriticalMisses,
      overall.criticalMisses === 0
        ? "all critical steps passed first time"
        : `${overall.criticalMisses} critical step(s) missed on the first try`,
    ),
  );

  // -- G4: zero certificate-blocking failures -------------------------------
  criteria.push(
    criterion(
      "G4",
      "No failure state that blocks certification",
      overall.blockedFailures <= t.maxBlockedFailures,
      overall.blockedFailures,
      t.maxBlockedFailures,
      overall.blockedFailures === 0
        ? "clean run"
        : `${overall.blockedFailures} blocking failure(s) recorded`,
    ),
  );

  // -- G5: overall first-attempt accuracy ------------------------------------
  criteria.push(
    criterion(
      "G5",
      "Overall first-attempt accuracy",
      overall.firstAttemptAccuracy >= t.minFirstAttemptAccuracy,
      overall.firstAttemptAccuracy,
      t.minFirstAttemptAccuracy,
      `${(overall.firstAttemptAccuracy * 100).toFixed(0)}% correct on the first attempt`,
    ),
  );

  // -- G6: hint dependency ----------------------------------------------------
  criteria.push(
    criterion(
      "G6",
      "Mean hint dependency stays low",
      overall.meanHintDependency <= t.maxMeanHintDependency,
      overall.meanHintDependency,
      t.maxMeanHintDependency,
      `${(overall.meanHintDependency * 100).toFixed(0)}% of available hints consumed`,
    ),
  );

  // -- G7: cold re-check (C7, fail-closed) -----------------------------------
  const recheckScore = recheck?.score ?? 0;
  criteria.push(
    criterion(
      "G7",
      "Cold retention re-check passed",
      recheck !== undefined && recheck.passed && recheckScore >= t.minRecheckScore,
      recheckScore,
      t.minRecheckScore,
      recheck === undefined
        ? "not attempted — certificate blocked until the re-check is taken"
        : `${recheck.passedCount}/${recheck.total} retained after the delay`,
    ),
  );

  // -- G8: ordering integrity in both modules --------------------------------
  const orderOk =
    moduleScores.length > 0 &&
    moduleScores.every((m) => m.orderIntegrity >= REQUIRED_ORDER_INTEGRITY);
  criteria.push(
    criterion(
      "G8",
      "Sequencing integrity held in every module",
      orderOk,
      moduleScores.length > 0 ? mean(moduleScores.map((m) => m.orderIntegrity)) : 0,
      REQUIRED_ORDER_INTEGRITY,
      moduleScores.length === 0
        ? "no modules scored"
        : moduleScores.every((m) => m.orderIntegrity >= REQUIRED_ORDER_INTEGRITY)
          ? "no ordering violations"
          : "at least one ordering violation",
    ),
  );

  const failed = criteria.filter((c) => !c.met).map((c) => c.id);
  return { passed: failed.length === 0, criteria, failed };
}

// ---------------------------------------------------------------------------
// Cold re-check sampling (docs/03-product-spec.md §3.5)
// ---------------------------------------------------------------------------

export interface RecheckSamplingInput {
  manifests: ModuleManifest[];
  moduleScores: ModuleScore[];
  /** Injected for deterministic tests. */
  now?: number;
  /** Epoch ms of the most recent module completion. */
  lastCompletedAt?: number;
}

/** True once the 90 s retention gap has elapsed. */
export function isRecheckEligible(
  lastCompletedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (lastCompletedAt === undefined) return false;
  if (!Number.isFinite(lastCompletedAt)) return false;
  return now - lastCompletedAt >= RECHECK_MIN_DELAY_MS;
}

export function msUntilRecheckEligible(
  lastCompletedAt: number | undefined,
  now: number = Date.now(),
): number {
  if (lastCompletedAt === undefined) return RECHECK_MIN_DELAY_MS;
  const remaining = lastCompletedAt + RECHECK_MIN_DELAY_MS - now;
  return remaining > 0 ? remaining : 0;
}

/**
 * Choose which steps to re-test.
 *
 * Strategy (docs/03-product-spec.md §3.5):
 *   - spread across modules
 *   - always include each module's highest-weight critical step
 *   - bias the final sample toward the trainee's weakest step
 *
 * Deterministic: same input always produces the same sample, so the demo and
 * the tests are reproducible.
 */
export function sampleRecheckSteps(input: RecheckSamplingInput): RecheckSample[] {
  const { manifests, moduleScores } = input;
  if (manifests.length === 0) return [];

  const budget = Math.min(RECHECK_SAMPLE_SIZE, countSampleableSteps(manifests));
  const chosen = new Map<string, RecheckSample>();
  const allMetrics: StepMetrics[] = moduleScores.flatMap((m) => m.steps);

  /** Weakest = lowest first-attempt accuracy, then highest hint dependency. */
  const weakestOf = (metrics: StepMetrics[]): StepMetrics | undefined =>
    [...metrics].sort(
      (a, b) =>
        a.firstAttemptAccuracy - b.firstAttemptAccuracy ||
        b.hintDependency - a.hintDependency ||
        a.stepId.localeCompare(b.stepId),
    )[0];

  const add = (step: Step, reason: RecheckSample["reason"]): void => {
    if (chosen.size >= budget) return;
    if (chosen.has(step.id)) return;
    chosen.set(step.id, {
      stepId: step.id,
      moduleCode: step.moduleCode,
      critical: step.critical,
      reason,
    });
  };

  // Pass 1 — each module's highest-weight critical step, strongest first.
  const criticals = manifests
    .flatMap((m) => m.steps.filter((s) => s.critical))
    .sort((a, b) => weightFallback(b) - weightFallback(a) || a.id.localeCompare(b.id));

  for (const step of criticals) add(step, "critical-core");

  // Pass 2 — one non-chosen step per module for coverage.
  for (const manifest of manifests) {
    const metrics = allMetrics.filter((s) => chosen.has(s.stepId) === false);
    const moduleMetrics = moduleScores.find((m) => m.moduleCode === manifest.code)?.steps ?? [];
    const weakestInModule = weakestOf(moduleMetrics);
    if (weakestInModule && !chosen.has(weakestInModule.stepId)) {
      const step = manifest.steps.find((s) => s.id === weakestInModule.stepId);
      if (step) {
        add(step, "module-spread");
        continue;
      }
    }
    const fallback = manifest.steps.find((s) => !chosen.has(s.id));
    if (fallback) add(fallback, "module-spread");
    void metrics;
  }

  // Pass 3 — the globally weakest remaining step, if budget remains.
  if (chosen.size < budget) {
    const weakest = weakestOf(allMetrics.filter((s) => !chosen.has(s.stepId)));
    if (weakest) {
      const step = manifests
        .flatMap((m) => m.steps)
        .find((s) => s.id === weakest.stepId);
      if (step) add(step, "weakest-step");
    }
  }

  return [...chosen.values()].sort((a, b) => a.stepId.localeCompare(b.stepId));
}

function countSampleableSteps(manifests: ModuleManifest[]): number {
  return manifests.reduce((acc, m) => acc + m.steps.length, 0);
}

function weightFallback(step: Step): number {
  const w = step.weight;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}

// ---------------------------------------------------------------------------
// Re-check evaluation
// ---------------------------------------------------------------------------

/**
 * Grade a cold re-check.
 *
 * Per docs/03-product-spec.md §3.5: a wrong answer here fails the re-check
 * regardless of how well the trainee did during training. That asymmetry is
 * the entire point — it is what separates a coached pass from competence.
 */
export function evaluateRecheck(
  samples: RecheckSample[],
  outcomes: Record<string, boolean>,
  minScore: number = GATE_THRESHOLDS.minRecheckScore,
): RecheckResult {
  if (samples.length === 0) {
    // No sample means no evidence. Fail closed.
    return { passed: false, score: 0, total: 0, passedCount: 0, samples: [], missed: [] };
  }

  const missed: string[] = [];
  let passedCount = 0;
  for (const sample of samples) {
    if (outcomes[sample.stepId] === true) passedCount += 1;
    else missed.push(sample.stepId);
  }

  const score = passedCount / samples.length;
  return {
    passed: missed.length === 0 && score >= minScore,
    score,
    total: samples.length,
    passedCount,
    samples,
    missed,
  };
}
