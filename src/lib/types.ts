/**
 * Shared domain types for KAVACH.
 *
 * These types are the contract between three consumers:
 *   1. the client module runner (builds AttemptEvents)
 *   2. the Convex backend (persists them, recomputes scores)
 *   3. the test suite (exercises the rubric)
 *
 * Authored from docs/03-product-spec.md §1 and docs/04-data-model.md §2.7.
 * Pure types only — no runtime imports, so this file is safe on client and server.
 */

// ---------------------------------------------------------------------------
// Localisation
// ---------------------------------------------------------------------------

/** Locales shipped in the MVP. `sat` is a reserved, unfilled slot. */
export type Locale = "en" | "hi" | "sat";

/** Locales with content in the repo. Drives CI coverage gates (C5). */
export const SHIPPED_LOCALES = ["en", "hi"] as const;
export type ShippedLocale = (typeof SHIPPED_LOCALES)[number];

/**
 * `sat` is optional on purpose: the slot is reserved so filling it later is a
 * data change, not a refactor. The resolver falls back to `en`. See 01 §7.1.
 */
export interface Localised {
  en: string;
  hi: string;
  sat?: string;
}

// ---------------------------------------------------------------------------
// Step schema (docs/03-product-spec.md §1)
// ---------------------------------------------------------------------------

export type StepKind = "observe" | "act" | "decide";

export type FailureKind = "penalty" | "hazard" | "critical";

export interface MarkerTarget {
  id: string;
  /** null = world/reticle mode has no fixed sprite; see 05 §4. */
  sprite: string | null;
  label: Localised;
  /** Normalised fallback position for reticle mode. */
  position: { x: number; y: number };
}

export interface DecisionChoice {
  id: string;
  label: Localised;
  correct: boolean;
  /** Shown after selection regardless of correctness. */
  consequence: Localised;
  /**
   * C8: names the real-world misconception this wrong answer represents.
   * This is what makes the admin heatmap meaningful rather than decorative.
   */
  misconception?: string;
}

export interface ActionSpec {
  type: "sequence" | "hold" | "aim";
  elements: string[];
  /** Wall-clock budget used by the hesitation metric. */
  expectedMs?: number;
}

export type SuccessType = "identify" | "complete" | "select";

export interface SuccessCriterion {
  type: SuccessType;
  requiredTargets?: string[];
  /** 0..1, e.g. 0.8 for "4 out of 5". */
  minAccuracy?: number;
}

export interface FailureState {
  kind: FailureKind;
  consequence: Localised;
  requiresRetry: boolean;
  blocksCertificate: boolean;
}

export interface Step {
  id: string;
  moduleCode: string;
  /** 0-based, strictly increasing. */
  seq: number;
  kind: StepKind;
  /**
   * C4: a first-attempt miss on a critical step is a hard fail regardless of
   * overall score. Approved criticals: A-03, A-05, B-02, B-03, B-05.
   */
  critical: boolean;

  instruction: Localised;
  narrationKey: string;

  targets?: MarkerTarget[];
  action?: ActionSpec;
  choices?: DecisionChoice[];

  success: SuccessCriterion;
  failure: FailureState;
  hints: Localised[];

  /** Denominator for hintDependency. Defaults to hints.length. */
  maxHints?: number;
  /** Overrides action.expectedMs for the hesitation metric. */
  expectedMs?: number;
  /** Relative weight in the module score. Defaults to 1. */
  weight?: number;
}

export interface ModuleManifest {
  code: string;
  domain: string;
  title: Localised;
  version: string;
  estimatedMinutes: number;
  passScore: number;
  steps: Step[];
}

// ---------------------------------------------------------------------------
// Attempt events (docs/04-data-model.md §5)
// ---------------------------------------------------------------------------

export type AttemptOutcome = "pass" | "fail";

/**
 * Append-only training telemetry. Written to the local store FIRST, then
 * queued for upload. Never mutated after push — a correction is a new row.
 */
export interface AttemptEvent {
  /** uuid v4, client-generated. The idempotency key for the whole sync model. */
  eventId: string;
  sessionId: string;
  moduleCode: string;
  moduleVersion: string;
  stepId: string;
  stepSeq: number;
  critical: boolean;

  outcome: AttemptOutcome;
  attemptIndex: number;
  elapsedMs: number;
  hintUsed: number;
  /** Passed after >=1 fail without a hint. Strong positive signal. */
  selfRecovered: boolean;
  prompted: boolean;
  orderViolation: boolean;

  failureKind?: FailureKind;
  misconception?: string;

  /** True when recorded with no network. */
  offline: boolean;
  clientTs: number;
  locale: string;
}

/** A step result already joined against its step definition. */
export interface StepAttemptRecord extends AttemptEvent {
  maxHints: number;
  expectedMs: number;
  weight: number;
}

// ---------------------------------------------------------------------------
// Scored output (docs/03-product-spec.md §3)
// ---------------------------------------------------------------------------

/** Per-step metrics, each normalised 0..1. */
export interface StepMetrics {
  stepId: string;
  critical: boolean;
  firstAttemptAccuracy: number;
  /** Lower is better; 0..1. */
  hintDependency: number;
  /** 0 = fast, 1 = very slow. */
  hesitation: number;
  selfRecovery: number;
  orderIntegrity: number;
  /** Fraction of attempts that ever passed. 0..1. */
  completeness: number;
  attemptCount: number;
  everPassed: boolean;
  /** First-attempt miss on a critical step — the hard-fail condition. */
  criticalMiss: boolean;
  /** Set when any attempt carried a certificate-blocking failure. */
  blockedFailure: boolean;
  /** Most frequent wrong misconception, for the heatmap. */
  topMisconception?: string;
}

export interface ModuleScore {
  moduleCode: string;
  /** 0..100, rounded. */
  score: number;
  passed: boolean;
  steps: StepMetrics[];
  /** Fraction of steps ever passed. */
  completeness: number;
  firstAttemptAccuracy: number;
  orderIntegrity: number;
  selfRecoveryRate: number;
  meanHintDependency: number;
  meanHesitation: number;
  criticalMisses: number;
  blockedFailures: number;
}

// ---------------------------------------------------------------------------
// Gate (docs/03-product-spec.md §3.4)
// ---------------------------------------------------------------------------

export type GateId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8";

export interface GateCriterionResult {
  id: GateId;
  label: string;
  met: boolean;
  value: number;
  threshold: number;
  detail: string;
}

export interface GateResult {
  /** True only when every criterion is met. C4, C7. */
  passed: boolean;
  criteria: GateCriterionResult[];
  /** Criterion ids that failed, for targeted remediation. */
  failed: GateId[];
}

// ---------------------------------------------------------------------------
// Cold re-check (docs/03-product-spec.md §3.5)
// ---------------------------------------------------------------------------

export interface RecheckSample {
  stepId: string;
  moduleCode: string;
  critical: boolean;
  /** Why this step was sampled — surfaced in the UI and in tests. */
  reason: "critical-core" | "module-spread" | "weakest-step";
}

export interface RecheckResult {
  passed: boolean;
  /** Fraction of sampled steps passed, 0..1. */
  score: number;
  total: number;
  passedCount: number;
  samples: RecheckSample[];
  /** Step ids the trainee got wrong cold. */
  missed: string[];
}
