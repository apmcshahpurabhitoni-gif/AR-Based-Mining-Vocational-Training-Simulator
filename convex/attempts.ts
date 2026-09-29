/**
 * Attempt ingestion and authoritative scoring.
 *
 * This module exists to prove two things and to serve as the reference
 * implementation for the rest of the backend:
 *
 *  1. The shared rubric actually runs inside Convex. The server imports the
 *     exact same `scoring.ts` / `gate.ts` the client uses, so a score can never
 *     disagree between the device and the authoritative decision.
 *  2. The offline sync contract from docs/04-data-model.md §5 holds. Every
 *     write is idempotent on `eventId`, so a replayed batch is a no-op.
 *
 * Content manifests are supplied as an argument rather than read from the
 * database here, so this file stays usable before step data exists.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { scoreModule, scoreOverall } from "../src/lib/scoring";
import { evaluateGate, evaluateRecheck } from "../src/lib/gate";
import type {
  ModuleManifest,
  RecheckSample,
  Step,
  StepAttemptRecord,
} from "../src/lib/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Project a persisted attempt row onto the shape the rubric expects. Kept in
 * one place so client and server cannot drift on which fields matter.
 */
function toStepRecord(attempt: {
  eventId: string;
  sessionId: any;
  moduleCode: string;
  moduleVersion: string;
  stepId: string;
  stepSeq: number;
  critical: boolean;
  outcome: "pass" | "fail";
  attemptIndex: number;
  elapsedMs: number;
  hintUsed: number;
  selfRecovered: boolean;
  prompted: boolean;
  orderViolation: boolean;
  failureKind?: "penalty" | "hazard" | "critical";
  misconception?: string;
  offline: boolean;
  clientTs: number;
  locale: string;
  step: Pick<Step, "hints" | "expectedMs" | "action" | "weight">;
}): StepAttemptRecord {
  return {
    eventId: attempt.eventId,
    sessionId: String(attempt.sessionId),
    moduleCode: attempt.moduleCode,
    moduleVersion: attempt.moduleVersion,
    stepId: attempt.stepId,
    stepSeq: attempt.stepSeq,
    critical: attempt.critical,
    outcome: attempt.outcome,
    attemptIndex: attempt.attemptIndex,
    elapsedMs: attempt.elapsedMs,
    hintUsed: attempt.hintUsed,
    selfRecovered: attempt.selfRecovered,
    prompted: attempt.prompted,
    orderViolation: attempt.orderViolation,
    ...(attempt.failureKind ? { failureKind: attempt.failureKind } : {}),
    ...(attempt.misconception ? { misconception: attempt.misconception } : {}),
    offline: attempt.offline,
    clientTs: attempt.clientTs,
    locale: attempt.locale,
    maxHints: Math.max(1, attempt.step.hints.length),
    expectedMs: attempt.step.expectedMs ?? attempt.step.action?.expectedMs ?? 0,
    weight: attempt.step.weight ?? 1,
  };
}

const stepById = (manifest: ModuleManifest, stepId: string): Step | undefined =>
  manifest.steps.find((s) => s.id === stepId);

// ---------------------------------------------------------------------------
// Write path — idempotent by eventId
// ---------------------------------------------------------------------------

const attemptEventValidator = v.object({
  eventId: v.string(),
  sessionId: v.string(),
  moduleCode: v.string(),
  moduleVersion: v.string(),
  stepId: v.string(),
  stepSeq: v.number(),
  critical: v.boolean(),
  outcome: v.union(v.literal("pass"), v.literal("fail")),
  attemptIndex: v.number(),
  elapsedMs: v.number(),
  hintUsed: v.number(),
  selfRecovered: v.boolean(),
  prompted: v.boolean(),
  orderViolation: v.boolean(),
  failureKind: v.optional(
    v.union(v.literal("penalty"), v.literal("hazard"), v.literal("critical")),
  ),
  misconception: v.optional(v.string()),
  offline: v.boolean(),
  clientTs: v.number(),
  locale: v.string(),
});

/** Shared write implementation — used by the public and internal entry points. */
export async function insertAttemptBatch(
  ctx: any,
  args: {
    userId: any;
    sessionId: any;
    manifests: ModuleManifest[];
    events: Array<{
      eventId: string;
      moduleCode: string;
      moduleVersion: string;
      stepId: string;
      stepSeq: number;
      critical: boolean;
      outcome: "pass" | "fail";
      attemptIndex: number;
      elapsedMs: number;
      hintUsed: number;
      selfRecovered: boolean;
      prompted: boolean;
      orderViolation: boolean;
      failureKind?: "penalty" | "hazard" | "critical";
      misconception?: string;
      offline: boolean;
      locale: string;
      clientTs: number;
    }>;
  },
) {
  const manifests = args.manifests;

  // One lookup per batch. The index makes this cheap, and it is what makes a
  // replayed batch harmless: an eventId already present is a no-op.
  const existing = new Set(
    (
      await ctx.db
        .query("attempts")
        .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
        .collect()
    ).map((row: any) => row.eventId),
  );

  let inserted = 0;
  let duplicates = 0;
  let rejected = 0;
  const rejectedIds: string[] = [];
  const now = Date.now();

  for (const event of args.events) {
    if (existing.has(event.eventId)) {
      duplicates += 1;
      continue;
    }

    const manifest = manifests.find((m) => m.code === event.moduleCode);
    const step = manifest ? stepById(manifest, event.stepId) : undefined;
    if (!step) {
      // Stale step from a superseded manifest version, or a module we do not
      // serve. Dropping it is correct: scoring ignores unknown steps anyway.
      rejected += 1;
      rejectedIds.push(event.eventId);
      continue;
    }

    await ctx.db.insert("attempts", {
      sessionId: args.sessionId,
      userId: args.userId,
      moduleCode: event.moduleCode,
      moduleVersion: event.moduleVersion,
      stepId: event.stepId,
      stepSeq: event.stepSeq,
      critical: event.critical || step.critical,
      outcome: event.outcome,
      attemptIndex: event.attemptIndex,
      elapsedMs: event.elapsedMs,
      hintUsed: event.hintUsed,
      selfRecovered: event.selfRecovered,
      prompted: event.prompted,
      orderViolation: event.orderViolation,
      ...(event.failureKind ? { failureKind: event.failureKind } : {}),
      ...(event.misconception ? { misconception: event.misconception } : {}),
      offline: event.offline,
      locale: event.locale,
      clientTs: event.clientTs,
      serverTs: now,
      eventId: event.eventId,
    });

    existing.add(event.eventId);
    inserted += 1;
  }

  return { inserted, duplicates, rejected, rejectedIds };
}

