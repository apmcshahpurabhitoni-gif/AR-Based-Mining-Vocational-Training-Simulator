# 02 — Product Requirements Document

**Project:** KAVACH (working name) · **Statement:** SIH26041
**Version:** 2.0 · **Date:** 2026-09-29
**Revision:** Language scope reduced to **English + Hindi**; Santali declared, not built (01 §7.1)
**Governed by:** [01 — Gap Analysis](./01-gap-analysis.md), constraints C1–C8

---

## 1. Product statement

KAVACH is a headset-free augmented-reality safety training and certification platform for mine and
manufacturing workers in Jharkhand. A worker opens a link on their own phone, is trained through
real emergency procedures overlaid on their actual surroundings in English or Hindi, is scored on
demonstrated competence rather than attendance, and — only if they pass a cold re-check — receives
a signed, QR-verifiable certificate a supervisor can validate in the gallery with a second phone.

---

## 2. Users

### 2.1 Primary — Mine Worker

| Attribute | Detail |
|---|---|
| Context | New recruit, 0–30 days orientation, underground coal or surface mining |
| Language | Hindi primarily; English as fallback. **Santali users are a declared future, not an MVP user** |
| Literacy | Semi-literate. **Audio-first is mandatory, text is secondary.** |
| Device | Mid-range Android. Camera may be low-resolution. **No assumption of reliable connectivity.** |
| Tenure | High job turnover — the certificate must travel with the worker, not the employer |
| Motivation | Wants the job. Will disengage from a long lecture. Will engage with a 3-minute drill |
| **Job to be done** | *"Show me what to do before it happens, in a way I understand, and give me the paper that says I passed."* |

### 2.2 Secondary — Mine Supervisor / Safety Officer

Manages 50–200 workers. Needs to know who is compliant, who is not, and **which specific skill
their crew is failing**. Verifies certificates on site, in a gallery, with poor signal.

### 2.3 Tertiary — Training Coordinator / DGMS Inspector

Runs training programmes, audits certification records, needs exports and expiry tracking.

### 2.4 Admin — Organisation Owner

Manages sites, users, module content and policy. Uploads content, sets pass thresholds, revokes
certificates.

---

## 3. Scope

### 3.1 In scope — MVP (must ship)

| # | Capability | Priority |
|---|---|---|
| S1 | **AR Module A — Fire & Explosion.** Exit identification, extinguisher selection and use (PASS), evacuation sequencing | P0 |
| S2 | **AR Module B — Gas Leak & Confined Space.** Hazard zone recognition, PPE selection, buddy-system entry procedure | P0 |
| S3 | **Competence assessment engine** — first-attempt accuracy, self-recovery, sequencing integrity, hesitation, cold retention | P0 |
| S4 | **Signed QR certificate** with a public, zero-login verification page | P0 |
| S5 | **Certificate gate** — no issuance until cold re-check passed | P0 |
| S6 | **Bilingual UI** — English + Hindi, with a reserved `sat` locale slot | P0 |
| S7 | **Offline operation** after first sync, with queued event upload | P0 |
| S8 | **Admin dashboard** — compliance grid, step-level failure heatmap, expiry, CSV export | P0 |
| S9 | **Auth** — worker, supervisor, admin roles; route protection | P0 |
| S10 | **Feature-phone fallback** — no-AR path covering theory + assessment for both modules | P1 |

### 3.2 In scope — Post-MVP (stretch, cut freely)

| # | Capability | Priority |
|---|---|---|
| S11 | Extensible module framework — add a domain with data only (C3) | P1 |
| S12 | Spaced repetition re-certification reminders | P2 |
| S13 | Printable A4 marker sheets for indoor/low-light sites | P2 |
| S14 | WhatsApp certificate share | P2 |
| S15 | Difficulty adaptation per site accident history | P2 |
| S16 | **Santali (Ol Chiki) locale** — reserved slot, ships empty. Requires a native speaker for authoring and ~36 narration clips | P3 |

### 3.3 Explicitly out of scope

| Excluded | Reason |
|---|---|
| Native Android APK | PWA loads in 3 s with no install; APK is a demo-killer on a judge's phone |
| ARCore plane detection / world anchoring | Unreliable on mid-range hardware in an unfamiliar room — fails live on stage |
| **Santali strings and audio** | Declared, not built. Machine-translated safety instructions can kill; the locale slot is reserved and costs one JSON file to fill. *(01 §7.1)* |
| **L0 world tracking** | Cut from MVP. Not needed on stage and the highest demo-failure risk. Retained in the architecture as an optional enhancement. |
| **L1 printed-marker tracking** | Cut from MVP. L2 reticle mode delivers the same assessment with zero lighting dependency. |
| Public blockchain | Latency, cost and failure modes for zero benefit at this scale (see 01 §6) |
| Real VR / headset support | The statement rules it out; excludes the target population |
| HR integration / payroll | Out of the sector's control, not our differentiator |
| 3D character models, custom 3D assets | Cost/benefit is catastrophic; transparent markers + shader effects suffice |
| Licensed third-party content | C2 |
| The two unlisted domains as *content* | Statement is truncated; see [06](./06-content-spec.md) §5 |

