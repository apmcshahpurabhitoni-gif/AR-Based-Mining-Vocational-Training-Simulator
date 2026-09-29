# 01 — Gap Analysis & Positioning

**Project (working name):** KAVACH (कवच — "armour / shield")
**Statement:** SIH26041 — AR-Based Vocational Training Simulator for Industrial Safety (Govt. of Jharkhand)
**Status:** Locked. This document constrains every downstream product decision.
**Revision:** 2.0 — language scope revised to **English + Hindi shipped, Santali declared-not-built**
**Date:** 2026-09-29

> Working name is provisional and unverified as a trademark. All docs reference `KAVACH` as the
> codename so specs stay consistent; renaming is a find-and-replace of one token.

---

## 1. The one-paragraph problem

New workers in Jharkhand's mines and steel plants receive safety training as a classroom lecture
plus a printed manual, and a week later almost none of it has stuck. Live drills disrupt
production. VR headsets cost more than a small operator earns per worker per month. The result is
a workforce that is *certified* and *unprepared* — and because the certification itself is a
paper record nobody can verify, no one can even prove the gap exists. KAVACH closes the loop:
headset-free AR training on the phone a worker already owns, in English and Hindi, scored on
demonstrated competence rather than attendance, and closed with a certificate a supervisor can
verify by scanning a code in the mine gallery.

---

## 2. Research findings — what already exists

### 2.1 Immersive industrial safety training: saturated, VR-dominated, expensive

| Player | Type | Capability | Why it constrains us |
|---|---|---|---|
| Pixaera | Commercial | Full VR plant simulation, per-site digital twins | Most credible enterprise product in the category |
| 360 Immersive (MVST) | Commercial | 60+ microlearning courses, VR + eLearning | Largest content library; sold to contractors globally |
| Immersive Factory | Commercial | Full-scale VR manufacturing, robotic cell training | Highest production values in the set |
| Humulo | Commercial | Hand-tracked VR, fully interactive procedures | Claims measurable procedure-retention advantage over 360° video |
| NextWorldXR | Commercial | VR confined-space entry, virtual gas monitors, LOTO | **Directly overlaps KAVACH Module B** |
| Tech-Labs | Commercial | Confined space entry simulation | Overlaps Module B |
| AK Preparedness | Commercial | VR fire drills and evacuation | Overlaps Module A |
| MSHA (US) | Government | Part 46 training, MineSAFE serious games, tabletop, mobile app | Free, established, **zero AR, zero localisation** |
| NIOSH / Arizona | Government | Tabletop activities, curricula, research base | Same |
| CHRP India | Commercial | VR learning for women mine employees | **A domestic incumbent already in VR** |

**Academic prior art (citation base):**

- **Tichon et al.** — *A Review of Virtual Reality as a Medium for Safety Related Training in
  Mining*. ~173 citations. The canonical review of the medium.
- **Scorgie et al. 2024**, *Safety Science* — systematic review + meta-analysis, ~311 citations.
  **Primary finding: VR safety training outperforms traditional safety training.**
- **Paes et al. 2024**, *Building and Environment* — optical see-through AR fire safety training.
  Participants rated AR **superior to conventional evacuation training**.
- **Catal et al. 2020**, *Fire Technology* — AR evacuation training game, ~92 citations.
- **Hung et al. 2025**, *MDPI Safety* — VR in building evacuation, systematic review.
- **Kang et al. 2023**, *IEEE* — integrated AR/VR fire drills produced higher average scores.
- **Msweli et al. 2026**, *IEEE* — VR for machinery safety. **Critical caveat: short-term gains
  only, concentrated on hazard identification and procedural tasks.**
- **Bellanca et al. 2026**, CDC/NIOSH — pre-implementation evaluation of VR as a mine safety tool.
- **Springer 2024** — AR system for heavy equipment operators, surface mining.
- **WVU / ASME 2025** — AR mine safety modules for haulage-machinery visibility awareness.

