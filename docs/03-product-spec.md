# 03 — Product Specification

**Project:** KAVACH · **Version:** 2.0 · **Date:** 2026-09-29
**Revision:** `sat` reserved-not-shipped (01 §7.1); L0/L1 cut from MVP
**Governed by:** [01](./01-gap-analysis.md) C1–C8, [02](./02-prd.md) FR-1…FR-12

---

## 1. Step schema

Content is **data**. A step is a row, never a branch in code. *(C3)*

```ts
type StepKind = "observe" | "act" | "decide"

// `sat` is a RESERVED slot: present in the type, absent from shipped locale files.
// Shipping two locales instead of three is a missing file, not a refactor. (C5, 01 §7.1)
type Localised = { en: string; hi: string; sat?: string }

interface Step {
  id: string                    // stable, e.g. "A-04"
  moduleCode: string            // "FIRE" | "GAS"
  seq: number                   // 0-based, strictly increasing
  kind: StepKind
  critical: boolean             // any miss = hard fail (FR-4)

  instruction: Localised        // short, imperative, ≤ 8 words
  narrationKey: string          // audio asset key, e.g. "A-04.en" → "A-04.hi"

  // what the trainee must perceive (observe)
  targets: MarkerTarget[]
  // what the trainee must do (act)
  action?: {
    type: "sequence" | "hold" | "aim"
    elements: string[]          // ordered element IDs to interact with
    toleranceMs?: number        // max time before hesitation is recorded
  }
  // what the trainee must choose (decide)
  choices?: DecisionChoice[]

  success: SuccessCriterion
  failure: FailureState
  hints: Localised[]            // hint ladder, revealed in order
}

interface MarkerTarget {
  id: string                    // "exit-sign" | "extinguisher-co2" | "valve-main"
  markerAsset: string           // image-tracking target, or null for world-mode
  label: Localised
  position: { x: number; y: number }  // normalised fallback reticle position
}

interface DecisionChoice {
  id: string
  label: Localised
  correct: boolean
  consequence: Localised        // shown after selection regardless of correctness
  misconception?: string        // C4: which misconception this choice represents
}

interface SuccessCriterion {
  type: "identify" | "complete" | "select"
  requiredTargets?: string[]
  minAccuracy?: number          // 0..1, e.g. 0.8 for 4/5
}

interface FailureState {
  kind: "penalty" | "hazard" | "critical"
  consequence: Localised        // what visibly happens — smoke, dimming, countdown
  requiresRetry: boolean
  blocksCertificate: boolean
}
```

### Critical step policy *(C4, FR-4)*

`critical: true` means a first-attempt miss is a hard fail regardless of overall score. Approved
critical steps: **A-03** (extinguisher type), **A-05** (evacuation order), **B-02** (PPE for the
zone), **B-03** (permit/buddy entry), **B-05** (valve shut-off sequence).

---

## 2. Module state machine

One runner serves every module. This is what makes the product extensible. *(C3)*

```
                  ┌──────────────────────────────────────────┐
                  │                                          │
   ENTRY ──▶ INTRO ──▶ ACTIVE ──▶ (step passed) ──▶ next step ──▶ ...
                  │            │                            │
                  │            ├── step failed ──▶ FAILURE ──┤
                  │            │                  │         │
                  │            │                  ├─ hint 1..n (escalating)
                  │            │                  ├─ retry (same step)
                  │            │                  └─ critical → HALT
                  │            │                              │
                  │            └── all steps passed ──▶ COOLDOWN
                  │                                                │
                  └──── module complete ──────────────────────────┘
                                          │
                                          ▼
                                   COLD_RECHECK
                                   (random steps, ≥90s gap)
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                          PASSED                  FAILED
                              │
                              ▼
                   CERT_GATE evaluation (FR-4)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              CERTIFICATE          RETRY (targeted weak steps)
              ISSUED (P0)
```

**State enum:** `ENTRY | INTRO | ACTIVE | FAILURE | HINT | COOLDOWN | COLD_RECHECK | PASSED | FAILED | CERT_GATE | CERT_ISSUED`

### Transitions

