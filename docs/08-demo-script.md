# 08 — Demo Script & Pitch

**Project:** KAVACH · **Version:** 2.1 · **Date:** 2026-09-30
**Revision:** Santali removed from the demo; L2 reticle is the demo path. Then: the
climax moved, because the build no longer issues a certificate and the strongest
available beat is the refusal. See §1.1.
**Governed by:** [01](./01-gap-analysis.md) §5–6

> ### 1.1 This build issues no certificate — demo the refusal instead
>
> One required module, GAS, has a step the qualified safety reviewer has not
> approved (`docs/13` step 4: withdraw from, or remain outside, the defined
> hazardous area). That step is deliberately present, critical, and inert: it
> cannot be answered, so the module cannot be completed, and a module that
> cannot be completed cannot clear the gate. Because the gate requires **every**
> bundled module, **no certificate issues at all today** — not even for a
> trainee who completes Fire perfectly.
>
> That is the gate working, not the product failing. **Do not rehearse a
> certificate that will not appear.** The revised 1:20–2:00 sequence below
> ends on the refusal, which for a safety-certification product is a better
> answer than a QR code anyway: you are showing an inspector-facing credential
> that refuses to exist when a module is unapproved. Once the reviewer signs off
> step 4, restore the certificate beats from version 2.0.

---

## 1. The 120 seconds

**Setup before the judge arrives:** phone in **Hindi**, dashboard seeded, **network available**
(see §1.2 — three beats of this script need a server and the original version staged all 120
seconds in airplane mode), a second phone on the verification page. **No markers, no taped walls, no
printed materials** — the demo runs on L2 reticle, which needs nothing prepared.

```
0:00  Hand them the phone. Already in Hindi.
      "This is a real mine gallery in Dhanbad. Training cost us nothing
       to deliver and installed nothing on your phone."

0:10  They walk. Camera shows the real room. The exit sign lights up.
      [NO AUDIO — the build has no narration yet. Read the Hindi instruction
       aloud yourself as they read it. See §1.2.]
      They tap the exit. Step passes.

0:25  Step A-03. "सही बुझावा चुनो" — pick the right extinguisher.
      They pick WATER — the wrong answer.
      >>> The failure beat. <<<
      The step is refused on the spot. It is marked critical, so the miss is
      recorded permanently, and they are sent back to it.
      [The screen does NOT show a certificate panel flipping to LOCKED —
       there is no live certificate panel during training. The verdict is
       computed on the server. See §1.2.]

0:45  "Paani. Live electrical par paani Conduct karta hai — operator mar
       sakta hai. Yeh step critical hai — isliye aapki pehli galti
       hamesha ke liye darj ho gayi, aur aapko ise dobara karna hoga."
      [Water conducts on live electrical work — it can kill an operator. This
       step is critical, so your first miss is on the record permanently and
       you have to do it again.]
      They pick CO₂. Pass.
      Audience sees the assessment is a real gate, not a progress bar.

1:05  Module B, fast — gas leak, PPE, buddy system.
      They fail B-03 (solo entry). Hard block. "Nobody enters alone."

1:20  They reach B-04. The screen does not offer options. It says, in Hindi,
      that the step is awaiting qualified safety review and that nothing on
      this screen has been assessed.
      >>> This is the intellectual kill shot. <<<

1:35  "Yeh step kisi engineer ne approve nahi kiya hai. Isliye isko hum
       sikhaate nahi, aur iske bina gas module poora hi nahi hota."
       [That step has not been approved by a safety engineer. So we do not
        teach it, and without it the gas module cannot be completed.]

1:45  Stay on the B-04 screen. Do not open the Result page — offline it says
      only that results are not available yet, because the gate verdict is
      computed on the server. That is the honest state and it is the state
      that matters.
      "Aapne perfect training kiya — aur certificate nahi mila. Ek zaroori
       module approve nahi hua, isliye humne pura certification rok diya.
       Yehhi reason hai ki yeh attendance receipt nahi hai."
       [You did perfect training — and got no certificate. One required
        module has not been approved, so we stopped the whole certification.
        That is exactly why this is not an attendance receipt.]

2:00  "Every other system would have issued it. We didn't. Jab tak har
       zaroori module safety-approved nahi hota, hum certificate nahi
       dete. One phone, no headset, no install, no licence."
```

### The three beats that matter

1. **A-03 wrong answer → LOCKED → correct → unlocked.** Proves the assessment is a gate.
2. **B-04 will not be trained and will not be certified.** Proves the gate covers
   *content approval*, not just trainee performance. Restore the cold re-check
   failure as the third beat once step 4 is signed off.