**Implication.** "We built immersive safety training" is not a claim. The category is full, and it
is full of better-funded companies with more content. The word *AR* is not a differentiator on its
own — Catal, Paes, WVU and at least one commercial vendor already ship AR.

### 2.2 WebAR: the enabling technology just became free

The single most important technical finding of this research phase.

| Library | Licence | Stars | Capability | Fit for KAVACH |
|---|---|---|---|---|
| **MindAR** (`hiukim/mind-ar-js`) | MIT | 2,740 | Image + face tracking, TF.js | Deterministic fallback — high-value |
| **AR.js** (`AR-js-org/AR.js`) | MIT | 5,996 | Image, marker, location-based AR | Marker-based fallback |
| **Three.js** | MIT | 116,057 | Renderer | Primary render layer |
| **React Three Fiber** | MIT | 32,605 | React renderer for Three.js | Primary app integration |
| **A-Frame** | MIT | 17,644 | WebXR scene graph | Alternative declarative route |
| 8th Wall | — | — | **Now open source** — world + image tracking | Primary world-tracking path |
| `react-three-mind` | none | 53 | MindAR + R3F bridge | Reference only — unlicensed, do not depend on |
| Zapworks / Mattercraft, AR Code | commercial | — | SaaS WebAR | Avoid — vendor lock-in, churn |

**Implication.** In 2024 "world tracking on a mid-range Android with no headset at no cost" was not
achievable. As of this research it is. This materially de-risks the core technical bet and means
KAVACH can be built on a 100% open-source, zero-vendor-licence stack — a genuine advantage in a
government procurement context where per-seat VR licences are disqualifying.

### 2.3 Certification & verification: mature, and the main credibility test

| System | Region | What it does |
|---|---|---|
| **CSCS / My CSCS Digital Skills Passport** | UK | Launched June 2025. QR card verification via *CSCS Smart Check*, real-time employer compliance. **The benchmark.** |
| POK | Global | Blockchain-backed diplomas, Open Badges, 50+ LMS integrations |
| BCdiploma | Global | Blockchain-secured certificates, 250+ institutions |
| TrueOriginal, CredSure, VerifyEd | Global | Tamper-evident digital credentials |
| `openwallet-foundation/credo-ts` | OSS | Apache-2.0. TypeScript framework for verifiable credentials |
| `bcgov/issuer-kit`, `trustbloc/vcs` | OSS | Verifiable credential issuer/reference stacks |
| ACM 2024 | Research | Smart credentialing and verification for national certificates |

**Implication.** "QR certificate with a verification endpoint" is **table stakes**, not innovation.
CSCS shipped exactly this at national construction-industry scale in 2025. Any judge with sector
knowledge will know. KAVACH must present this as a *prerequisite it met*, never as its idea.

### 2.4 Offline / low-resource delivery: solved in education, unsolved in safety

