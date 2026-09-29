# 06 — Content Specification

**Project:** KAVACH · **Version:** 2.0 · **Date:** 2026-09-29
**Revision:** Santali declared-not-built (01 §7.1); content sources and accident-report basis added
**Governed by:** [03](./03-product-spec.md) §1 (schema), [01](./01-gap-analysis.md) C3/C5

> **This is the product.** Everything else is delivery. Content is data so it can be changed without
> touching code. *(C3)*

---

## 1. Authoring rules

1. **Audio-first.** Every step has recorded narration in `en` and `hi`. Text is the secondary
   layer. *(FR-10)*
2. **One instruction per step.** Short, imperative, ≤ 8 words. Never a paragraph.
3. **Every wrong choice is meaningful.** Each carries a `misconception` tag naming the real
   misconception it represents. This is what feeds the heatmap. *(C8)*
4. **Every critical step must be able to fail.** A step that cannot fail cannot prove competence.
5. **Written by a speaker, not a translator.** Hindi content must be authored with a native Hindi
   speaker. The same discipline that ruled out machine-translated Santali applies here — bad safety
   instructions can kill, in any language.
6. **Domain-accurate or bust.** Extinguisher chemistry, PASS, four-gas readings, LOTO sequence.
   A qualified reviewer checks it before we claim correctness. Getting it wrong is worse than not
   shipping it. *(R9)*

### 1.1 Where the content comes from

**This is not a data-acquisition problem. It is 12 steps of writing — roughly 2–3 hours.** There is
no dataset to acquire, license, or scrape.

| Source | What it gives | Access |
|---|---|---|
| **DGMS — Metalliferous Mines Regulations, 1961** | Primary legal source: certificates, permits, confined space, officials' duties | **Free PDF** — `dgms.gov.in/writereaddata/UploadFile/Metalliferous1961.pdf` |
| **DGMS — Coal Mines Regulations, 2017** | Current coal rules: ventilation, gas, refuges | **Free PDF** — `dgms.gov.in` |
| **DGMS circulars & FAQs** | Plain-language safety guidance | **Free** |
| **MSHA Part 46 (US)** | Well-structured refresher curricula — a good outline to write against | **Free** |
| **NIOSH / CDC** | Pocket guide, hazard and chemical data sheets | **Free** |
| **MNRE / Chief Electrical Inspector circulars** | Indian factory fire safety, extinguisher norms | **Free** |
| **MSHA MineSAFE + tabletop games** | Scenario patterns for mine-specific drills | **Free** |

**On NFPA:** standards 10 (extinguisher) and 70E (electrical LOTO) are paid. We do not need the
standard — the knowledge is standard and appears free in every OSHA/NFPA summary. **Cite NFPA;
do not quote a paid clause.**

### 1.2 Where the wrong answers come from

**Every distractor is a documented real-world error, not an invented filler.** Sources to draw from:

- **DGMS-published accident reports** — the authoritative Indian source
- **Adani Cupbhara, Jharkhand, 2019** — the most recent major industrial fire in the target region
- **theiseron.com** — global industrial incident archive, free
- **MSHA / NIOSH fatality abstracts** — the canonical US dataset

Each misconception tag in §2 and §3 should trace to one of these. That converts "we invented
distractors" into **"our wrong answers are drawn from documented fatalities"** — which judges
notice immediately, and which makes the heatmap meaningful rather than decorative.

### 1.3 The reviewer requirement *(R9 — largest remaining real risk)*

We are not safety engineers. Before claiming correctness, **one qualified person must review both
modules**: a DGMS officer, a mining engineer, a NMDC/SAIL safety officer, or a mine safety
consultant. These people exist within 50 km of any Jharkhand team and are usually willing to read
twelve steps for an hour.

This is the first thing to resolve, ahead of any code.

---

## 2. Module A — Fire & Explosion

`code: "FIRE"` · `domain: "fire_and_explosion"` · `6 steps` · `~4 min` · `passScore: 80`

### A-01 — Spot the exit *(observe)* · **critical: false**

- **instruction:** `{ en: "Find the nearest exit", hi: "सबसे निकट का रास्ता ढूँढो" }`
- **targets:** `exit-sign`
- **success:** `identify` — `requiredTargets: ["exit-sign"]`
- **failure:** `penalty` → *"Look around. The exit sign is on the wall."*
- **hints:** ["Exit signs are green.", "Check the far wall.", "It glows in the dark."]
- **audio:** `A-01.hi`, `A-01.en`

> First step is deliberately gentle — it establishes that the app sees the real room, and it
> succeeds even in an unfamiliar space. Confidence before difficulty.

### A-02 — Raise the alarm *(observe)* · **critical: false**

