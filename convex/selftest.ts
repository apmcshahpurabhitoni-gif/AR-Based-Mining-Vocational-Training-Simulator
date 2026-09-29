/**
 * Backend self-test.
 *
 * Runs against the live Convex database, not a mock. It creates a throwaway
 * org/user/session, pushes a batch of attempts through the REAL ingest logic,
 * replays the identical batch to prove idempotency, rejects an event for an
 * unknown step, and reads the authoritative score back out through the shared
 * rubric.
 *
 * This is what makes the deployment claim verifiable rather than assumed.
 * Uses ctx.runMutation / ctx.runQuery so no HTTP client or deployment URL is
 * needed inside the action.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { scoreModule } from "../src/lib/scoring";
import type { ModuleManifest, Step, StepAttemptRecord } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Fixture — a compact but structurally real module
// ---------------------------------------------------------------------------

function s(o: Partial<Step> & { id: string }): Step {
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
    hints: [],
    expectedMs: 10_000,
    ...o,
  } as Step;
}

export const MANIFEST: ModuleManifest = {
  code: "FIRE",
  domain: "fire_and_explosion",
  title: { en: "Fire & Explosion", hi: "आग एवं विस्फोट" },
  version: "1.0.0",
  estimatedMinutes: 4,
  passScore: 80,
  steps: [
    s({ id: "A-01", seq: 0 }),
    s({ id: "A-02", seq: 1 }),
    s({ id: "A-03", seq: 2, critical: true, kind: "decide", expectedMs: 8000 }),
  ],
};

/** A clean first-attempt pass of every step. */
function cleanBatch(suffix: string) {
  return MANIFEST.steps.map((step, i) => ({
    eventId: `selftest-${suffix}-${step.id}`,
    sessionId: "provisional",
    moduleCode: "FIRE",
    moduleVersion: "1.0.0",
    stepId: step.id,
    stepSeq: step.seq,
    critical: step.critical,
    outcome: "pass" as const,
    attemptIndex: 1,
    elapsedMs: 4000,
    hintUsed: 0,
    selfRecovered: false,
    prompted: false,
    orderViolation: false,
    offline: false,
    clientTs: 1_700_000_000_000 + i,
    locale: "hi",
  }));
}

/** In-memory projection of the same events, for the parity check. */
function cleanBatchAsRecords(): StepAttemptRecord[] {
  return MANIFEST.steps.map((step, i) => ({
    eventId: `shadow-${i}`,
    sessionId: "shadow",
    moduleCode: "FIRE",
    moduleVersion: "1.0.0",
    stepId: step.id,
    stepSeq: step.seq,
    critical: step.critical,
    outcome: "pass" as const,
    attemptIndex: 1,
    elapsedMs: 4000,
    hintUsed: 0,
    selfRecovered: false,
    prompted: false,
    orderViolation: false,
    offline: false,
    clientTs: 1_700_000_000_000 + i,
    locale: "hi",
    maxHints: 1,
    expectedMs: step.expectedMs ?? 10_000,
    weight: 1,
  }));
}

// ---------------------------------------------------------------------------
// Database fixtures
// ---------------------------------------------------------------------------

export const seedSelfTest = internalMutation({
  args: { suffix: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();

    const orgId = await ctx.db.insert("orgs", {
      name: `selftest-mine-${args.suffix}`,
      type: "mine" as const,
      contactEmail: "selftest@example.invalid",
      createdAt: now,
    });

    const siteId = await ctx.db.insert("sites", {
      orgId,
      name: `selftest-site-${args.suffix}`,
      region: "selftest",
      createdAt: now,
    });

    const userId = await ctx.db.insert("users", {
      name: `Selftest Worker ${args.suffix}`,
      workerCode: `WKR-JH-${args.suffix}`,
      role: "worker" as const,
      orgId,
      siteId,
      preferredLocale: "hi" as const,
      createdAt: now,
    });

    const sessionId = await ctx.db.insert("sessions", {
      userId,
      moduleCode: "FIRE",
      moduleVersion: "1.0.0",
      startedAt: now,
      clientSessionId: `provisional-${args.suffix}`,
      locale: "hi",
    });

    return { orgId, siteId, userId, sessionId };
  },
});

/** Direct count of persisted attempt rows — proves dedupe really happened. */
export const countAttempts = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("attempts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    return rows.length;
  },
});

