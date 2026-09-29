/**
 * KAVACH Convex schema.
 *
 * Authored from docs/04-data-model.md §2. Ten tables, no more.
 *
 * Two invariants drive the design:
 *
 *  1. `attempts` is APPEND-ONLY and STEP-LEVEL. No aggregate is stored on it.
 *     Every score is recomputed from raw rows by the shared rubric, so fixing a
 *     weighting bug is a recomputation, not a migration. This is constraint C8
 *     and it is the reason the heatmap can exist at all.
 *
 *  2. `attempts.eventId` is INDEXED and UNIQUE in practice. It is the
 *     idempotency key that makes the offline sync model safe to retry.
 *     See docs/04-data-model.md §5.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Locales shipped in the MVP. `sat` is reserved and unfilled (01 §7.1). */
const locale = v.union(v.literal("en"), v.literal("hi"), v.literal("sat"));

/** `{ en, hi, sat? }` — sat optional so the slot is reserved, not required. */
const localised = v.object({
  en: v.string(),
  hi: v.string(),
  sat: v.optional(v.string()),
});

/**
 * Module manifests are stored as one JSON document rather than a normalised
 * `steps` table. A module is read, written and versioned as a unit; attempts
 * pin `moduleVersion` so editing a manifest never corrupts a live session.
 */
const moduleManifest = v.object({
  code: v.string(),
  domain: v.string(),
  title: localised,
  version: v.string(),
  estimatedMinutes: v.number(),
  passScore: v.number(),
  steps: v.array(v.any()),
});

