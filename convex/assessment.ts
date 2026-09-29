/**
 * Assessment: the gate, the cold re-check, and certificate issuance.
 *
 * This is the differentiator, so it is deliberately the only path to a
 * certificate. Nothing else in the codebase writes a `certificates` row.
 *
 * The gate is evaluated server-side from persisted attempt rows using the same
 * `scoring.ts` / `gate.ts` the client imports. There is exactly one
 * implementation of the rubric, which is why a device that was offline for a
 * week can still produce a score that agrees with the server's.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUser } from "./auth";
import { signPayload, verifyPayload } from "./crypto";
import { scoreModule, scoreOverall } from "../src/lib/scoring";
import { evaluateGate, evaluateRecheck, sampleRecheckSteps } from "../src/lib/gate";
import type {
  ModuleManifest,
  RecheckSample,
  Step,
  StepAttemptRecord,
} from "../src/lib/types";

/** Certificates are valid for one year. */
const CERT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function toRecord(row: any, step: Step): StepAttemptRecord {
  return {
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
  };
}

/**
 * Score one module from the trainee's most recent COMPLETED session.
 *
 * Most recent, not best. A trainee cannot improve their certification record
 * by re-taking the module until it goes well — the assessment is the most
 * recent honest performance, which is also the one a regulator would look at.
 */
async function scoreLatestSession(
  ctx: any,
  userId: any,
  manifest: ModuleManifest,
): Promise<{ score: ReturnType<typeof scoreModule>; sessionId: any }> {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();

  const session = sessions
    .filter((s: any) => s.moduleCode === manifest.code && s.completedAt !== undefined)
    .sort((a: any, b: any) => b.completedAt - a.completedAt)[0];

  if (!session) {
    return { score: scoreModule(manifest, []), sessionId: null };
  }

  const rows = await ctx.db
    .query("attempts")
    .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
    .collect();

  const records = rows
    .map((row: any) => {
      const step = manifest.steps.find((s: Step) => s.id === row.stepId);
      return step ? toRecord(row, step) : null;
    })
    .filter((r: StepAttemptRecord | null): r is StepAttemptRecord => r !== null);

  return { score: scoreModule(manifest, records), sessionId: session._id };
}

/**
 * The full authoritative picture for the signed-in trainee.
 *
 * Returns the gate with every criterion explained, so the result screen can
 * show precisely why a certificate was withheld rather than a red cross.
 */
export const myAssessment = query({
  args: { token: v.string(), manifests: v.array(v.any()) },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const manifests = args.manifests as ModuleManifest[];
    const moduleScores = [];
    const sessionIds: any[] = [];

    for (const manifest of manifests) {
      const { score, sessionId } = await scoreLatestSession(ctx, profile.id, manifest);
      moduleScores.push(score);
      if (sessionId) sessionIds.push(sessionId);
    }

    const overall = scoreOverall(moduleScores);

    const storedSamples = await ctx.db
      .query("recheckSamples")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.id))
      .collect();

    let recheck;
    if (storedSamples.length > 0) {
      const samples: RecheckSample[] = storedSamples.map((s: any) => ({
        stepId: s.stepId,
        moduleCode: s.moduleCode,
        critical: s.critical,
        reason: s.reason as RecheckSample["reason"],
      }));
      const outcomes = Object.fromEntries(
        storedSamples.map((s: any) => [s.stepId, s.outcome === "pass"]),
      );
      recheck = evaluateRecheck(samples, outcomes);
    }

    const gate = evaluateGate({
      manifests,
      moduleScores,
      overall,
      ...(recheck ? { recheck } : {}),
    });

    return { moduleScores, overall, gate, ...(recheck ? { recheck } : {}) };
  },
});

/**
 * The steps this trainee's cold re-check will sample.
 *
 * Sampling is server-side and deterministic, so the trainee cannot see the
 * sample list and prepare for it. `critical-core` steps come first, which is
 * the point: the re-check tests the things that kill people.
 */
export const myRecheckSample = query({
  args: { token: v.string(), manifests: v.array(v.any()) },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const manifests = args.manifests as ModuleManifest[];
    const moduleScores = [];
    for (const manifest of manifests) {
      const { score } = await scoreLatestSession(ctx, profile.id, manifest);
      moduleScores.push(score);
    }

    return sampleRecheckSteps({ manifests, moduleScores });
  },
});

/**
 * Record the cold re-check and re-evaluate the gate.
 *
 * G7 is fail-closed: if the re-check has not been taken, the gate cannot pass.
 * That is the whole product claim — a certificate here is a statement about
 * retention, not attendance.
 */
