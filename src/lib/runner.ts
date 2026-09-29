/**
 * Module runner state machine.
 *
 * This is the code that actually runs on a trainee's phone, so it has two
 * requirements that pull against each other:
 *
 *   1. It must work with no network. Every input resolves locally against the
 *      bundled manifest and emits an `AttemptEvent` immediately. Sync is a
 *      separate concern, handled later (docs/04-data-model.md §5).
 *   2. It must be replayable. The same inputs must always produce the same
 *      events, or the server's recomputed score could disagree with the score
 *      the trainee was shown (docs/07-architecture.md §3).
 *
 * Both fall out of making this a pure reducer: `(state, action, env, manifest)
 * => state`. No timers, no network, no React. `now`, `offline` and the event-id
 * factory are all injected through `RunnerEnv`, so the tests drive it
 * deterministically and the React layer only wires buttons to `runnerReduce`.
 */

import type { ARMode, ShippedARMode } from "./ar";
import { resolveARMode } from "./ar";
import { maxHintsFor, expectedMsFor } from "./scoring";
import type { AttemptEvent, Locale, Localised, ModuleManifest, Step } from "./types";

// ---------------------------------------------------------------------------
// Localisation helper
// ---------------------------------------------------------------------------

/**
 * Resolve a localised string, honouring the documented `sat -> en` fallback.
 * `sat` is a reserved, unfilled slot in the MVP — see docs/01-gap-analysis.md
 * §7.1 — so an unfilled locale must degrade to English rather than render blank.
 */