3. **Cold re-check failure.** *(requires an approved GAS step 4)* Proves this is not
   attendance theatre. This is the beat no competitor has, and it lands the Msweli
   et al. (2026) finding live.

**Everything else is supporting evidence. Do not reorder these.**

### 1.2 What this build can and cannot show — check before rehearsing

Verified against the source, 2026-09-30. Every claim below was checked; the two that
failed are the reason this section exists.

| Claim | Real? | Notes |
|---|---|---|
| Room, steps, tap-to-walk, 3D bay, L2 reticle, L3 fallback | **Yes** | The primary surface. Offline-capable. |
| Wrong answer refused on the spot, critical miss recorded, retry forced | **Yes** | Runner-side, entirely local. Works in airplane mode. |
| Hindi / English text throughout | **Yes** | |
| A-01 "no markers, no setup" | **Yes** | L2 needs no printed material. |
| Instruction arrives in **AUDIO** | **No** | `narrationKey` exists in the manifest and **nothing consumes it**: no `speechSynthesis`, no `<audio>`, no audio files. Read instructions aloud yourself. |
| Certificate panel flips to **LOCKED** live during training | **No** | No live certificate panel exists. The only local scoring is a session-history number; the gate verdict is server-side. |
| **COLD RE-CHECK** beat | **Needs a server** | Sampling and scoring run in Convex. The sampler also prioritises critical steps, so it would offer the pending B-04. |
| **Result screen / certificate issued / QR** | **Needs a server** *and* is impossible anyway | The gate is server-computed, and it cannot pass while a required module is unapproved. |

**Offline truth:** the *app shell* is offline-capable — it loads from cache, runs the whole
training flow, scores locally, queues attempts for later sync. The *verdict* — gate criteria,
certificate, QR, re-check — is server-computed and is not available with no network. Do not
conflate the two, because a judge will.

**If you want the server beats**, turn the network on deliberately and say so: *"ab main
server wala hissa dikhata hoon."* [Now I will show the server side.] Never let the network
be the reason a beat silently fails.

**If you want a pure airplane-mode proof**, the 0:10–1:35 sequence works end to end: that is
the real offline claim, and it is a good one.

---

## 2. Pitch — 60 seconds

> "A new worker in a Jharkhand mine gets safety training as a lecture and a manual. A week later
> almost none of it has stuck. Live drills stop production, and a VR headset costs more than a
> small operator makes per worker per month.
>
> KAVACH trains them through the actual emergency procedure, overlaid on the real room they're
> standing in, on the phone they already own — no headset, no install, no per-seat licence, and it
> works with no network at all.
>
> And it does not issue a certificate for turning up. We score first-attempt accuracy, whether they
> self-corrected a mistake without being told, whether they got the sequence right under pressure —
> and then, ninety seconds later, we ask them again, cold, and see if it stayed.
>
> That last part is the point. Research on immersive safety training, including a 2026 meta-analysis
> and an IEEE review this year, keeps finding the same thing: the gains are short-term. Everybody
> else hands you a certificate anyway. We built the system that notices when it didn't stick.
>
> The supervisor scans a QR in the gallery — no login, no signal — and knows exactly who is
> certified, and not just certified: we know which specific step their crew is failing."

---

## 3. One-line answers to "why is this different?"

| If asked | Say |
|---|---|
| "What does it do that AR training doesn't?" | "Everyone else certifies attendance. We gate on demonstrated competence, then re-test cold." |
| "Isn't this just a quiz in AR?" | "Four MCQs would recreate the exact failure this problem describes. We capture 10 signals per step, including self-recovery and hesitation." |
| "What about VR — isn't it better?" | "For our user, VR is not an option — it's an unaffordable one. And we don't claim AR beats VR. We claim it beats nothing, which is the real baseline." |
| "What makes it Jharkhand-specific?" | "Offline-first on a mid-range phone, and content written against DGMS regulations, not US OSHA. The baseline in this sector is a paper attendance register." |
| "The statement says Hindi and Santali — where's Santali?" | "See Q&A below. Don't apologise — it's a deliberate call." |
| "How is it different from CSCS?" | "CSCS is the passport and it assumes the training happened. We're the training *and* the passport, for workers nobody has a passport for." |
| "Why no blockchain?" | "See below." |

---

## 4. Judge Q&A bank

### The blockchain challenge *(highest probability — the statement's theme is Blockchain and Cybersecurity)*

> **"Why blockchain? Why not just a signed JWT?"**

**The honest answer, and the one to give:**