export const submitRecheck = mutation({
  args: {
    token: v.string(),
    manifests: v.array(v.any()),
    results: v.array(
      v.object({
        stepId: v.string(),
        moduleCode: v.string(),
        critical: v.boolean(),
        reason: v.string(),
        outcome: v.union(v.literal("pass"), v.literal("fail")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const manifests = args.manifests as ModuleManifest[];

    // The sample is recomputed server-side; the client's list is only used to
    // look up each answer. A client cannot re-test steps it was not assigned.
    const moduleScores = [];
    for (const manifest of manifests) {
      const { score } = await scoreLatestSession(ctx, profile.id, manifest);
      moduleScores.push(score);
    }
    const samples = sampleRecheckSteps({ manifests, moduleScores });

    const now = Date.now();
    let recorded = 0;

    for (const result of args.results) {
      const sample = samples.find((s) => s.stepId === result.stepId);
      if (!sample) continue;
      await ctx.db.insert("recheckSamples", {
        userId: profile.id,
        stepId: result.stepId,
        moduleCode: result.moduleCode,
        critical: result.critical,
        reason: sample.reason,
        outcome: result.outcome,
        takenAt: now,
      });
      recorded += 1;
    }

    const outcomes = Object.fromEntries(
      args.results
        .filter((r: (typeof args.results)[number]) =>
          samples.some((s: RecheckSample) => s.stepId === r.stepId),
        )
        .map((r: (typeof args.results)[number]) => [r.stepId, r.outcome === "pass"]),
    );
    const recheck = evaluateRecheck(samples, outcomes);

    const overall = scoreOverall(moduleScores);
    const gate = evaluateGate({ manifests, moduleScores, overall, recheck });

    return { recorded, recheck, gate };
  },
});

/**
 * Issue a certificate, if and only if the gate passes.
 *
 * Idempotent on the user: a second call returns the existing certificate
 * rather than minting a second one. A certificate that can be reissued on
 * demand is not evidence of anything.
 */
export const issueCertificate = mutation({
  args: { token: v.string(), manifests: v.array(v.any()) },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const existing = await ctx.db
      .query("certificates")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.id))
      .filter((q: any) => q.eq(q.field("revoked"), false))
      .first();

    if (existing) {
      return { issued: false as const, code: existing.code, reason: "already-issued" };
    }

    const manifests = args.manifests as ModuleManifest[];
    const moduleScores = [];
    const sessionIds: any[] = [];
    for (const manifest of manifests) {
      const { score, sessionId } = await scoreLatestSession(ctx, profile.id, manifest);
      moduleScores.push(score);
      if (sessionId) sessionIds.push(sessionId);
    }
    const overall = scoreOverall(moduleScores);

    const storedSamples = await ctx.db
      .query("recheckSamples")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.id))
      .collect();

    const samples: RecheckSample[] = storedSamples.map((s: any) => ({
      stepId: s.stepId,
      moduleCode: s.moduleCode,
      critical: s.critical,
      reason: s.reason as RecheckSample["reason"],
    }));
    const outcomes = Object.fromEntries(
      storedSamples.map((s: any) => [s.stepId, s.outcome === "pass"]),
    );
    const recheck = evaluateRecheck(samples, outcomes);

    const gate = evaluateGate({ manifests, moduleScores, overall, recheck });
    if (!gate.passed) {
      return {
        issued: false as const,
        code: null,
        reason: "gate-failed",
        failed: gate.failed,
      };
    }

    const assessmentId = await ctx.db.insert("assessments", {
      userId: profile.id,
      sessionIds,
      firstAttemptAccuracy: overall.firstAttemptAccuracy,
      meanHintDependency: overall.meanHintDependency,
      orderIntegrity: overall.orderIntegrity,
      selfRecoveryRate: overall.selfRecoveryRate,
      meanHesitation: overall.meanHesitation,
      moduleScoreA: moduleScores.find((m) => m.moduleCode === "FIRE")?.score,
      moduleScoreB: moduleScores.find((m) => m.moduleCode === "GAS")?.score,
      overallScore: overall.overallScore,
      criticalMisses: overall.criticalMisses,
      blockedFailures: overall.blockedFailures,
      gateResults: gate.criteria.map((c) => ({
        id: c.id,
        met: c.met,
        value: c.value,
        threshold: c.threshold,
        detail: c.detail,
      })),
      gatePassed: gate.passed,
      recheckPassed: recheck.passed,
      recheckTakenAt: Date.now(),
      issuedAt: Date.now(),
    });

    const user = await ctx.db.get(profile.id);
    const now = Date.now();
    const code = await mintCode();

    const payload = {
      v: 1,
      code,
      holder: user?.name ?? profile.name,
      workerCode: user?.workerCode ?? null,
      org: profile.orgName,
      modules: moduleScores.map((m) => ({ code: m.moduleCode, score: m.score })),
      overallScore: overall.overallScore,
      firstAttemptAccuracy: round3(overall.firstAttemptAccuracy),
      recheckPassed: recheck.passed,
      recheckScore: round3(recheck.score),
      issuedAt: now,
      expiresAt: now + CERT_TTL_MS,
    };

    const { signature, keyId } = await signForServer(payload);

    await ctx.db.insert("certificates", {
      code,
      userId: profile.id,
      orgId: profile.orgId,
      ...(user?.siteId ? { siteId: user.siteId } : {}),
      assessmentId,
      payload,
      signature,
      publicKeyId: keyId,
      issuedAt: now,
      expiresAt: now + CERT_TTL_MS,
      recheckPassedAt: now,
      revoked: false,
    });

    return { issued: true as const, code, assessmentId };
  },
});

