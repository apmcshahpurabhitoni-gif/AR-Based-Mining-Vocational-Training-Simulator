/**
 * Training sessions.
 *
 * A session is one run of one module. It is created when the trainee taps
 * START and completed when they finish the last step, but the interesting part
 * is what happens in between: nothing. Attempts arrive as an append-only batch
 * whenever the network allows, and every score is recomputed from raw rows.
 *
 * The client sends the module manifest with each batch. That looks redundant —
 * the server has the same manifests — but it is deliberate: the server scores
 * against the manifest the trainee actually saw, pinned by version. If content
 * is republished mid-session, the old session still scores against the old
 * steps instead of silently changing meaning.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUser } from "./auth";
import { insertAttemptBatch } from "./attempts";
import { RECHECK_MIN_DELAY_MS } from "../src/lib/gate";
import { scoreModule } from "../src/lib/scoring";
import type { ModuleManifest, Step, StepAttemptRecord } from "../src/lib/types";

/**
 * Open a session.
 *
 * Idempotent on `clientSessionId`: a trainee who trains offline and syncs
 * later gets their existing session adopted rather than a duplicate. Without
 * this, every offline run would fork into two rows on reconnect.
 */
export const startSession = mutation({
  args: {
    token: v.string(),
    moduleCode: v.string(),
    moduleVersion: v.string(),
    locale: v.string(),
    deviceId: v.optional(v.string()),
    clientSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_client_session", (q: any) => q.eq("clientSessionId", args.clientSessionId))
      .unique();
    if (existing) return { sessionId: existing._id, resumed: true };

    const sessionId = await ctx.db.insert("sessions", {
      userId: profile.id,
      moduleCode: args.moduleCode,
      moduleVersion: args.moduleVersion,
      startedAt: Date.now(),
      clientSessionId: args.clientSessionId,
      ...(args.deviceId ? { deviceId: args.deviceId } : {}),
      locale: args.locale,
    });

    return { sessionId, resumed: false };
  },
});

/**
 * Push a batch of attempts.
 *
 * Calls the same idempotent insert the self-test exercises, so the offline
 * replay contract is proven by the tests that already exist rather than by a
 * parallel implementation.
 */
export const pushAttempts = mutation({
  args: {
    token: v.string(),
    sessionId: v.id("sessions"),
    manifests: v.array(v.any()),
    events: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== profile.id) throw new Error("Session not found.");

    return insertAttemptBatch(ctx as any, {
      userId: profile.id,
      sessionId: args.sessionId,
      manifests: args.manifests as ModuleManifest[],
      events: args.events as any[],
    });
  },
});

/**
 * Close the session and store the authoritative module score.
 *
 * The score written here is the server's, recomputed from persisted rows — not
 * the number the device displayed. If the two ever disagree, this one wins and
 * the client shows a correction.
 */
export const completeSession = mutation({
  args: {
    token: v.string(),
    sessionId: v.id("sessions"),
    manifest: v.any(),
  },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== profile.id) throw new Error("Session not found.");

    const manifest = args.manifest as ModuleManifest;
    const rows = await ctx.db
      .query("attempts")
      .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
      .collect();

    const records: StepAttemptRecord[] = [];
    for (const row of rows) {
      const step = manifest.steps.find((s: Step) => s.id === row.stepId);
      if (!step) continue;
      records.push({
        eventId: row.eventId,
        sessionId: String(row.sessionId),
        moduleCode: row.moduleCode,
        moduleVersion: row.moduleVersion,
        stepId: row.stepId,
        stepSeq: row.stepSeq,
        critical: row.critical,
        outcome: row.outcome,
        attemptIndex: row.attemptIndex,
        elapsedMs: row.elapsedMs,
        hintUsed: row.hintUsed,
        selfRecovered: row.selfRecovered,
        prompted: row.prompted,
        orderViolation: row.orderViolation,
        ...(row.failureKind ? { failureKind: row.failureKind } : {}),
        ...(row.misconception ? { misconception: row.misconception } : {}),
        offline: row.offline,
        clientTs: row.clientTs,
        locale: row.locale,
        maxHints: Math.max(1, step.maxHints ?? step.hints.length),
        expectedMs: step.expectedMs ?? step.action?.expectedMs ?? 0,
        weight: step.weight ?? 1,
      });
    }

    const score = scoreModule(manifest, records);
    const now = Date.now();

    await ctx.db.patch(args.sessionId, {
      completedAt: now,
      finalScore: score.score,
      passed: score.score >= manifest.passScore,
      // The 90-second retention gap starts when the module is finished, not
      // when it was started (docs/03-product-spec.md §3.5).
      recheckEligibleAt: now + RECHECK_MIN_DELAY_MS,
    });

    return score;
  },
});

/** Session history for the trainee's own dashboard. */
export const mySessions = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.id))
      .collect();

    return rows
      .map((s: any) => ({
        id: s._id,
        moduleCode: s.moduleCode,
        startedAt: s.startedAt,
        completedAt: s.completedAt ?? null,
        finalScore: s.finalScore ?? null,
        passed: s.passed ?? null,
        recheckEligibleAt: s.recheckEligibleAt ?? null,
        recheckPassed: s.recheckPassed ?? null,
        locale: s.locale,
      }))
      .sort((a: any, b: any) => b.startedAt - a.startedAt);
  },
});

/**
 * When is the trainee eligible for the cold re-check?
 *
 * Returns the earliest time across their completed modules, plus the modules
 * still outstanding — the re-check needs both modules finished before it can
 * sample across them.
 */
export const recheckStatus = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.id))
      .collect();

    const completed = rows.filter((s: any) => typeof s.completedAt === "number");
    const now = Date.now();

    const perModule = new Map<string, any>();
    for (const s of completed) {
      const prev = perModule.get(s.moduleCode);
      if (!prev || (s.completedAt as number) > (prev.completedAt as number)) {
        perModule.set(s.moduleCode, s);
      }
    }

    const latest = [...perModule.values()];
    const earliestEligible = latest.length
      ? Math.min(...latest.map((s: any) => s.recheckEligibleAt))
      : null;

    const samples = await ctx.db
      .query("recheckSamples")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.id))
      .collect();

    return {
      modulesCompleted: latest.length,
      earliestEligibleAt: earliestEligible,
      eligible: earliestEligible !== null && now >= earliestEligible,
      msRemaining: earliestEligible === null ? RECHECK_MIN_DELAY_MS : Math.max(0, earliestEligible - now),
      alreadyTaken: samples.length > 0,
      lastTakenAt: samples.length ? Math.max(...samples.map((r: any) => r.takenAt)) : null,
    };
  },
});