> "A signed token is the right answer — and that's exactly what we built. Ed25519 over a canonical
> payload. The reason is that our verification page has to work in a mine gallery with no signal. A
> chain read needs a gateway or a bundled light-client dataset, which is a real availability
> regression for real cost. Revocation on-chain is slow and contentious; ours is a database flag.
> Issuance gas is a procurement problem for a government deployment.
>
> A chain doesn't improve tamper-evidence anyway — Ed25519 plus a resolvable code gives the same
> guarantee at issuance, and a chain wouldn't save us if the key were compromised. We'd rather be
> right than fashionable."

Then: *"It's in the Blockchain and Cybersecurity theme, and I want to be clear that we deliberately chose not to bolt on a chain. The security property is signature verification, and that's a solved problem we solved correctly."*

**Never dodge this question. Own it.** A team that waves at "blockchain" and can't answer it has
told the judge the security story is decoration.

### Other likely questions

**"Your assessment is a rubric you invented. How do you know it's valid?"**
> "We didn't invent it from nothing. Msweli et al. published in IEEE this year finding that immersive
> safety training produces short-term gains concentrated on hazard identification and procedural
> tasks — meaning completion-based certification is measuring the wrong thing. First-attempt accuracy
> and cold retention are the measures that address that specific finding. The thresholds are a
> starting point calibrated for the demo, and the whole rubric is one file so a real safety officer
> can retune it."

**"What about the two missing domains in the statement?"**
> "The statement is truncated mid-sentence at the third of five domains — the last two aren't
> published. We didn't guess at regulatory content for a mine. We built the two specified domains to
> an audit standard and proved the third costs zero engineering: it's a JSON file. The content
> manifest and the runner are domain-agnostic. That's on the repo if you want to see it."

**"The statement says Hindi and Santali. Where is Santali?"** *(high probability — be ready)*
> "That's a deliberate call, and I'll be precise about why. Digital Santali is effectively an
> unsolved problem — no corpus, no text-to-speech, and Choksi's work in Signs and Society treats it
> as open research. So the choice was: machine-translate safety instructions, or ship without them.
>
> We shipped without them. Because a wrong extinguisher instruction doesn't produce a bad
> experience, it produces a fatality — and we're not putting a guess into a mine on a deadline.
>
> The locale slot is reserved in our type system, so shipping it is one JSON file and an audio
> recording by a native speaker. That's a content and staffing decision, not an engineering one — and
> honestly it's the state's to make with a Santali speaker in the room, not ours to fake with a
> translation API."

**Never apologise for this. State it as the engineering judgement it is.** A team that
half-translates and hides it has told the judge the safety review was skipped.

**"What if a worker's phone can't run the AR?"**
> "It still trains them. The AR has an aim-and-tap mode that needs only a camera, and a fully
> non-AR guided mode that needs nothing at all — same modules, same assessment, same certificate
> gate. GSMA data puts smartphone-with-internet ownership around 35% in sub-Saharan Africa. If you
> design only for the flagship you designed for a third of the workforce. And the whole thing runs
> with no network after first sync, because a gallery has no signal."

**"You said 'AR' but the demo is tap-a-silhouette. Isn't that overclaiming?"**
> "Fair challenge, and the honest framing matters to us. What you're seeing is the reticle mode —
> the trainee points the phone at the real extinguisher in this room and taps it. That's a camera AR
> overlay on the real world, not a video game. We also built world-tracking and printed-marker modes
> and cut them from the MVP on purpose: they're the two things most likely to fail live on a judge's
> phone in a room we've never seen. Same pedagogy, same assessment, fewer ways for the demo to die.
> The ladder is still in the codebase if you want to see it."

**"How is this not just an app?"**
> "It runs offline. We've got it in airplane mode. Training, scoring and the whole assessment loop
> work with no network — events queue and sync when you reconnect. The certificate verdict is
> computed on the server, and the QR verifies offline once issued. Eneza proved this model in Kenya
> over SMS; we're applying it to industrial safety where the consequence of getting it wrong is a
> fatality."
>
> *Do not add audio to this answer — there is no audio narration in this build. See §1.2.*

**"What's your business model?"**
> "Licence-free software. That's the point — the reason VR never reached a small operator is that
> the per-seat cost doesn't divide. Zero licence cost is a feature, not a compromise. The natural
> next layer is supervisor analytics as a service per site, but the training never becomes paywalled."