- **Eneza Education** (Kenya, Ghana, Côte d'Ivoire) — lessons and assessments delivered over **SMS
  and USSD** on any phone, subscription, aligned to national curriculum. Validated the model.
- **Shupavu291** (Kenya, One Laptop) — 24/7 curriculum over **SMS on feature phones**, quizzes,
  "Ask a Teacher".
- **GSMA Mobile Economy 2023** — >75% of sub-Saharan Africans own a mobile; only **~35% own a
  smartphone with internet access**.

**Implication.** Two things. First, the offline-first low-bandwidth pattern is *proven* and
citable — cite Eneza. Second, **the statement's "mid-range Android" assumption is optimistic** for
the Jharkhand coal belt. A defensible design must degrade gracefully to a non-AR path. See
[03-product-spec.md](./03-product-spec.md) §6.

### 2.5 Santali / Ol Chiki: thin, and out of MVP scope

- **Google Translate added Ol Chiki support** (~2025) — real but a long tail.
- **Noto Sans Ol Chiki** on Google Fonts — OFL licence, bundleable.
- Academic work (Choksi 2020, *Signs and Society*) treats **Romanised Santali** as dominant and
  digital Santali as an **unsolved problem**.

**Decision: Santali is declared, not built.** See §7.1. The technical cost of shipping it is one
JSON file and one audio directory; the cost of shipping it *badly* — machine-translated safety
instructions delivered to a mine — is not acceptable. We hold the locale slot open and refuse to
fill it with a guess.

### 2.6 GitHub and public-platform prior art

Searched GitHub across eight query families: AR safety training, AR fire evacuation, VR safety
training, WebXR training, mine safety simulation, AR fire, safety training games, AR evacuation.

**Finding: the open-source space for this exact product is effectively empty.** Roughly 40 repos
surfaced; every one is a student or hobby project with **0–5 stars**, and the vast majority are
**unlicensed** (default all-rights-reserved, therefore not reusable).

Repos explicitly targeting SIH26041, all found and dated:

| Repo | Stack | Created | State |
|---|---|---|---|
| `printezz01/A.R.M.O.R` | PostgreSQL/Supabase + React | 2026-09-10 | **Most developed.** Full `PROJECT_CONTEXT.md`, API contract, 7-phase production hardening report. Claims QR certs, offline, Santali, dashboard. |
| `Manya945/suraksha-ar` | Static HTML/CSS/JS | 2026-09-24 | **Largest single-file build** (730 KB portable HTML). Live on GitHub Pages + Netlify. 6 modules, 360° simulator, verify page, admin deck. |
| `inirah-h/AR-Safety-Training` | Static web | 2026-09-08 | 28 KB. Prototype. |
| `Vinit3110/AR_Training` | Unity / ShaderLab | 2026-09-24 | 31 MB. Unity AR Foundation. |
| `lavikumar-dev/AR-Safety-Training-Simulator` | Unity / ShaderLab | 2026-08-23 | 78 MB. Unity AR Foundation. |
| `Rayed2874/AR---SAFE` | TypeScript | 2026-08-31 | 425 KB, no README. |
| `Codexxa-Business-Solution/indussim-sdk` | — | 2026-04-18 | 8 KB stub. |

**What this changes.** Competitors for this statement are *not* global VR vendors — they are a
handful of other SIH teams in the same cohort, several already shipping trilingual offline demos.
The competitive set is roughly 290–500 teams on this statement alone, and the ones we can see have
converged on an **identical feature checklist** already. `suraksha-ar` already has: trilingual
Hindi/Santali/English, offline PWA, QR verification, admin dashboard, DGMS framing, 360° hazard
hunt, PPE locker, PASS extinguisher, 4-gas detector, LOTO, evacuation. `A.R.M.O.R` already claims
all of it plus difficulty scaling and spaced repetition.

**Consequence for strategy.** A feature-checklist match guarantees a tie and loses on execution
quality. The differentiation must come from things competitors have *not* built, and from
depth on the ones they have. The competitor repos also confirm the stack choice is sound (all
converged on web/PWA or Unity; nobody chose the expensive middle) and confirm the domain content
(PASS extinguisher, 4-gas, LOTO, refuge chamber) is the right content.

---

## 3. Capability matrix

Legend: ● full, ◐ partial, ○ absent

| Capability | VR incumbents | WebAR builders | MSHA / gov | Eneza / Shupavu | CSCS | SIH peers | **KAVACH** |
|---|---|---|---|---|---|---|---|
| Immersive training | ● | ● | ○ | ○ | ○ | ● | ● |
| Headset-free, phone-only | ○ | ● | ● | ● | — | ● | ● |
| **Competence-based assessment** | ○ | ○ | ◐ quiz | ◐ quiz | ○ | ◐ gamified | **●** |
| Verifiable certificate | ○ | ○ | ○ | ○ | ● | ● | ● |
| QR on-the-spot verification | ○ | ○ | ○ | ○ | ● | ● | ● |
| Fully offline | ○ | ◐ | ○ | ● | ● | ● | ● |
| Hindi localisation | ○ | ○ | ○ | ◐ | ○ | ◐ | **●** |
| Compliance dashboard | ◐ | ○ | ○ | ○ | ● | ● | ● |
| Non-smartphone path | ○ | ○ | ● | ● | — | ○ | **●** |
| **Step-level failure heatmap** | ○ | ○ | ○ | ○ | ○ | ◐ | **●** |
| **Cold-retention re-check gate** | ○ | ○ | ○ | ○ | ○ | ○ | **●** |
| Zero licence cost | ○ | ● | ● | ● | — | ● | **●** |
| *Indigenous-language (Santali)* | ○ | ○ | ○ | ◐ | ○ | ◐ machine | *declared* |

**The two cells where KAVACH is alone — cold-retention re-check and step-level heatmap — are the
product.** Everything else is a checkbox. Santali moved from a differentiator to a declared
extension; the analysis no longer depends on it.

---

## 4. Defensible claims, ranked

### Tier 1 — defensible, lead with these

1. **Cold-retention re-check as a certificate gate.** Every incumbent sells *content delivered*.
   Msweli et al. (2026) found immersive training produces **short-term gains only**. Nobody ships
   first-attempt accuracy + self-recovery + sequencing integrity + **cold retention** as a hard
   gate. This is the intellectual core of the project and the demo kill shot.
2. **Step-level competency heatmap.** Not "he failed Module B" but *"he fails extinguisher-type
   selection, 40% of the cohort."* Turns a compliance record into a **training-needs instrument**.
3. **Complete domain on a zero-licence, zero-vendor stack.** Built entirely on MIT/Apache OSS,
   deployable to a government operator without a per-seat procurement decision.
4. **Failure states that teach the causal reason.** Every wrong option carries a documented
   real-world misconception; every failure explains *why*, not just *what*. A quiz tells you you
   were wrong; this tells you someone died that way.

### Tier 2 — necessary, not differentiating

5. Headset-free phone AR. 6. Offline-first. 7. QR verification. 8. Admin dashboard.
   9. Comprehension-weighted scoring vs raw attendance. 10. Hindi + English UI.

### Tier 2b — declared, not built

11. **Santali (Ol Chiki).** One JSON file and one audio directory away. Deliberately not
    machine-translated — see §7.1.

### Tier 3 — do not claim

"AR training" (saturated), "QR certificate" (CSCS 2025), "blockchain certificate" (a decade of
platforms), "offline-first" (Eneza, 2010s), "gamified safety quiz" (every LMS ever), "360°
simulation" (`suraksha-ar` shipped it), "DGMS-compliant" (unverifiable marketing claim we cannot
substantiate).