export function t(value: Localised, locale: Locale): string {
  if (locale === "sat") return value.sat ?? value.en;
  return value[locale] || value.en;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** First-pass training, or the cold re-check taken after the retention gap. */
export type RunnerPhase = "training" | "recheck";

export interface StepRuntime {
  stepId: string;
  /** 0 on the first try; incremented on each retry. */
  attemptIndex: number;
  /** Hints consumed during the CURRENT attempt. */
  hintUsed: number;
  /** Targets already satisfied this attempt (observe steps). */
  satisfiedTargets: string[];
  /** Elements matched in order so far this attempt (act steps). */
  actionCursor: number;
  /** Sticky for the whole attempt — one out-of-order tap costs the point. */
  orderViolation: boolean;
  /** Set once the attempt is graded, until the trainee continues. */
  resolved: boolean;
  passed: boolean;
  /** Feedback for the resolved attempt, already localised. */
  feedback?: string;
  /** Misconception tag for a wrong answer. Feeds the step heatmap. */
  misconception?: string;
  /** Epoch ms the current attempt began. */
  startedAt: number;
}

export interface RunnerState {
  sessionId: string;
  moduleCode: string;
  moduleVersion: string;
  locale: Locale;
  phase: RunnerPhase;
  arMode: ShippedARMode;

  /** Index into the (possibly filtered) manifest step list. */
  cursor: number;
  /** Per-step runtime, created lazily as each step is reached. */
  runtime: Record<string, StepRuntime>;
  /**
   * Append-only. The single source of truth for scoring — never rewritten,
   * never reordered. A correction is a new row.
   */
  events: AttemptEvent[];
  /** Grade of each step's first attempt. Drives the re-check result. */
  outcomes: Record<string, boolean>;
  /** Total hints consumed across the run, for the live hint-dependency meter. */
  hintsUsed: number;
  /** True once the final step has been resolved and continued past. */
  complete: boolean;
}

/** Injected environment — the only way non-determinism enters the reducer. */
export interface RunnerEnv {
  now: number;
  offline: boolean;
  newEventId: () => string;
}

export type RunnerAction =
  | { type: "setArMode"; mode: ARMode }
  | { type: "tapTarget"; targetId: string }
  | { type: "choose"; choiceId: string }
  | { type: "perform"; elementId: string }
  | { type: "hint" }
  | { type: "continue" };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createRunnerState(
  manifest: ModuleManifest,
  args: {
    sessionId: string;
    locale: Locale;
    phase?: RunnerPhase;
    arMode?: ARMode;
    now: number;
  },
): RunnerState {
  return enterStep(
    {
      sessionId: args.sessionId,
      moduleCode: manifest.code,
      moduleVersion: manifest.version,
      locale: args.locale,
      phase: args.phase ?? "training",
      arMode: resolveARMode(args.arMode),
      cursor: 0,
      runtime: {},
      events: [],
      outcomes: {},
      hintsUsed: 0,
      complete: false,
    },
    manifest,
    args.now,
  );
}

/**
 * Ensure the step at the cursor has a runtime entry, stamped with the moment
 * the trainee ARRIVED on it.
 *
 * This has to happen on entry rather than on first interaction: `elapsedMs` is
 * the hesitation signal, and a trainee who reads the instruction for twelve
 * seconds before touching anything must be charged for those twelve seconds.
 */
function enterStep(
  state: RunnerState,
  manifest: ModuleManifest,
  now: number,
): RunnerState {
  const step = manifest.steps[state.cursor];
  if (!step || state.runtime[step.id]) return state;
  return {
    ...state,
    runtime: {
      ...state.runtime,
      [step.id]: {
        stepId: step.id,
        attemptIndex: 0,
        hintUsed: 0,
        satisfiedTargets: [],
        actionCursor: 0,
        orderViolation: false,
        resolved: false,
        passed: false,
        startedAt: now,
      },
    },
  };
}

/**
 * Restrict a manifest to a subset of steps, preserving their order and their
 * original `seq`. Used for the cold re-check, which samples steps from across
 * both modules — the re-check is a distinct event with its own row type, not a
 * second pass over the training manifest.
 */
export function selectSteps(manifest: ModuleManifest, stepIds: string[]): ModuleManifest {
  const wanted = new Set(stepIds);
  return { ...manifest, steps: manifest.steps.filter((s) => wanted.has(s.id)) };
}

export function currentStep(state: RunnerState, manifest: ModuleManifest): Step | undefined {
  return manifest.steps[state.cursor];
}

export function currentRuntime(
  state: RunnerState,
  manifest: ModuleManifest,
): StepRuntime | undefined {
  const step = currentStep(state, manifest);
  return step ? state.runtime[step.id] : undefined;
}

/** Hints still available on the current attempt. Re-checks never offer hints. */
export function hintsRemaining(state: RunnerState, step: Step): number {
  if (state.phase === "recheck") return 0;
  const rt = state.runtime[step.id];
  return Math.max(0, maxHintsFor(step) - (rt?.hintUsed ?? 0));
}

/** Next unconsumed hint for the current step, or undefined when exhausted. */
export function nextHint(state: RunnerState, manifest: ModuleManifest): string | undefined {
  const step = currentStep(state, manifest);
  if (!step) return undefined;
  const rt = state.runtime[step.id];
  const used = rt?.hintUsed ?? 0;
  if (used >= maxHintsFor(step)) return undefined;
  const hint = step.hints[used];
  return hint ? t(hint, state.locale) : undefined;
}

/** Live progress across the run, for the header stepper. */
export function progress(state: RunnerState, manifest: ModuleManifest): {
  index: number;
  total: number;
  passed: number;
} {
  const passed = Object.values(state.outcomes).filter(Boolean).length;
  return { index: Math.min(state.cursor + 1, manifest.steps.length), total: manifest.steps.length, passed };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grade the current attempt: append the event, mark the step resolved, and
 * record the first-attempt grade.
 *
 * Every field the rubric reads is decided here and nowhere else — notably
 * `selfRecovered` (a pass after a miss with no hint consumed) and `prompted`.
 * `elapsedMs` is measured from the start of THIS attempt, not the step, so a
 * retry is not penalised for the time already spent failing.
 */
function grade(
  state: RunnerState,
  manifest: ModuleManifest,
  step: Step,
  env: RunnerEnv,
  outcome: "pass" | "fail",
  feedback: string,
  misconception?: string,
): RunnerState {
  const rt = state.runtime[step.id];
  if (!rt) return state;

  const event: AttemptEvent = {
    eventId: env.newEventId(),
    sessionId: state.sessionId,
    moduleCode: manifest.code,
    moduleVersion: manifest.version,
    stepId: step.id,
    stepSeq: step.seq,
    critical: step.critical,
    outcome,
    attemptIndex: rt.attemptIndex,
    elapsedMs: Math.max(0, env.now - rt.startedAt),
    hintUsed: rt.hintUsed,
    selfRecovered: outcome === "pass" && rt.attemptIndex > 0 && rt.hintUsed === 0,
    prompted: rt.hintUsed > 0,
    orderViolation: rt.orderViolation,
    ...(outcome === "fail" ? { failureKind: step.failure.kind } : {}),
    ...(outcome === "fail" && misconception ? { misconception } : {}),
    offline: env.offline,
    clientTs: env.now,
    locale: state.locale,
  };

  const runtime: StepRuntime = {
    ...rt,
    resolved: true,
    passed: outcome === "pass",
    feedback,
    ...(misconception ? { misconception } : {}),
  };

  return {
    ...state,
    runtime: { ...state.runtime, [step.id]: runtime },
    events: [...state.events, event],
    // Only the FIRST attempt defines the step's grade for the module; retries
    // improve the score but never erase the record that it was missed.
    outcomes: rt.attemptIndex === 0 ? { ...state.outcomes, [step.id]: outcome === "pass" } : state.outcomes,
  };
}

/** Patch the runtime of the current step without grading it. */
function patch(
  state: RunnerState,
  stepId: string,
  changes: Partial<StepRuntime>,
): RunnerState {
  const rt = state.runtime[stepId];
  if (!rt) return state;
  return { ...state, runtime: { ...state.runtime, [stepId]: { ...rt, ...changes } } };
}

/**
 * Ensure the current step has a runtime entry. Normally created on entry by
 * `enterStep`; this is the defensive path for a manifest edited mid-session.
 */
function ensureRuntime(state: RunnerState, step: Step, env: RunnerEnv): RunnerState {
  if (state.runtime[step.id]) return state;
  return {
    ...state,
    runtime: {
      ...state.runtime,
      [step.id]: {
        stepId: step.id,
        attemptIndex: 0,
        hintUsed: 0,
        satisfiedTargets: [],
        actionCursor: 0,
        orderViolation: false,
        resolved: false,
        passed: false,
        startedAt: env.now,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function runnerReduce(
  state: RunnerState,
  action: RunnerAction,
  env: RunnerEnv,
  manifest: ModuleManifest,
): RunnerState {
  if (action.type === "setArMode") {
    return { ...state, arMode: resolveARMode(action.mode) };
  }

  // Continue works on a resolved step, so it is handled before the guard below.
  if (action.type === "continue") {
    return applyContinue(state, env, manifest);
  }

  if (state.complete) return state;

  const step = currentStep(state, manifest);
  if (!step) return state;

  const withRuntime = ensureRuntime(state, step, env);
  const rt = withRuntime.runtime[step.id];
  if (!rt || rt.resolved) return withRuntime;

  switch (action.type) {
    case "hint": {
      if (withRuntime.phase === "recheck") return withRuntime;
      if (rt.hintUsed >= maxHintsFor(step)) return withRuntime;
      const hintUsed = rt.hintUsed + 1;
      return {
        ...patch(withRuntime, step.id, { hintUsed }),
        hintsUsed: withRuntime.hintsUsed + 1,
      };
    }

    case "tapTarget":
      return handleTapTarget(withRuntime, manifest, step, env, action.targetId);

    case "choose":
      return handleChoose(withRuntime, manifest, step, env, action.choiceId);

    case "perform":
      return handlePerform(withRuntime, manifest, step, env, action.elementId);

    default:
      return withRuntime;
  }
}

function handleTapTarget(
  state: RunnerState,
  manifest: ModuleManifest,
  step: Step,
  env: RunnerEnv,
  targetId: string,
): RunnerState {
  const rt = state.runtime[step.id];
  if (!rt) return state;

  const required = step.success.requiredTargets ?? (step.targets ?? []).map((tg) => tg.id);

  if (!required.includes(targetId)) {
    // A miss is graded, not ignored: the trainee needs the consequence, and the
    // attempt is exactly the evidence the heatmap is built from.
    return grade(
      state,
      manifest,
      step,
      env,
      "fail",
      t(step.failure.consequence, state.locale),
    );
  }

  if (rt.satisfiedTargets.includes(targetId)) return state;

  const satisfiedTargets = [...rt.satisfiedTargets, targetId];
  if (satisfiedTargets.length < required.length) {
    return patch(state, step.id, { satisfiedTargets });
  }

  return grade(
    state,
    manifest,
    step,
    env,
    "pass",
    t(step.instruction, state.locale),
  );
}

function handleChoose(
  state: RunnerState,
  manifest: ModuleManifest,
  step: Step,
  env: RunnerEnv,
  choiceId: string,
): RunnerState {
  const choice = (step.choices ?? []).find((c) => c.id === choiceId);
  if (!choice) return state;

  return grade(
    state,
    manifest,
    step,
    env,
    choice.correct ? "pass" : "fail",
    t(choice.consequence, state.locale),
    choice.correct ? undefined : choice.misconception,
  );
}

function handlePerform(
  state: RunnerState,
  manifest: ModuleManifest,
  step: Step,
  env: RunnerEnv,
  elementId: string,
): RunnerState {
  const rt = state.runtime[step.id];
  const elements = step.action?.elements ?? [];
  if (!rt || elements.length === 0) return state;

  const expected = elements[rt.actionCursor];

  if (elementId !== expected) {
    // Out of order. Sticky for the attempt, and graded immediately — content
    // says so, and a partial sequence is not a pass.
    const violated = patch(state, step.id, { orderViolation: true });
    return grade(
      violated,
      manifest,
      step,
      env,
      "fail",
      t(step.failure.consequence, state.locale),
    );
  }

  const actionCursor = rt.actionCursor + 1;
  if (actionCursor < elements.length) {
    return patch(state, step.id, { actionCursor });
  }

  return grade(
    patch(state, step.id, { actionCursor }),
    manifest,
    step,
    env,
    "pass",
    t(step.instruction, state.locale),
  );
}

function applyContinue(
  state: RunnerState,
  env: RunnerEnv,
  manifest: ModuleManifest,
): RunnerState {
  const step = currentStep(state, manifest);
  if (!step) return state;

  const rt = state.runtime[step.id];
  if (!rt || !rt.resolved) return state;

  // A cold re-check has exactly one attempt per sampled step. A wrong answer
  // there is the finding — there is nothing to retry into.
  const willRetry =
    !rt.passed && state.phase === "training" && step.failure.requiresRetry;

  if (willRetry) {
    return patch(state, step.id, {
      attemptIndex: rt.attemptIndex + 1,
      hintUsed: 0,
      satisfiedTargets: [],
      actionCursor: 0,
      orderViolation: false,
      resolved: false,
      passed: false,
      startedAt: env.now,
    });
  }

  const cursor = state.cursor + 1;
  return enterStep(
    {
      ...state,
      cursor,
      complete: cursor >= manifest.steps.length,
    },
    manifest,
    env.now,
  );
}

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

/** Attach manifest metadata the rubric needs to every emitted event. */
export function toStepRecords(
  state: RunnerState,
  manifest: ModuleManifest,
): Array<AttemptEvent & { maxHints: number; expectedMs: number; weight: number }> {
  return state.events.map((event) => {
    const step = manifest.steps.find((s) => s.id === event.stepId);
    return {
      ...event,
      maxHints: step ? maxHintsFor(step) : 1,
      expectedMs: step ? expectedMsFor(step) : 0,
      weight: step?.weight ?? 1,
    };
  });
}

/** First-attempt grades, as the re-check evaluator consumes them. */
export function recheckOutcomes(state: RunnerState): Record<string, boolean> {
  return { ...state.outcomes };
}

/** True once every step in the (possibly filtered) manifest has a grade. */
export function isFullyGraded(state: RunnerState, manifest: ModuleManifest): boolean {
  return manifest.steps.every((s) => state.outcomes[s.id] !== undefined);
}