**"How do you know the content is correct?"**
> "The extinguisher chemistry, four-gas readings, buddy-system rules and the LOTO isolation order
> were written against the DGMS Metalliferous Mines Regulations 1961 and the Coal Mines Regulations
> 2017 — both free public documents. Every wrong option is tagged with the specific misconception it
> represents: 'water on an electrical fire', 'solo confined-space entry'. Those aren't invented
> distractors, they're documented failure modes from real incident reports.
>
> And we don't claim more than that. We're not safety engineers. A qualified reviewer — a DGMS
> officer or a mine safety engineer — signs off on both modules before we describe the content as
> validated, and that gate is in our release checklist, not just in a promise."

**"Why is this in Blockchain and Cybersecurity?"**
> "Because the certificate is a signed verifiable credential with offline verification, and we made
> deliberate security engineering choices — including the choice not to use a chain. The security
> story is the credential, not a marketing label."

---

## 5. Failure contingency

| If this happens | Do this |
|---|---|
| **Camera permission denied** | App auto-drops to L3 in < 2 s. *"Camera's blocked — this is the no-AR mode, same modules, same assessment."* It's a feature, not a failure. |
| **Camera feed is black / slow** | Drop to L3 manually. *"Camera's struggling — guided mode runs the identical assessment."* |
| **No network** | Already the plan. Lead with it: *"This is airplane mode."* |
| **Desktop / no phone** | L3 runs in a browser. Steps still work, tapped on screen. |
| **Hindi font renders wrong** | Self-hosted, should not happen. If it does, switch to English and say so plainly. |
| **Audio asked for** | There is no audio narration in this build. Say so plainly and read the instruction aloud: *"is build mein awaaz nahi hai abhi — main padh ke sunata hoon."* Do not claim it exists. |
| **Asked for the cold re-check / certificate** | Needs the server, and the certificate cannot issue while a required module is unapproved. Demo the refusal (§1.2) — it is the stronger answer. |
| **App crashes** | Have a 30-second screen recording as the fallback. Do not debug live. |
| **Judge's phone is ancient** | L3 handles it. This is why the ladder exists. |
| **Ran out of time** | Jump straight to the B-04 refusal. It's the strongest 20 seconds *in this build*. |
| **Asked why there is no certificate** | Answer directly before they ask: one required module has a step the safety reviewer has not approved, so it cannot be certified, so nothing is. It is the gate refusing on purpose. Do not apologise for it. |

**Pre-demo checklist, every time:**

- [ ] Deployed to HTTPS, loaded once on the demo phone
- [ ] **You have read §1.1 and you are not going to try to issue a certificate**
- [ ] Airplane mode tested end-to-end
- [ ] Camera permission flow tested fresh
- [ ] L2 runs the full 120 seconds cleanly *(the critical gate — no markers, no setup)*
- [ ] L3 verified on a desktop with the camera disabled
- [ ] Second phone on the verify page, scanner working *(unused until step 4 is approved)*
- [ ] Dashboard seeded and showing the heatmap
- [ ] Language preset to Hindi
- [ ] Console clean
- [ ] Screen recording fallback ready
- [ ] **Santali answer rehearsed** — don't be asked cold *"where's Santali?"*

---

## 6. Narrative spine

Four sentences, in this order, for any format:

1. **The problem is real and measured.** DGMS fatality data. A large share involved workers with
   under 30 days of orientation. The training isn't sticking and the certification hides it.
2. **The constraint is physical.** No headset, no install, no licence, no network, no camera on
   some days. Every design decision follows from that.
3. **The insight.** Everyone certifies attendance. Research says the gains are short-term. So we
   test cold, and we block the certificate when it doesn't stick.
4. **The proof.** Hand them the phone. Make them fail. Show the block. Show the unlock. Scan the QR.

**If you only remember one thing:** the product is not the AR. The product is the gate.

---

## 7. Document set

| Doc | Purpose |
|---|---|
| [01 — Gap Analysis](./01-gap-analysis.md) | Prior art, competitor repos, positioning, constraints C1–C8 |
| [02 — PRD](./02-prd.md) | Users, scope, non-goals, metrics, acceptance |
| [03 — Product Spec](./03-product-spec.md) | Step schema, state machine, rubric, fallback ladder |
| [04 — Data Model](./04-data-model.md) | Convex schema, API surface, offline sync contract |
| [05 — AR Technical Spec](./05-ar-technical-spec.md) | Tracking, markers, performance, failure modes |
| [06 — Content Spec](./06-content-spec.md) | Both modules' step data, content sources, missing domains, i18n |
| [07 — Architecture](./07-architecture.md) | Stack, layout, routing, deployment, CI gates |
| [08 — Demo Script](./08-demo-script.md) | This file |