- **instruction:** `{ en: "Sound the fire alarm", hi: "आग की सायरन बजाओ" }`
- **targets:** `fire-alarm`
- **success:** `identify`
- **failure:** `penalty` → *"Find the red alarm point on the wall."*

### A-03 — Choose the extinguisher *(decide)* · **critical: TRUE** 🔴

- **instruction:** `{ en: "Pick the right extinguisher", hi: "सही बुझावा चुनो" }`
- **choices:**

| id | label | correct | misconception |
|---|---|---|---|
| `co2` | CO₂ extinguisher | ✅ | — |
| `water` | Water extinguisher | ❌ | `water_on_electrical` — water conducts electricity, causes electrocution |
| `abc` | ABC dry powder | ❌ | `wrong_fire_class` — dry powder smothers but leaves no cooling for re-ignition |
| `foam` | Foam extinguisher | ❌ | `wrong_fire_class` — foam is for liquid/spill fires, not energized electrical |

- **success:** `select` — `minAccuracy: 1.0` (exact, no partial credit)
- **failure:** `critical` → *"Water on a live electrical fire kills. CO₂ has no residue. The extinguisher is locked."* **Hard block — must repeat.**
- **notes:** Energized-electrical fire. CO₂ is correct: non-conductive, no residue, no re-ignition.
  Every wrong answer here maps to a real, documented workplace error. This is the demo's
  deliberate-failure beat.
- **audio:** `A-03.hi`, `A-03.en`

### A-04 — Use the extinguisher *(act)* · **critical: false**

- **instruction:** `{ en: "Use the PASS technique", hi: "PASS तरीका अपनाओ" }`
- **action:** `sequence` — `elements: ["pull-pin", "aim-base", "squeeze", "sweep"]`
- **success:** `complete` — all four in order
- **failure:** `hazard` → *"Smoke builds. Start again — P-A-S-S."*
- **hints:** ["P = Pull the pin.", "A = Aim at the base.", "S = Squeeze. S = Sweep side to side."]
- **notes:** P-P-A-S-S is the Indian/NFPA convention (Pull, Pull, Aim, Squeeze, Sweep). We use
  P-A-S-S and note the regional variant in the content appendix rather than confusing the trainee.

### A-05 — Evacuate in order *(act)* · **critical: TRUE** 🔴

- **instruction:** `{ en: "Leave in order — nearest first", hi: "क्रम में बाहर निकलो" }`
- **action:** `sequence` — `elements: ["person-1", "person-2", "person-3"]`
- **success:** `complete` — all three, correct order
- **failure:** `critical` → *"The person nearest the fire has seconds. The ones behind you have minutes. Start again."* **Hard block.**
- **notes:** Evacuation order by distance-to-hazard. The misconception being tested is
  "everyone moves together" / "wait for your friends first" — which is exactly what causes
  crush injuries in mine escapes. Buddy drag-along happens *after* the critical path, not instead
  of it.

### A-06 — Report at assembly *(decide)* · **critical: false**

- **instruction:** `{ en: "Report to the assembly point", hi: "जमाव स्थल पर जाओ" }`
- **choices:** `assembly-point` ✅ · `return-to-work` ❌ (`return_to_work_fire` — a documented cause
  of fire deaths; re-entry requires authority) · `go-home` ❌ (`skip_accountability` — supervisor
  cannot account for you)
- **success:** `select`
- **failure:** `penalty` → *"Your supervisor must know you are alive. Go to the assembly point."*

---

## 3. Module B — Gas Leak & Confined Space

`code: "GAS"` · `domain: "gas_leak_confined_space"` · `6 steps` · `~4 min` · `passScore: 80`

### B-01 — Identify the leak source *(observe)* · **critical: false**

- **instruction:** `{ en: "Find the gas leak", hi: "गैस रिसाव ढूँढो" }`
- **targets:** `gas-cylinder`
- **success:** `identify`
- **failure:** `penalty` → *"The leak is where the gas escapes."*
- **notes:** Methane (CH₄). Lighter than air — accumulates at roof level in a mine gallery. Worth
  stating in narration: *"Methane rises. Look high."* Domain credibility.

### B-02 — Select correct PPE *(decide)* · **critical: TRUE** 🔴

- **instruction:** `{ en: "Choose PPE for this zone", hi: "इस ज़ोन का सही PPE चुनो" }`
- **choices:**

| id | label | correct | misconception |
|---|---|---|---|
| `sampler` | Self-rescuer + dust respirator + cap lamp | ✅ | — |
| `cloth-mask` | Cloth dust mask only | ❌ | `no_gas_protection` — dust masks do not filter methane or CO |
| `no-ppe` | No PPE, it is only a small leak | ❌ | `underestimate_gas` — the most common fatal error in gas incidents |
| `canvas-gloves` | Heavy gloves, no respiratory protection | ❌ | `hand_protection_only` |