export default defineSchema({
  // -- Organisation ---------------------------------------------------------
  orgs: defineTable({
    name: v.string(),
    type: v.union(v.literal("mine"), v.literal("plant")),
    contactEmail: v.string(),
    createdAt: v.number(),
  }).index("by_name", ["name"]),

  // -- Site -----------------------------------------------------------------
  sites: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    region: v.string(),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // -- Users ----------------------------------------------------------------
  // `authId` links to an external identity provider when one is configured.
  // Credentials here are the offline-capable path: a trainee on a mine floor
  // with no signal still has to be able to sign in and have their run recorded.
  // Passwords are never stored — only a PBKDF2-SHA256 hash and its salt.
  users: defineTable({
    authId: v.optional(v.string()),
    email: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    passwordSalt: v.optional(v.string()),
    name: v.string(),
    // Human-readable, e.g. WKR-JH-0001. Shown on certificates.
    workerCode: v.optional(v.string()),
    role: v.union(v.literal("worker"), v.literal("supervisor"), v.literal("admin")),
    orgId: v.id("orgs"),
    siteId: v.optional(v.id("sites")),
    preferredLocale: v.optional(locale),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_site", ["siteId"])
    .index("by_worker_code", ["workerCode"])
    .index("by_role", ["role"])
    .index("by_email", ["email"]),

  // -- Auth sessions --------------------------------------------------------
  // The bearer token is random; only its SHA-256 hash is persisted, so a
  // database read cannot reconstruct a live session. Tokens expire.
  authTokens: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["tokenHash"])
    .index("by_user", ["userId"])
    .index("by_expiry", ["expiresAt"]),

  // -- Module content -------------------------------------------------------
  // Content as data (C3). Adding a third domain is a new row, zero code.
  modules: defineTable({
    code: v.string(),
    domain: v.string(),
    title: localised,
    version: v.string(),
    estimatedMinutes: v.number(),
    passScore: v.number(),
    manifest: moduleManifest,
    published: v.boolean(),
    createdAt: v.number(),
  }).index("by_code", ["code"]),

  // -- Assignments ----------------------------------------------------------
  moduleAssignments: defineTable({
    userId: v.id("users"),
    moduleCode: v.string(),
    assignedAt: v.number(),
    dueAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_module", ["moduleCode"]),

  // -- Training session -----------------------------------------------------
  sessions: defineTable({
    userId: v.id("users"),
    moduleCode: v.string(),
    moduleVersion: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    finalScore: v.optional(v.number()),
    passed: v.optional(v.boolean()),
    // Epoch ms before which a cold re-check is not eligible (C7, 90 s gap).
    recheckEligibleAt: v.optional(v.number()),
    recheckPassed: v.optional(v.boolean()),
    // Provisional -> real id reconciliation for offline-created sessions.
    clientSessionId: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    locale: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_module", ["userId", "moduleCode"])
    .index("by_completed", ["completedAt"])
    .index("by_client_session", ["clientSessionId"]),

  // -- Attempt telemetry ----------------------------------------------------
  // APPEND-ONLY. No score column, no aggregate column, ever. C8.
  attempts: defineTable({
    sessionId: v.id("sessions"),
    // Denormalised: the admin heatmap must not join through sessions.
    userId: v.id("users"),
    moduleCode: v.string(),
    moduleVersion: v.string(),
    stepId: v.string(),
    stepSeq: v.number(),
    critical: v.boolean(),

    outcome: v.union(v.literal("pass"), v.literal("fail")),
    attemptIndex: v.number(),
    elapsedMs: v.number(),
    hintUsed: v.number(),
    // Passed after >= 1 fail with no hint. Strong positive signal.
    selfRecovered: v.boolean(),
    prompted: v.boolean(),
    orderViolation: v.boolean(),

    failureKind: v.optional(
      v.union(v.literal("penalty"), v.literal("hazard"), v.literal("critical")),
    ),
    // Names the real-world misconception. Powers the step heatmap. C8.
    misconception: v.optional(v.string()),

    // True when recorded on-device with no network (FR-8).
    offline: v.boolean(),
    // Locale the trainee was served in. Lets the dashboard compare outcomes
    // across languages once the `sat` locale is built.
    locale: v.string(),
    clientTs: v.number(),
    serverTs: v.optional(v.number()),

    // Idempotency key for the whole offline sync model. MUST be unique.
    eventId: v.string(),
  })
    .index("by_session", ["sessionId"])
    .index("by_user_module", ["userId", "moduleCode"])
    .index("by_step", ["moduleCode", "stepId"])
    .index("by_event", ["eventId"]),

  // -- Cold re-check results ------------------------------------------------
  // Stored separately from `attempts` so a re-check is provably a distinct
  // event, not a second pass over the same steps. C7.
  recheckSamples: defineTable({
    assessmentId: v.optional(v.id("assessments")),
    userId: v.id("users"),
    stepId: v.string(),
    moduleCode: v.string(),
    critical: v.boolean(),
    reason: v.string(),
    outcome: v.union(v.literal("pass"), v.literal("fail")),
    takenAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_step", ["stepId"]),

  // -- Assessment -----------------------------------------------------------
  // Gate results are persisted so a certificate can be audited after the fact.
  assessments: defineTable({
    userId: v.id("users"),
    sessionIds: v.array(v.id("sessions")),
    firstAttemptAccuracy: v.number(),
    meanHintDependency: v.number(),
    orderIntegrity: v.number(),
    selfRecoveryRate: v.number(),
    meanHesitation: v.number(),
    moduleScoreA: v.optional(v.number()),
    moduleScoreB: v.optional(v.number()),
    overallScore: v.number(),
    criticalMisses: v.number(),
    blockedFailures: v.number(),
    // { G1..G8: { met, value, threshold, detail } }
    gateResults: v.array(
      v.object({
        id: v.string(),
        met: v.boolean(),
        value: v.number(),
        threshold: v.number(),
        detail: v.string(),
      }),
    ),
    gatePassed: v.boolean(),
    recheckPassed: v.boolean(),
    recheckTakenAt: v.optional(v.number()),
    issuedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_issued", ["issuedAt"]),

  // -- Certificates ---------------------------------------------------------
  certificates: defineTable({
    // Human-readable prefix plus 60 bits of base32 entropy, so /verify/:code
    // cannot be enumerated. Never expose a sequential id for this. NFR-6.
    code: v.string(),
    userId: v.id("users"),
    orgId: v.id("orgs"),
    siteId: v.optional(v.id("sites")),
    assessmentId: v.id("assessments"),

    // Canonical payload. Stored verbatim so it can be re-verified.
    payload: v.any(),
    // base64 HMAC-SHA256 over the canonical payload. Makes a tampered
    // certificate detectable even if someone edits the stored row.
    signature: v.string(),
    publicKeyId: v.string(),

    issuedAt: v.number(),
    expiresAt: v.number(),
    recheckPassedAt: v.number(),
    revoked: v.boolean(),
    revokedAt: v.optional(v.number()),
    revokedReason: v.optional(v.string()),
  })
    .index("by_code", ["code"])
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .index("by_expiry", ["expiresAt"]),

  // -- Offline sync bookkeeping ---------------------------------------------
  syncState: defineTable({
    userId: v.id("users"),
    pendingCount: v.number(),
    lastSyncAt: v.optional(v.number()),
    // Hash of the published manifest set; mismatch triggers a refetch.
    contentVersion: v.string(),
  }).index("by_user", ["userId"]),
});
