# 04 — Data Model & API Specification

**Project:** KAVACH · **Version:** 2.0 · **Date:** 2026-09-29
**Governed by:** [02](./02-prd.md) FR-3/4/5/8, [03](./03-product-spec.md)
**Backend:** Convex (reactive queries + mutations + Node actions for signing)

---

## 1. Schema overview

```
orgs ──┬── sites ──┬── users (via siteId)
       │           │
       │           ├── moduleAssignments
       │           │
       │           ├── sessions ──┬── attempts (step-level) ── recheckSamples
       │           │              └── assessments
       │           │
       │           └── certificates ── (signed payload, QR)
       │
       └── modules ─── steps
```

**Principle:** every learner-facing event is a row. Aggregates are derived, never stored as the
source of truth — so a bug in scoring can be fixed by recomputation. *(C8)*

---

## 2. Tables

### 2.1 `orgs` — mining or manufacturing organisation

```ts
orgs: defineTable({
  name: v.string(),
  type: v.union(v.literal("mine"), v.literal("plant")),
  contactEmail: v.string(),
  createdAt: v.number(),
}).index("by_name", ["name"]);
```

### 2.2 `sites`

```ts
sites: defineTable({
  orgId: v.id("orgs"),
  name: v.string(),
  region: v.string(),            // e.g. "North Karanpura"
  createdAt: v.number(),
}).index("by_org", ["orgId"]);
```

### 2.3 `users` — Convex Auth identity extended

```ts
users: defineTable({
  authId: v.optional(v.id("users")),   // Convex Auth principal
  name: v.string(),
  workerCode: v.optional(v.string()),  // WKR-JH-0001
  role: v.union(v.literal("worker"),
                v.literal("supervisor"),
                v.literal("admin")),
  orgId: v.id("orgs"),
  siteId: v.optional(v.id("sites")),
  // `sat` is a reserved slot: valid in the type, not shipped. (01 §7.1)
  preferredLocale: v.optional(
    v.union(v.literal("en"), v.literal("hi"), v.literal("sat"))),
  createdAt: v.number(),
}).index("by_org", ["orgId"])
 .index("by_site", ["siteId"])
 .index("by_worker_code", ["workerCode"])
 .index("by_role", ["role"]);
```

> **Note on the auth choice.** Phone + OTP is the obvious fit for Jharkhand and was rejected: OTP
> requires a reliable SMS path and a funded SMS gateway, and a semi-literate first-time user
> mistyping an OTP is a hard failure at the worst moment. **Username + password** plus a worker
> code is deterministic, works fully offline once synced, and is what the demographic supports.
> Recorded here as a deliberate decision because a judge will ask.

### 2.4 `modules`

```ts
modules: defineTable({
  code: v.string(),               // "FIRE" | "GAS"
  domain: v.string(),
  title: localisedStringValidator,   // { en, hi, sat? } — sat reserved (01 §7.1)
  version: v.string(),
  estimatedMinutes: v.number(),
  passScore: v.number(),          // 80
  manifest: v.any(),              // full Step[] JSON — C3
  published: v.boolean(),
  createdAt: v.number(),
}).index("by_code", ["code"]);
```

`manifest` is a single JSON document rather than a normalised `steps` table. Rationale: a module is
**read as a unit, written as a unit, and versioned as a unit.** Attempts reference
`stepId + moduleVersion`, so history survives a manifest edit.

### 2.5 `moduleAssignments`

```ts
moduleAssignments: defineTable({
  userId: v.id("users"),
  moduleCode: v.string(),
  assignedAt: v.number(),
  dueAt: v.optional(v.number()),
}).index("by_user", ["userId"])
 .index("by_module", ["moduleCode"]);
```

### 2.6 `sessions` — one training run

```ts
sessions: defineTable({
  userId: v.id("users"),
  moduleCode: v.string(),
  moduleVersion: v.string(),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  finalScore: v.optional(v.number()),
  passed: v.optional(v.boolean()),
  recheckEligibleAt: v.optional(v.number()),
  recheckPassed: v.optional(v.boolean()),
  deviceId: v.optional(v.string()),
  locale: v.string(),
}).index("by_user", ["userId"])
 .index("by_user_module", ["userId", "moduleCode"])
 .index("by_completed", ["completedAt"]);
```

### 2.7 `attempts` — **step-level, the core table** *(C8)*

```ts
attempts: defineTable({
  sessionId: v.id("sessions"),
  userId: v.id("users"),          // denormalised: heatmap queries don't join
  moduleCode: v.string(),
  moduleVersion: v.string(),
  stepId: v.string(),             // "A-03"
  stepSeq: v.number(),
  critical: v.boolean(),

  outcome: v.union(v.literal("pass"), v.literal("fail")),
  attemptIndex: v.number(),
  elapsedMs: v.number(),
  hintUsed: v.number(),
  selfRecovered: v.boolean(),
  prompted: v.boolean(),
  orderViolation: v.boolean(),
  failureKind: v.optional(v.string()),
  misconception: v.optional(v.string()),   // which wrong option, if any

  offline: v.boolean(),
  clientTs: v.number(),
  serverTs: v.optional(v.number()),

  eventId: v.string(),            // idempotency key — FR-8
}).index("by_session", ["sessionId"])
 .index("by_user_module", ["userId", "moduleCode"])
 .index("by_step", ["moduleCode", "stepId"])
 .index("by_event", ["eventId"])   // dedup on replay
```