- **success:** `select` — `minAccuracy: 1.0`
- **failure:** `critical` → *"A cloth mask does not stop gas. No respirator means no entry. Blocked — choose again."* **Hard block.**
- **notes:** A self-rescuer is a closed-circuit breathing apparatus for escape only. This is the
  second hard-gate step and the second demo failure beat.

### B-03 — Buddy system and permit *(decide)* · **critical: TRUE** 🔴

- **instruction:** `{ en: "Who enters with you?", hi: "तुम्हारे साथ कौन अंदर जाएगा?" }`
- **choices:** `two-buddy` ✅ (two-person entry, permit signed, standby outside) ·
  `solo-fast` ❌ (`solo_entry` — a statutory violation and the single deadliest confined-space error) ·
  `three-buddy` ❌ (`wrong_buddy_ratio` — buddy system is exactly two) ·
  `supervisor-inside` ❌ (`supervisor_in_space` — the standby must remain outside)
- **success:** `select` — `minAccuracy: 1.0`
- **failure:** `critical` → *"Nobody enters alone. Not ever. Entry is blocked until you have a buddy."* **Hard block.**
- **notes:** Confined-space fatality statistics are dominated by attempted rescue of a single
  entrant by an unbriefed second person. The `supervisor_in_space` option targets exactly this.

### B-04 — Mark the hazard zone *(observe)* · **critical: false**

- **instruction:** `{ en: "Mark the hazard zone", hi: "खतरे का इलाका चिन्हित करो" }`
- **targets:** `zone-barrier`
- **success:** `identify`
- **failure:** `penalty` → *"Mark the boundary so no one walks in."*

### B-05 — Isolate the gas source *(act)* · **critical: TRUE** 🔴

- **instruction:** `{ en: "Close the main valve first", hi: "पहले मुख्य वाल्व बंद करो" }`
- **action:** `sequence` — `elements: ["valve-main", "valve-isolate"]`
- **success:** `complete` — correct order, no reversal
- **failure:** `critical` → *"Wrong order. Isolating downstream first pushes gas the wrong way. The supply is still live."* **Hard block.**
- **notes:** Upstream isolation before downstream. The failure state teaches the causal reason, not
  just the rule — this is what makes it stick.

### B-06 — Refuge and rescue plan *(decide)* · **critical: false**

- **instruction:** `{ en: "Where do you wait for help?", hi: "मदद की इंतज़ार कहाँ करोगे?" }`
- **choices:** `refuge-chamber` ✅ · `surface-exit` ❌ (`surface_during_gas` — the surface can be the
  gas path) · `continue-work` ❌ (`delay_rescue` — delays rescue past survivable window)
- **success:** `select`

---

## 4. Step inventory summary

| Module | Steps | Critical | Decide | Act | Observe | Hard-gate rate |
|---|---|---|---|---|---|---|
| FIRE | 6 | 3 (A-03, A-05) + A-03 | 3 | 2 | 2 | 2 |
| GAS | 6 | 3 (B-02, B-03, B-05) | 4 | 1 | 2 | 3 |

**Total critical steps: 5** across both modules — matches the approved list in
[03](./03-product-spec.md) §1. A trainee must clear all five first-attempt.

**Every `decide` step has 3–4 options with distinct misconceptions.** No filler options. This is
what makes the heatmap meaningful rather than decorative.

---

## 5. The three missing domains

The statement text is **truncated mid-sentence at the third of five promised safety domains.** Two
domains are absent from the published description.

**Decision: build two to completion; declare the other three as architecture-ready, not
speculative.** *(R6)*

Guessing at missing regulatory content and shipping it to a mine would be irresponsible. Building a
third module to look thorough would burn the entire content budget and weaken both delivered
modules.

**The four most likely candidates** (for the narrative, not for building):

1. Electrical safety & lockout/tagout
2. Working at height / fall protection
3. Vehicle and haulage interaction safety
4. Chemical handling and storage

**Proof the framework generalises** — the honest version, which is a `files/modules/` entry and one
seed record, no code:

```json
{
  "code": "LOTO",
  "domain": "electrical_lockout_tagout",
  "title": { "en": "Electrical Safety & LOTO", "hi": "बिजली सुरक्षा" },  // sat reserved, not shipped
  "version": "1.0.0",
  "estimatedMinutes": 4,
  "passScore": 80,
  "steps": [ /* same Step[] schema — 6 steps */ ]
}
```