---

## 4. Success metrics

### 4.1 Product success

| Metric | Target | How measured |
|---|---|---|
| Cold-start to first AR frame | < 5 s on mid-range Android, 4G | Field timing |
| Full Module A completion, first visit | < 4 min | Telemetry |
| Modules + assessment offline | 100% of training; cert issuance needs one online moment | Test |
| Cold re-check interval | ≥ 90 s after module completion | Spec |
| Time to verify a certificate | < 5 s including QR scan | Test |
| Verification page works with no login, no JS-blocking errors, poor signal | 100% | Test |
| Bilingual coverage | 100% of strings in `en` and `hi` | Build-time check |

### 4.2 Assessment validity (the differentiating claim)

| Metric | Target | Rationale |
|---|---|---|
| First-attempt accuracy captured on **every** step | 100% | C8 — no module-level aggregation |
| Gate blocks issuance on any critical-step miss | 100% of test runs | C4 |
| Distinguishes a coached pass from a competent pass | Must, via cold re-check | C7, Msweli et al. 2026 |
| Step-level heatmap resolves which skill a cohort fails | ≥ 1 identifiable weak step per module in pilot | Tier-1 claim #2 |

### 4.3 Hackathon success

| Metric | Target |
|---|---|
| Judge completes the AR walkthrough unaided | In 120 s, first attempt |
| Demo survives a failed camera permission | Fallback engages < 2 s |
| Demo survives no network | Full training path works; sync indicator visible |
| Certification question answered defensibly | Prepared answer in [08](./08-demo-script.md) |

---

## 5. Core user journeys

### 5.1 Worker — training and certification

```
Open link → pick language (Hindi default, English toggle, switchable anytime)
          → camera permission → module list
          → start Module A
          → for each step: hear instruction (audio) → act in real space
                        → app evaluates → advances or injects consequence
          → deliberate failure demo → retry → pass
          → Module B, same loop
          → cold re-check (random steps from both modules)
          → PASS → certificate issued, signed, QR shown
          → save to phone, optional WhatsApp share
```

### 5.2 Supervisor — verification

```
Supervisor phone → Camera → scan worker QR
                 → verification page: VALID / EXPIRED / REVOKED
                 → name, worker code, site, modules, dates
                 → works with no login and poor signal
```

### 5.3 Admin — compliance

```
Admin → dashboard
      → compliance grid: workers × modules, colour-coded
      → step-level failure heatmap → "40% of this crew fails extinguisher selection"
      → expiry radar → revoke / re-issue
      → CSV export → add worker, assign site
```

### 5.4 Offline return

```
Worker opens app with no network
  → app loads from service worker cache
  → training runs fully; every attempt written to local DB first
  → sync indicator shows "12 events queued"
  → on reconnect: queued events upload, server resyncs
  → certificate requires one online moment; thereafter verifiable offline from cached signed payload
```

---

## 6. Requirements

### 6.1 Functional

**FR-1 — AR module runner.** KAVACH shall execute a module defined entirely as data (C3). The
runner shall support step kinds `observe`, `act`, `decide`, each with a success criterion, a
failure state, and a hint ladder. Adding a module shall require zero code changes.

**FR-2 — Tracking fallback ladder.** The AR layer shall degrade explicitly:
`world tracking → image tracking (printed markers) → aim-and-tap reticle → non-AR guided mode`.
The active mode shall be surfaced in the UI. *(C6)*

**FR-3 — Competence scoring.** Every step attempt shall record: outcome, attempt index, elapsed
time, whether a hint was used, whether the trainee self-corrected without prompting, and the
sequence position. Aggregation shall occur at step level only. *(C4, C8)*

**FR-4 — Certificate gate.** A certificate shall not issue unless: both modules passed, all steps
scored, zero critical-step misses, overall first-attempt accuracy ≥ 80%, and the cold re-check
passed. *(C4, C7)*

**FR-5 — Signed certificate.** Certificates shall carry a canonical payload signed with Ed25519
via WebCrypto, verifiable client-side with no network. QR encodes an absolute verification URL.

**FR-6 — Verification page.** `/verify/:code` shall be public, require no login, render
bilingually, and distinguish `VALID` / `EXPIRED` / `REVOKED` / `NOT FOUND`.

**FR-7 — Bilingual coverage.** Every user-facing string shall exist in `en` and `hi`. The `sat`
key shall be present in the `Localised` type and absent from the shipped locale files — reserved,
not deleted, so filling it later is a data change. Language shall be switchable at any time
without losing session state. *(C5, 01 §7.1)*

**FR-8 — Offline-first.** After first sync the app shall function with no network. Attempt events
shall be written locally first and queued for upload. A visible sync indicator shall show queued
event count. *(C6)*

**FR-9 — Admin analytics.** The dashboard shall present a worker × module compliance grid and a
step-level failure heatmap. *(C8)*