**No aggregates are stored here.** Every score is recomputed from these rows.

### 2.8 `assessments`

```ts
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
  gateResults: v.any(),           // { G1..G8: { met, value, threshold } }
  recheckPassed: v.boolean(),     // C7
  issuedAt: v.number(),
}).index("by_user", ["userId"])
 .index("by_issued", ["issuedAt"]);
```

### 2.9 `certificates`

```ts
certificates: defineTable({
  code: v.string(),               // SK-2026-JH-00001 — human readable
  userId: v.id("users"),
  orgId: v.id("orgs"),
  siteId: v.optional(v.id("sites")),
  assessmentId: v.id("assessments"),

  payload: v.any(),               // canonical signed payload
  signature: v.string(),          // base64 Ed25519
  publicKeyId: v.string(),

  issuedAt: v.number(),
  expiresAt: v.number(),
  recheckPassedAt: v.number(),    // C7 audit trail
  revoked: v.boolean(),
  revokedAt: v.optional(v.number()),
  revokedReason: v.optional(v.string()),
}).index("by_code", ["code"])      // non-sequential, non-guessable
 .index("by_user", ["userId"])
 .index("by_org", ["orgId"])
 .index("by_expiry", ["expiresAt"]);
```

**Code generation:** `SK-<year>-JH-<8 chars base32 of 60 random bits>`. Human-readable prefix for
verbal checks, 60 bits of entropy so `/verify/:code` cannot be enumerated. *(NFR-6)*

### 2.10 `syncState` — offline queue bookkeeping

```ts
syncState: defineTable({
  userId: v.id("users"),
  pendingCount: v.number(),
  lastSyncAt: v.optional(v.number()),
  contentVersion: v.string(),     // module manifest hash — FR-8
}).index("by_user", ["userId"]);
```

---

## 3. Query & mutation surface

### Queries (reactive)

| Function | Args | Returns | Used by |
|---|---|---|---|
| `modules.list` | — | Published module summaries | Worker module list |
| `modules.get` | `{ code }` | Full manifest | Module runner |
| `progress.byUser` | `{ userId }` | Per-module status, scores, cert state | Worker home |
| `attempts.bySession` | `{ sessionId }` | Ordered attempt rows | Post-run summary |
| `certs.forUser` | `{ userId }` | Certificate list | Worker wallet |
| `verify.certificate` | `{ code }` | Public result — **no auth** | `/verify/:code` *(FR-6)* |
| `admin.complianceGrid` | `{ orgId }` | Workers × modules, colour-coded | Dashboard |
| `admin.stepHeatmap` | `{ orgId, moduleCode? }` | Fail rate + misconception per step | Dashboard *(C8)* |
| `admin.expiryRadar` | `{ orgId, days }` | Expiring / expired certs | Dashboard |
| `admin.users` | `{ orgId, siteId? }` | Roster | Dashboard |

`admin.*` all check the caller's role. `verify.certificate` is the **only** public query and returns
a deliberately thin payload — no worker PII beyond name, worker code, org, module list, dates.

### Mutations

| Function | Args | Notes |
|---|---|---|
| `sessions.start` | `{ moduleCode }` | Creates session, returns manifest |
| `sessions.complete` | `{ sessionId, finalScore }` | Recomputes from attempts, sets `recheckEligibleAt` |
| `attempts.record` | `{ events: AttemptEvent[] }` | **Batch, idempotent** on `eventId` |
| `assessments.finalize` | `{ sessionIds }` | Runs the rubric, evaluates G1–G8 |
| `certs.issue` | `{ assessmentId }` | Action — signs, only if gate passed |
| `certs.revoke` | `{ code, reason }` | Admin only |
| `users.register` | `{ name, username, siteId }` | Assigns `workerCode` |
| `modules.publish` | `{ code, manifest }` | Admin only |
| `sync.markSynced` | `{ count, contentVersion }` | Updates `syncState` |

### Actions (Node runtime)

| Function | Purpose |
|---|---|
| `certs.sign` | Ed25519 keypair from env, canonical JSON, sign, return `{ payload, signature, publicKey }` |
| `certs.verifySignature` | Verify an arbitrary payload+signature — used client-side on the offline cache |
| `certs.publicKey` | Publish the active public key |

Signing lives in an **action**, not a mutation, because it needs `process.env` for the private key.
**The private key never enters the client bundle.**

---