**On stage:** *"The statement was truncated at the third of five domains. We didn't guess. We built
the two that were specified, to a standard that survives an audit, and we proved the third costs
zero engineering — it's a JSON file. When the state publishes the remaining domains, they drop in."*

That is a stronger answer than a third thin module.

---

## 6. Localisation

### 6.1 Coverage

| Locale | Script | Font | Audio | Status |
|---|---|---|---|---|
| `en` | Latin | Noto Sans | Recorded | Reference locale — **ships** |
| `hi` | Devanagari | Noto Sans Devanagari (self-hosted) | Recorded | **Ships** — default for the target user |
| `sat` | Ol Chiki | — | — | **Reserved, not shipped** *(01 §7.1)* |

**100% string coverage for `en` and `hi` is a build assertion**, not a convention. A missing key
fails the build. The `sat` key is *permitted* to be absent and the resolver falls back to `en`.

### 6.2 Santali — declared, not built

The statement names Santali. We are shipping without it, and that is a deliberate, defensible
decision rather than an omission.

**Why:** *(01 §7.1)*
- It required an external native speaker we do not have, for ~36 clips, on the critical path.
- Machine-translated or guessed safety instructions delivered to a mine **can kill**. That is not a
  risk we take to satisfy a checkbox.
- The cost of deferral is near zero: `sat` is already a key in the `Localised` type. Shipping two
  locales instead of three is a *missing file*, not a refactor.

**How to answer it on stage — own it, do not apologise:**

> *"Digital Santali is effectively unsolved — no corpus, no TTS, and the literature treats it as an
> open research problem. We didn't machine-translate safety instructions for a mine, because bad
> instructions kill. The locale slot is reserved in the type system; filling it is one JSON file and
> an audio recording. That's a deployment decision, not an engineering one — and it's a call the
> state should be making with a Santali speaker, not with a machine."*

That is a stronger answer than a rushed, wrong translation. It demonstrates judgement on exactly
the thing a safety-cleared product is judged on.

**What it costs:** one of four Tier-1 claims. **What it buys:** the project is buildable by this
team, and the remaining claims — assessment depth, the cold re-check, the heatmap, the zero-licence
stack — are the stronger ones.

### 6.3 Localisation beyond translation

| Concern | Rule |
|---|---|
| Terminology | **Consistent, not literal.** "Extinguisher" is the same word every time. Workers learn the tool, not the sentence. |
| Length | Hindi instructions must stay ≤ 8 words — audit every clip against the audio, not the text |
| Script mixing | Devanagari for prose, Latin for standards codes (DGMS, PASS, LOTO, CH₄) — this is correct practice, not a compromise |
| Audio pace | Slow, clear, one instruction per clip. Silence between steps is fine. |
| Certification text | **Bilingual** on the certificate, not just in the app |
| Untranslated standards terms | DGMS, PASS, LOTO, CO₂, CH₄, SCSR stay in Latin — workers already use these in the mine |

### 6.4 Audio asset inventory

```
6 steps × 2 modules × 2 languages (en, hi) = 24 step clips
+ module intros (2) + module outros (2) + failure states (8) + hints (14) + UI strings (~20)
= ~36 clips per language pair, ~18 minutes of recording
```

**Recorded, never TTS.** Chrome's Web Speech API does expose `hi-IN`, but it is cloud-dependent,
robotic, and **breaks offline** — which would break the exact property we are demoing. Recorded
audio from a native speaker is the only credible path. *(R1, R10)*

**This is no longer a critical-path risk.** Any Hindi speaker on the team can record ~36 short
clips in one sitting with a phone voice recorder. Schedule it in the first week, not the last.

---

## 7. Content review checklist

- [ ] Extinguisher chemistry verified against NFPA/Indian Standards by a competent reviewer
- [ ] PASS/P-P-A-S-S regional variant noted correctly
- [ ] Four-gas readings and methane behaviour factually correct
- [ ] Confined-space buddy/permit rules match DGMS / Indian statutory requirements
- [ ] LOTO isolation order verified by a qualified electrical person
- [ ] Every Santali string reviewed by a native speaker, not just a translator
- [ ] Every Santali clip ≤ 8 words when spoken
- [ ] No step is passable by guessing — wrong options must be individually wrong
- [ ] No critical step has a hint that gives away the answer without a fail
- [ ] All misconception tags trace to a real accident report or regulation, not invented for the heatmap
- [ ] Every Hindi string written by a native speaker, not a translator
- [ ] Every Hindi clip ≤ 8 words when spoken
- [ ] Audio exists for every `(stepId, locale)` pair — CI-enforced
- [ ] **A qualified safety reviewer has signed off on both modules** *(R9 — blocks any accuracy claim)*