/** Authoritative score, computed by the shared rubric inside Convex. */
export const scoreSession = internalQuery({
  args: { sessionId: v.id("sessions"), manifest: v.any() },
  handler: async (ctx, args) => {
    const manifest = args.manifest as ModuleManifest;
    const rows = await ctx.db
      .query("attempts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const records: StepAttemptRecord[] = [];
    for (const row of rows) {
      const step = manifest.steps.find((st) => st.id === row.stepId);
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
        maxHints: Math.max(1, step.hints.length),
        expectedMs: step.expectedMs ?? step.action?.expectedMs ?? 0,
        weight: step.weight ?? 1,
      });
    }
    return scoreModule(manifest, records);
  },
});

// ---------------------------------------------------------------------------
// The test itself
// ---------------------------------------------------------------------------

type Check = { name: string; ok: boolean; detail: string };

interface SelfTestResult {
  passed: boolean;
  checks: Check[];
  rows: number;
  serverScore: number;
}

export const runSelfTest: ReturnType<typeof internalAction<any, any, SelfTestResult>> = internalAction({
  args: { suffix: v.string() },
  handler: async (ctx, args): Promise<SelfTestResult> => {
    const fixtures: { userId: any; sessionId: any } = await ctx.runMutation(
      internal.selftest.seedSelfTest,
      { suffix: args.suffix },
    );
    const { userId, sessionId } = fixtures;

    const checks: Check[] = [];
    const check = (name: string, ok: boolean, detail: string) => {
      checks.push({ name, ok, detail });
    };

    const batch = cleanBatch(args.suffix);

    // 1. First push — every event should insert.
    const first = await ctx.runMutation(internal.attempts.recordAttemptsInternal, {
      userId,
      sessionId,
      manifests: [MANIFEST],
      events: batch,
    });

    check(
      "first push inserts every event",
      first.inserted === 3 && first.duplicates === 0,
      `inserted=${first.inserted} duplicates=${first.duplicates}`,
    );

    // 2. Replay the identical batch — must be a no-op. This is the property the
    //    whole offline sync model rests on (docs/04 §5).
    const replay = await ctx.runMutation(internal.attempts.recordAttemptsInternal, {
      userId,
      sessionId,
      manifests: [MANIFEST],
      events: batch,
    });

    check(
      "replaying the same batch is a no-op",
      replay.inserted === 0 && replay.duplicates === 3,
      `inserted=${replay.inserted} duplicates=${replay.duplicates}`,
    );

    // 3. An event for a step that does not exist must be rejected, not stored.
    const withGhost = await ctx.runMutation(internal.attempts.recordAttemptsInternal, {
      userId,
      sessionId,
      manifests: [MANIFEST],
      events: [{ ...batch[0]!, eventId: `selftest-${args.suffix}-ghost`, stepId: "A-99" }],
    });

    check(
      "an unknown step id is rejected, not stored",
      withGhost.rejected === 1 && withGhost.inserted === 0,
      `rejected=${withGhost.rejected} inserted=${withGhost.inserted}`,
    );

    // 4. Exactly three rows persisted, despite three mutation calls.
    const rows: number = await ctx.runQuery(internal.selftest.countAttempts, { sessionId });
    check("exactly three attempt rows persisted", rows === 3, `rows=${rows}`);

    // 5. Authoritative score, computed by the shared rubric inside Convex.
    const serverScore: { score: number; passed: boolean; criticalMisses: number } =
      await ctx.runQuery(internal.selftest.scoreSession, {
        sessionId,
        manifest: MANIFEST,
      });

    check("a clean run scores 100", serverScore.score === 100, `score=${serverScore.score}`);
    check(
      "a clean run passes the threshold",
      serverScore.passed === true,
      `passed=${serverScore.passed}`,
    );
    check(
      "no critical misses on a clean run",
      serverScore.criticalMisses === 0,
      `criticalMisses=${serverScore.criticalMisses}`,
    );

    // 6. The same rubric, run in-process, must agree with the server's answer.
    //    This is the client/server parity contract from docs/07 §2.
    const localScore = scoreModule(MANIFEST, cleanBatchAsRecords());
    check(
      "client-side and server-side scoring agree",
      localScore.score === serverScore.score,
      `local=${localScore.score} server=${serverScore.score}`,
    );

    // 7. The rubric genuinely discriminates: a critical miss must change it.
    const failing = cleanBatchAsRecords().map((a) =>
      a.stepId === "A-03" ? { ...a, outcome: "fail" as const } : a,
    );
    const failScore = scoreModule(MANIFEST, failing);
    check(
      "a failed critical step is detected by the same rubric",
      failScore.criticalMisses === 1 && failScore.score < 100,
      `criticalMisses=${failScore.criticalMisses} score=${failScore.score}`,
    );

    return {
      passed: checks.every((c) => c.ok),
      checks,
      rows,
      serverScore: serverScore.score,
    };
  },
});