---

## 5. Positioning statement

> CSCS proved that a portable, QR-verifiable worker credential is valuable — in UK construction,
> where literacy, smartphones and stable employment are assumed. Nobody has done it for the workers
> where none of those hold. KAVACH is the training that earns that credential for Jharkhand's
> job-hopping mine workforce — and, unlike immersive training everywhere else, it refuses to issue
> the certificate until the worker has *demonstrated* the skill, and demonstrated it again, cold,
> ninety seconds later.

---

## 6. Anticipated challenges and prepared answers

| Challenge | Answer |
|---|---|
| *"Immersive safety training already exists — Pixaera, 360 Immersive."* | Correct, and it costs ¥ per-seat licences and assumes a headset. We are at zero licence cost, zero vendor, and phone-only because that is the only deployable form in our context. |
| *"AR doesn't beat VR."* | Paes et al. (2024) found AR superior to conventional evacuation training; Scorgie et al. (2024) meta-analytically confirmed immersive > traditional. We do not claim AR > VR. We claim AR > *nothing*, which is the actual baseline. |
| *"Why blockchain? Why not a signed JWT?"* | Honest answer: **a signed token is the right answer, and that is what we built** — Ed25519 over a canonical payload, verifiable offline with no network. A public chain would add latency, cost and failure modes for zero gain at this scale. We would rather be right than fashionable. |
| *"How is this different from CSCS?"* | CSCS is the passport. It assumes the training already happened. We are the training *and* the passport, for a population with no existing credential system. |
| *"Isn't offline-first table stakes?"* | For the SIH cohort, yes — peers have it. We differentiate on *assessment depth* and the cold re-check, and we treat offline as a correctness requirement rather than a feature. |
| *"The statement names Santali — where is it?"* | "Digital Santali is effectively unsolved: no corpus, no TTS, and the literature treats it as a research problem. We didn't machine-translate safety instructions for a mine, because bad instructions kill. The locale slot is reserved and it's a JSON file plus audio. That's a deployment, not an engineering." |
| *"The statement's description is truncated — two of five domains are missing."* | Acknowledged in [06-content-spec.md](./06-content-spec.md) §5. We build the two specified domains to completion and document the other three as a declared, architecture-ready extension rather than guessing at their content. |