/**
 * Record a batch of attempt events.
 *
 * Idempotency is the whole point: the client may replay an entire batch after
 * a mid-flight reconnect, and doing so must not double-count. Returns how many
 * were newly inserted vs already present, so the client can clear its queue
 * with confidence.
 */
export const recordAttempts = mutation({
  args: {
    userId: v.id("users"),
    sessionId: v.id("sessions"),
    manifests: v.array(v.any()),
    events: v.array(attemptEventValidator),
  },
  handler: async (ctx, args) =>
    insertAttemptBatch(ctx, {
      userId: args.userId,
      sessionId: args.sessionId,
      manifests: args.manifests as ModuleManifest[],
      events: args.events,
    }),
});

/** Internal entry point, used by the backend self-test. */
export const recordAttemptsInternal = internalMutation({
  args: {
    userId: v.id("users"),
    sessionId: v.id("sessions"),
    manifests: v.array(v.any()),
    events: v.array(attemptEventValidator),
  },
  handler: async (ctx, args) =>
    insertAttemptBatch(ctx, {
      userId: args.userId,
      sessionId: args.sessionId,
      manifests: args.manifests as ModuleManifest[],
      events: args.events,
    }),
});

// ---------------------------------------------------------------------------
// Read path — authoritative scoring
// ---------------------------------------------------------------------------

/**
 * Recompute a module's score from persisted attempts using the shared rubric.
 *
 * This is the authoritative path. The client runs the identical functions for
 * live feedback; this is what the certificate is actually based on.
 */
export const scoreForModule = query({
  args: {
    sessionId: v.id("sessions"),
    manifest: v.any(),
  },
  handler: async (ctx, args) => {
    const manifest = args.manifest as ModuleManifest;
    const rows = await ctx.db
      .query("attempts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const records: StepAttemptRecord[] = [];
    for (const row of rows) {
      const step = stepById(manifest, row.stepId);
      if (!step) continue; // stale step from a previous manifest version
      records.push(
        toStepRecord({
          ...row,
          sessionId: row.sessionId,
          step,
        }),
      );
    }

    return scoreModule(manifest, records);
  },
});

/**
 * Full authoritative gate evaluation for one user across all modules.
 *
 * Accepts the manifests and the re-check outcomes so it is usable before the
 * content and re-check tables are populated.
 */
export const evaluateUserGate = query({
  args: {
    userId: v.id("users"),
    manifests: v.array(v.any()),
    recheckOutcomes: v.optional(v.array(v.object({ stepId: v.string(), passed: v.boolean() }))),
  },
  handler: async (ctx, args) => {
    const manifests = args.manifests as ModuleManifest[];

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const moduleScores = [];
    for (const manifest of manifests) {
      const session = sessions.find(
        (s) => s.moduleCode === manifest.code && s.completedAt !== undefined,
      );
      if (!session) {
        moduleScores.push(scoreModule(manifest, []));
        continue;
      }
      const rows = await ctx.db
        .query("attempts")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();
      const records: StepAttemptRecord[] = [];
      for (const row of rows) {
        const step = stepById(manifest, row.stepId);
        if (!step) continue;
        records.push(toStepRecord({ ...row, sessionId: row.sessionId, step }));
      }
      moduleScores.push(scoreModule(manifest, records));
    }

    const overall = scoreOverall(moduleScores);

    let recheck;
    if (args.recheckOutcomes && args.recheckOutcomes.length > 0) {
      const stored = await ctx.db
        .query("recheckSamples")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
      const samples: RecheckSample[] = stored.map((s) => ({
        stepId: s.stepId,
        moduleCode: s.moduleCode,
        critical: s.critical,
        reason: "critical-core" as const,
      }));
      const outcomes = Object.fromEntries(
        args.recheckOutcomes.map((o) => [o.stepId, o.passed]),
      );
      recheck = evaluateRecheck(samples, outcomes);
    }

    return {
      moduleScores,
      overall,
      gate: evaluateGate({ moduleScores, manifests, overall, ...(recheck ? { recheck } : {}) }),
    };
  },
});

export { attemptEventValidator };