## 4. Certificate payload & signature

```jsonc
{
  "v": 1,
  "code": "SK-2026-JH-7F3K9QW2",
  "worker": { "name": "...", "workerCode": "WKR-JH-0001",
              "org": "...", "site": "..." },
  "modules": [
    { "code": "FIRE", "version": "1.0.0", "score": 88 },
    { "code": "GAS",   "version": "1.0.0", "score": 84 }
  ],
  "assessment": { "firstAttemptAccuracy": 0.86,
                  "criticalMisses": 0, "recheckPassed": true,
                  "recheckAt": 1780000000000 },
  "issuedAt":  1779999000000,
  "expiresAt": 1811535000000,
  "issuer": "kavach-jh"
}
```

Signed with **Ed25519 (WebCrypto)**, base64 signature, `publicKeyId` recorded.

**Why not a public chain** *(the expected judge challenge — 01 §6)*:
1. The verification page must work in a mine gallery with no signal. A chain read needs a gateway
   or a bundled light-client dataset — a real availability regression for a real cost.
2. Revocation on-chain is slow and contentious. Ours is a database flag reflected in the payload.
3. Per-issuance gas cost is a procurement problem for a government deployment model.
4. A chain does not improve tamper-evidence here: Ed25519 + a resolvable code gives the same
   guarantee for issuance, and *less* assurance if the key is compromised — a chain would not save
   us there either.

The chain would be theatre. **Say so.**

---

## 5. Offline sync contract *(FR-8)*

### Write path

```
1. Trainee acts
2. Append AttemptEvent to local Dexie store   ← ALWAYS FIRST (spec §9)
3. Update in-memory session state
4. If online: fire attempts.record batch (debounced ~1.5 s)
5. If offline or failed: leave queued, increment syncState.pendingCount
6. On reconnect: flush queue in order, dedup by eventId server-side
```

### Idempotency

Every `AttemptEvent` carries a client-generated UUID `eventId`. `attempts.record` upserts on
`eventId`; a replay is a no-op. **This is the single most important correctness property in the
system** — it is what makes a mid-flight reconnect harmless. *(R7)*

### Event shape

```ts
interface AttemptEvent {
  eventId: string;        // uuid v4, client-generated
  sessionId: string;      // client-side provisional id, reconciled on first push
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
  failureKind?: string;
  misconception?: string;
  clientTs: number;
  locale: string;
}
```

### Session id reconciliation

The first `attempts.record` for a provisional `sessionId` creates the real session and returns a
mapping; the client rewrites local rows. A `sessionIdMap` table caches the mapping so a second
device never resurrects a provisional id.

### Content sync

`contentVersion` = hash of the published manifest set. On launch the client compares its local
hash; a mismatch triggers a manifest refetch. Content is version-pinned, so an in-progress session
keeps running the manifest it started on.

### Conflict policy

**Last-write-wins on session completion; append-only on attempts.** Attempts are never edited
client-side after push — a correction is a new attempt row. Training telemetry is a log, not
mutable state.

---

## 6. Queries powering the dashboard *(C8)*

```ts
// Step-level heatmap — the Tier-1 differentiator
admin.stepHeatmap: query({
  args: { orgId, moduleCode? },
  handler: async (ctx, args) => {
    // attempts indexed by [moduleCode, stepId] within org scope
    // returns per step: { attempts, fails, failRate, topMisconception }
  }
})
```

Output feeds the claim: *"38% of this site's crew fails extinguisher type selection, and the
dominant wrong answer is 'water on a grease fire'."* That sentence is the product.

`admin.complianceGrid` returns one row per worker with a cell per module: `certified | expiring |
failed | in-progress | unassigned`, plus `lastActiveAt`.

---

## 7. Security

| Concern | Control |
|---|---|
| Private signing key | Convex action only, `process.env`, never in the client bundle |
| Public verification | No auth, but returns a **minimal** payload — no email, no phone, no site address |
| Code enumeration | 60-bit random codes; rate-limit `/verify` |
| Role escalation | All `admin.*` read the caller's role server-side; never trust the client *(FR-12)* |
| Camera privacy | Feed stays on device. No frame is ever uploaded *(NFR-7)* |
| PII in URLs | Verification uses an opaque code only |
| Certificate forgery | Ed25519 signature verified both server-side and client-side |

---

## 8. Test obligations

- [ ] `attempts.record` is idempotent — replaying a batch changes nothing
- [ ] Reconnect mid-batch never duplicates or loses an attempt
- [ ] Recomputing a score from raw attempts after a rubric change yields the new score
- [ ] Gate correctly blocks on a critical miss, a failed re-check, and < 80% first-attempt accuracy
- [ ] `/verify` returns `REVOKED` for a revoked cert and `NOT FOUND` for a random code
- [ ] A worker cannot read another worker's attempts; a supervisor cannot revoke a certificate
- [ ] Manifest version bump does not corrupt an in-progress session's attempts