/** Public verification. No token: this is what an inspector scans. */
export const verifyCertificate = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("certificates")
      .withIndex("by_code", (q: any) => q.eq("code", args.code.trim().toUpperCase()))
      .unique();

    if (!row) return { found: false as const };

    const user = await ctx.db.get(row.userId);
    const signatureValid = await verifyForServer(row.payload, row.signature);
    const now = Date.now();

    return {
      found: true as const,
      code: row.code,
      holder: user?.name ?? "Unknown",
      workerCode: user?.workerCode ?? null,
      orgId: row.orgId,
      payload: row.payload,
      signatureValid,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      revoked: row.revoked,
      revokedReason: row.revokedReason ?? null,
      expired: row.expiresAt <= now,
      valid: signatureValid && !row.revoked && row.expiresAt > now,
    };
  },
});

/** The trainee's own certificates. */
export const myCertificates = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const rows = await ctx.db
      .query("certificates")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.id))
      .collect();

    return rows
      .map((c: any) => ({
        code: c.code,
        payload: c.payload,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        revoked: c.revoked,
        expired: c.expiresAt <= Date.now(),
      }))
      .sort((a: any, b: any) => b.issuedAt - a.issuedAt);
  },
});

// ---------------------------------------------------------------------------
// Helpers that need the signing secret, kept out of the public surface
// ---------------------------------------------------------------------------

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Certificate codes: `KAV-` plus 60 bits of base32.
 *
 * Human-readable enough to read down a phone line, and not enumerable. A
 * sequential id would let anyone walk the certificate table.
 */
async function mintCode(): Promise<string> {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `KAV-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/**
 * The signing secret is read here and nowhere else.
 *
 * `crypto.ts` is a plain module, not a Convex function file: it exports no
 * `query`/`mutation`, so Convex never publishes it as a callable endpoint and
 * the secret cannot leak through the client bundle. That is what makes a static
 * import safe — a dynamic one buys nothing, and the Convex runtime does not
 * support dynamic imports at all.
 *
 * The literal fallback is a *local* convenience only. A local anonymous
 * deployment has no secret store to configure. A hosted one does, and silently
 * signing production certificates with a constant that is published in this
 * repository would make every signature forgeable by anyone who has read the
 * source — so a hosted deployment without a secret issues nothing at all.
 */
function signingSecret(): string {
  const secret = process.env.KAVACH_SIGNING_SECRET;
  if (secret) return secret;

  // Locality is read from the deployment URL, not from CONVEX_CLOUD_URL: the
  // local backend populates that one too, so testing it would refuse to issue
  // certificates on the very machine the pilot is developed against.
  //
  // An empty value is treated as local. This guard exists to catch a *hosted*
  // deployment that forgot to set a secret; being wrong in that direction is
  // harmless, whereas being wrong the other way would sign production
  // certificates with a published key.
  const deploymentUrl = process.env.CONVEX_URL ?? "";
  const isLocal =
    deploymentUrl === "" ||
    /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(deploymentUrl);

  if (!isLocal) {
    throw new Error(
      "KAVACH_SIGNING_SECRET is not set on this deployment. Certificates cannot be issued without it.",
    );
  }
  return "kavach-dev-signing-secret";
}

function signForServer(payload: unknown): Promise<{ signature: string; keyId: string }> {
  return signPayload(payload, signingSecret());
}

function verifyForServer(payload: unknown, signature: string): Promise<boolean> {
  return verifyPayload(payload, signature, signingSecret());
}