| From | Event | To | Side effects |
|---|---|---|---|
| `ENTRY` | `START` | `INTRO` | Load step manifest, pre-cache audio |
| `INTRO` | `READY` | `ACTIVE` | Start AR session, request camera |
| `ACTIVE` | `STEP_PASS` | `ACTIVE` | Record attempt, advance `seq` |
| `ACTIVE` | `STEP_FAIL` (non-critical) | `FAILURE` | Record attempt, apply consequence |
| `ACTIVE` | `STEP_FAIL` (critical) | `FAILURE`→`HALT` | Record attempt, set `blocksCertificate` |
| `FAILURE` | `RETRY` | `ACTIVE` | Clear consequence, reset step timer |
| `FAILURE` | `HINT_REQUEST` | `HINT` | Increment hint index (recorded) |
| `HINT` | `TIMEOUT` / `ACK` | `FAILURE` | — |
| `ACTIVE` | last step passed | `COOLDOWN` | Module summary, set recheck eligibility |
| `COOLDOWN` | both modules done + 90 s elapsed | `COLD_RECHECK` | Sample steps, prioritise weak ones |
| `COLD_RECHECK` | all sampled steps passed | `COLD_RECHECK`→`PASSED` | — |
| `COLD_RECHECK` | any sampled step failed | `FAILED` | Block certificate, target weak steps |
| `PASSED` | gate evaluated true | `CERT_ISSUED` | Sign, persist, render QR |
| `PASSED` | gate evaluated false | `FAILED` | Show which criteria failed |

**Invariant:** no transition reaches `CERT_ISSUED` that has not passed `COLD_RECHECK`. *(C7)*

---

## 3. Assessment rubric

This is the differentiating component. *(C4, C8)*

### 3.1 Signals captured per attempt

| Signal | Type | Meaning |
|---|---|---|
| `outcome` | `pass` / `fail` | Correctness of this attempt |
| `attemptIndex` | 1, 2, 3… | Which try |
| `elapsedMs` | number | Time on step |
| `hintUsed` | 0..n | Hints consumed before success |
| `selfRecovered` | boolean | Passed **after** ≥1 fail **without** a hint *(strong positive signal)* |
| `prompted` | boolean | An external intervention occurred |
| `seqPosition` | number | Position in the required order |
| `orderViolation` | boolean | Acted out of sequence |
| `offline` | boolean | Recorded without network |
| `timestamp` | ISO | Client clock, reconciled server-side |

### 3.2 Per-step metrics

```
firstAttemptAccuracy   = (outcome₁ == pass) ? 1 : 0
hintDependency         = maxHintUsed / maxHints        (0..1, lower is better)
hesitation            = clamp((elapsedMs - expectedMs) / (2 × expectedMs), 0, 1)
selfRecovery           = any(selfRecovered) ? 1 : 0
orderIntegrity         = orderViolation ? 0 : 1
```

### 3.3 Module score (0–100)

```
W = { firstAttempt: 0.35, orderIntegrity: 0.15, selfRecovery: 0.15,
      hintDependency: 0.10, hesitation: 0.10, completeness: 0.15 }

moduleScore = round(100 × Σ(wᵢ × mᵢ))
  where hesitation contributes as (1 − hesitation)
```

`completeness` = fraction of steps ever passed, so a trainee who stalled out is capped.

### 3.4 Certificate gate *(FR-4, C7)*

All must hold:

| # | Criterion | Threshold |
|---|---|---|
| G1 | Module A passed | score ≥ 80 |
| G2 | Module B passed | score ≥ 80 |
| G3 | Zero critical-step first-attempt misses | required |
| G4 | Zero blocks-certificate failures | required |
| G5 | Overall first-attempt accuracy | ≥ 80% |
| G6 | Mean hint dependency | ≤ 0.3 |
| G7 | **Cold re-check passed** | ≥ 80% of sampled steps |
| G8 | Ordering integrity | both modules |

> **G7 is the one no competitor has.** It directly answers Msweli et al. (2026): immersive training
> produces short-term gains only. A certificate that survives a cold re-check is a claim about
> *retention*, not *attendance*.

### 3.5 Cold re-check sampling

- Eligible ≥ 90 s after module completion
- Sample **4 steps**: 2 from each module
- Always include the module's **highest-weight critical step**
- Bias 1 additional sample toward the trainee's weakest step
- Wrong answer here **fails the re-check** regardless of G1–G6

---

## 4. Scoring visualisation

Shown to the trainee live, and to the supervisor in the heatmap:

| Metric | Display | Meaning to a semi-literate worker |
|---|---|---|
| First-attempt accuracy | 4 filled / 1 empty circles | "How many you got right first time" |
| Steps completed | n / 6 | Icon row |
| Self-recovery | ✓ / ✗ | "You fixed your own mistake" |
| Hints used | 0–3 dots | "How much help you needed" |
| Final result | VALID / LOCKED | Large, colour-coded, icon-led |

No percentages alone. **Icons + colour + audio.** *(FR-11)*

---