**FR-10 — Audio-first.** Every step instruction shall have recorded audio in `en` and `hi`.
Audio shall play by default with text as a secondary layer. Text-only shall never be the sole
channel. Recorded audio only — no cloud TTS, since it is cloud-dependent and breaks offline.
*(C5)*

**FR-11 — Accessibility & low-literacy.** Minimum 18 px base text, high contrast, icon-led
instruction, no reliance on reading to complete a step.

**FR-12 — Role protection.** Only `admin` may manage users, content, thresholds, revocation.
`supervisor` may verify and view their site's compliance. Route guards on all protected routes.

### 6.2 Non-functional

| ID | Requirement |
|---|---|
| NFR-1 | ≥ 30 fps sustained on a mid-range Android in the AR view |
| NFR-2 | First load ≤ 5 s on 4G; app shell ≤ 2 MB gzipped excluding media |
| NFR-3 | Works on Android 10+; graceful degradation on Android 8 |
| NFR-4 | No runtime dependency on a paid third-party service. *(C1)* |
| NFR-5 | All assets MIT/Apache/OFL/CC0 or authored in-house. *(C2)* |
| NFR-6 | No PII in URLs; verification codes non-sequential and non-guessable |
| NFR-7 | Camera feed never leaves the device; no video upload |
| NFR-8 | Cold-start and first-frame measured on a real mid-range device before the demo |

---

## 7. Acceptance criteria

The MVP is **done** when all of the following pass on a real mid-range Android phone:

1. ✅ Both modules complete end-to-end, in AR, in under 4 minutes each
2. ✅ A deliberately wrong answer triggers a visible failure state and blocks the certificate
3. ✅ Repeating the failed step correctly unblocks it
4. ✅ The cold re-check runs after ≥ 90 s and can independently fail the trainee
5. ✅ A valid certificate is issued with a scannable QR
6. ✅ A second phone scans the QR and shows a correct bilingual result page
7. ✅ Toggling language re-renders all UI in Hindi Devanagari with no layout break
8. ✅ In airplane mode: both modules train fully, events queue, and the sync indicator is correct
9. ✅ Reconnecting uploads queued events and the dashboard reflects them
10. ✅ The admin heatmap identifies a specific weak step in a seeded cohort
11. ✅ A revoked certificate shows `REVOKED` on the verification page
12. ✅ The non-AR fallback path completes both modules on a device with no camera

---

## 8. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Hindi narration is not ready in time** | Low | High | Recording is a 30-minute job with any Hindi speaker on the team. English audio is the fallback. Not a critical risk any more — the language scope was cut for exactly this reason |
| R2 | ~~World tracking fails live in the demo room~~ | **Removed** | — | L0 world tracking is out of MVP. The demo runs on L2/L3, which cannot fail on lighting |
| R3 | Judge's phone lacks camera permission or is a desktop | Medium | Medium | L3 is a first-class mode, not an error state. Same modules, same assessment |
| R4 | "It's just a checklist, every team has one" | High | High | Lead with the cold re-check and the gate, not the feature list. SIH peers have the checklist; none have the gate |
| R5 | Blockchain challenge from judges | High | Medium | Prepared answer in [08](./08-demo-script.md); own the signed-token position |
| R6 | Scope creep into the three missing domains | Medium | Medium | Declared out of scope; architecture-ready only (06 §5) |
| R7 | Idempotency bug in the offline sync contract corrupts attempts | Medium | High | Idempotent event IDs; contract tests in [04](./04-data-model.md) |
| R8 | ~~Ol Chiki font fails to load offline~~ | **Removed** | — | No Ol Chiki in MVP. Reopens only if the `sat` locale is built |
| R9 | **Content accuracy** — a judge or reviewer finds a domain error in the module content | Medium | **High** | Obtain a qualified reviewer (DGMS officer, mining engineer, NMDC safety officer) before claiming correctness. Checklist in [06](./06-content-spec.md) §7 |
| R10 | **Narration is robotic or wrong** because Hindi was written by translation rather than a speaker | Low | High | Written with a native speaker, same discipline Santali would have required |

---

## 9. Open questions for the team

1. **Who reviews the content?** R9 is now the largest real risk. We need one qualified person —
   a DGMS officer, mining engineer, or NMDC/SAIL safety man — to read both modules before we claim
   correctness. **This is the first thing to resolve.**
2. **Is anyone on the team a native Hindi speaker** who can write and record the narration? Not a
   translator — a speaker. R10.
3. **Which accident reports** will the distractors be drawn from? Recommend DGMS-published reports
   plus the Adani Cupbhara 2019 fire. See [06](./06-content-spec.md) §1.2.
4. **Seed data strategy** — do we ship a demo cohort so the dashboard is never empty on stage?
   **Recommend yes** (07 §8).
5. **Which site/org names** appear in seed data? Avoid real company names.
6. **Is Unity/native ever on the table?** The PRD assumes no. Revisit only if a judge credits native.