---

## 7. Design constraints this document imposes

These are **binding on all downstream specs.**

| # | Constraint | Rationale |
|---|---|---|
| C1 | 100% MIT/Apache/OSS dependencies. No per-seat licence, no SaaS dependency at runtime. | Government procurement + zero-cost deployment claim |
| C2 | Zero licensed third-party content, zero scraped assets. All marker art and audio authored or generated in-house. | Avoids the licensing failure that sinks hackathon projects |
| C3 | Module content is **data in a table**, never code branching. | Lets content be added without an engineering change; core demo flexibility |
| C4 | Assessment must measure **first-attempt behaviour**, not completion. | Tier-1 claim #1 |
| C5 | Every string in the product exists in `en` and `hi`. No hardcoded UI text. The `sat` locale slot is reserved but ships empty. | §7.1 — we will not machine-translate safety content |
| C6 | The AR path must degrade through an explicit fallback ladder to a no-camera path. | §2.4 — 35% smartphone-with-internet reality |
| C7 | Certificate issuance requires a **cold-retention re-check**, not a single session pass. | Msweli et al. short-term-gains finding |
| C8 | All attempt telemetry is **step-level**, never module-level. | Tier-1 claim #2 |

### 7.1 Santali: the decision and its reasoning

**Decision: `sat` ships as a reserved, empty locale slot. No Santali strings, no Santali audio.**

Reasoning, recorded so it is not relitigated under deadline:

1. **Risk.** Santali was the single critical-severity delivery risk (formerly R1). It required an
   external speaker we do not have, for ~36 narration clips, on the critical path.
2. **Correctness is non-negotiable.** Machine-translated or guessed safety instructions delivered
   to a mine can kill. That is not a risk we ship to hit a checkbox.
3. **Cost is near zero to defer.** The `Localised` type already carries a `sat` key. Shipping two
   locales instead of three is a *missing file*, not a refactor. The architecture stays honest.
4. **The deferral is itself a defensible answer.** Choksi (2020) treats digital Santali as an open
   research problem. Declaring it, with the reasoning stated, reads as judgement. Half-doing it
   reads as a deadline.

**What it costs:** one of four Tier-1 claims. **What it buys:** the project becomes buildable by
this team, and the remaining three claims are the stronger ones — assessment depth, the heatmap,
and the zero-licence stack.

---

## 8. Document map

| Doc | Defines |
|---|---|
| **01 — Gap Analysis** *(this file)* | Positioning, competitive set, binding constraints C1–C8 |
| **02 — PRD** | Users, scope, non-goals, success metrics, acceptance criteria |
| **03 — Product Spec** | Step schema, module state machine, assessment rubric, fallback ladder |
| **04 — Data Model & API** | Convex tables, indexes, mutations, offline sync contract |
| **05 — AR Technical Spec** | Tracking strategy, marker asset pipeline, rendering budget |
| **06 — Content Spec** | Full step data for both modules, content sources, the three missing domains |
| **07 — Architecture** | Stack, deployment, offline, audio pipeline, security |
| **08 — Demo & Pitch** | The 120-second run, judge Q&A bank, failure contingency |