## 5. Failure & consequence design

Failure must be *felt*, not just scored. This is what separates AR training from a quiz.

| Step class | Consequence | Effect |
|---|---|---|
| `penalty` | Minor: marker dims red, short buzzer | Reprompt, retry same step |
| `hazard` | Major: screen darkens, smoke overlay, audible alarm, countdown timer starts | Reprompt + hint ladder offered |
| `critical` | Severe: full hazard, countdown accelerates, "evacuate" banner | **Hard block.** Must repeat correctly |

Countdown pressures the retry — the emotional beat that makes the demo land.

**Deliberate-failure demo beat:** the operator knowingly picks the wrong extinguisher at A-03, the
screen darkens, the certificate panel visibly flips to **LOCKED**, they retry correctly, and it
unlocks. *This is the 120-second demo.* [08](./08-demo-script.md)

---

## 6. Fallback ladder *(C6, FR-2)*

Explicit degradation. Each level is a first-class supported mode, not an error state.

### MVP scope

| Level | Mode | In MVP | Requires | Degradation |
|---|---|---|---|---|
| **L0** | World tracking (8th Wall OSS / WebXR hit-test) | **No — cut** | WebXR-capable Android | Full spatial AR |
| **L1** | Image tracking on printed markers (MindAR) | **No — cut** | Camera + printed markers | Anchored to printed A4 markers |
| **L2** | Aim-and-tap reticle | **Yes — primary** | Camera | No anchoring; reticle over the object silhouette |
| **L3** | Non-AR guided mode | **Yes — fallback** | **Nothing** | Large photo + tap-the-object exercise, audio-led |

**L2 and L3 are the whole MVP.** L0 and L1 are retained in the architecture and the type system
(`ARMode` still has four members) so they can be re-enabled without a refactor, but neither is
built or demoed.

**Why this is the right cut.** L0 is the highest demo-failure risk — WebXR `immersive-ar` is
behind flags on a narrow device set, and plane detection in an unfamiliar room is the classic way
to lose a live demo. L1 is lighting-dependent and needs printed markers to exist beforehand. L2
delivers **the identical assessment and the identical pedagogy** — the trainee still points the
phone at the real extinguisher and still taps it — with zero tracking failure modes. For a
judge-held-phone demo in a room we have never seen, L2 is strictly more reliable.

**L3 is the safety net that makes the demo bulletproof** — it runs on a desktop, on a phone with
no camera, and on a feature phone via the text path. If the judge's phone refuses camera
permission, we drop to L3 in under 2 seconds and the demo continues.

Active mode is always visible in the UI. Degrade silently and the judge will not know why it
looks different — degrade *visibly* and it reads as engineering competence.

---

## 7. Module manifest structure

Both modules are identical in shape, differing only in data.

```json
{
  "code": "FIRE",
  "domain": "fire_and_explosion",
  "version": "1.0.0",
  "estimatedMinutes": 4,
  "passScore": 80,
  "steps": [ /* Step[] — see §1 */ ]
}
```

The `ModuleRunner` component is generic. **A third module is a JSON file and a seed record.** *(C3)*

Full step content: [06-content-spec.md](./06-content-spec.md).

---

## 8. Certificate display

Worker view:
- Large cert card, bilingual, Devanagari renders correctly
- QR code, high contrast, minimum 2 cm print-equivalent
- Worker code (`WKR-JH-0001`), cert code (`SK-2026-JH-00001`), issue date, expiry
- Module scores, re-check date
- **Offline copy cached** with signature for offline verification
- Save-to-phone + optional WhatsApp share *(P2)*

Supervisor verify view: `VALID` / `EXPIRED` / `REVOKED` / `NOT FOUND`, bilingual, no login, works
on poor signal.

---

## 9. Specification-level acceptance

- [ ] Adding a third module requires **no TypeScript change** — seed a manifest only *(C3)*
- [ ] Every step renders audio in both shipped locales; missing audio blocks release *(C5, FR-10)*
- [ ] A critical-step first-attempt miss always blocks the certificate *(C4)*
- [ ] Cold re-check cannot be skipped, rushed, or bypassed by refreshing *(C7)*
- [ ] Every attempt row exists in the local DB before any network call *(FR-8)*
- [ ] The AR view holds ≥ 30 fps on the test device
- [ ] L3 fallback completes both modules with no camera permission granted
- [ ] Language switch mid-module preserves `seq`, `attemptIndex` and all recorded signals *(C5)*
- [ ] A missing `sat` key renders nothing broken — the resolver falls back to `en` cleanly *(01 §7.1)*
