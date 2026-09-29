# KAVACH (working name)

**SIH26041** — AR-Based Vocational Training Simulator for Industrial Safety
Government of Jharkhand · Mining & Manufacturing

> Headset-free, offline-capable AR safety training on a mid-range Android phone, gated on
> demonstrated competence rather than attendance.

---

## Status

**Core backend built and verified.** Step data not yet added.

| Component | State | Verified by |
|---|---|---|
| `convex/schema.ts` — 10 tables, 21 indexes | **Deployed** | `convex dev --once` + generated `dataModel.d.ts` |
| `src/lib/types.ts` — shared domain contract | **Done** | typecheck |
| `src/lib/scoring.ts` — the rubric | **Done** | 40 unit tests + integration |
| `src/lib/gate.ts` — G1–G8 + cold re-check | **Done** | 24 unit tests + integration |
| `convex/attempts.ts` — idempotent ingest + authoritative scoring | **Done** | 9-check live-DB self-test |
| Module manifests (`FIRE.json`, `GAS.json`) | **Next** | — |

```
bun test          # 75 unit + integration tests
bun typecheck     # clean
bun convex:dev    # push schema
bun convex:selftest  # 9 checks against the live database
```

| Doc | Contents |
|---|---|
| [01 — Gap Analysis](docs/01-gap-analysis.md) | Prior art, academic research, GitHub competitor scan, positioning, **binding constraints C1–C8** |
| [02 — PRD](docs/02-prd.md) | Users, scope, non-goals, success metrics, FR-1…FR-12, acceptance criteria, risks |
| [03 — Product Spec](docs/03-product-spec.md) | Step schema, module state machine, **assessment rubric G1–G8**, AR fallback ladder |
| [04 — Data Model & API](docs/04-data-model.md) | Convex schema, query/mutation surface, certificate signing, **offline sync contract** |
| [05 — AR Technical Spec](docs/05-ar-technical-spec.md) | Tracking strategy, marker pipeline, performance budget, failure modes |
| [06 — Content Spec](docs/06-content-spec.md) | **Full step data for both modules**, content sources, missing-domain strategy, i18n |
| [07 — Architecture](docs/07-architecture.md) | Stack, repo layout, routing, offline architecture, deployment, CI gates |
| [08 — Demo Script](docs/08-demo-script.md) | The 120-second run, pitch, judge Q&A bank, failure contingency |

Read **01** first — it constrains everything else.

---

## The differentiation in one paragraph

Immersive safety training is a saturated market: Pixaera, 360 Immersive, Immersive Factory and
CSCS's digital skills passport all ship production products, and the open-source space — including
several SIH2026 teams building this exact statement — is full of feature checklists. Every one of
them certifies **attendance or content delivered**. Research — including Msweli et al. (IEEE,
2026) and Scorgie et al. (*Safety Science*, 2024) — finds immersive training produces **short-term
gains only**. So KAVACH scores first-attempt accuracy, self-recovery, sequencing integrity and
hesitation, then **re-tests cold ninety seconds later** and refuses to issue a certificate until
retention is demonstrated. On a **zero-licence MIT stack**, **fully offline**, with **step-level
competency heatmaps** that tell a supervisor not just who failed but which specific skill their
crew is failing.

**Two deliberate cuts, both recorded with reasoning:**
- **Santali is declared, not built** ([01 §7.1](docs/01-gap-analysis.md)) — the locale slot is
  reserved and shipping it is one JSON file plus audio. We will not machine-translate safety
  instructions for a mine.
- **AR ships as reticle + guided modes only** — world tracking and printed markers are the two
  things most likely to fail live on a judge's phone. Same pedagogy, far fewer ways to die.

---

## Modules

| Code | Domain | Steps | Critical steps |
|---|---|---|---|
| `FIRE` | Fire & explosion — exit ID, extinguisher selection + PASS, evacuation order | 6 | A-03, A-05 |
| `GAS` | Gas leak & confined space — hazard zone, PPE, buddy entry, isolation | 6 | B-02, B-03, B-05 |
| `LOTO` | Declared, not built — the statement is truncated at domain 3 of 5 | — | — |
| *`sat` locale* | Declared, not built — one JSON file and audio away | — | — |

Full step data: [06-content-spec.md](docs/06-content-spec.md)

---

## Binding constraints

Defined in [01](docs/01-gap-analysis.md) §7, enforced as CI gates in [07](docs/07-architecture.md) §9.

| # | Constraint |
|---|---|
| C1 | 100% MIT/Apache/OSS. No per-seat licence, no runtime SaaS dependency |
| C2 | No licensed or scraped third-party content. All assets authored or generated in-house |
| C3 | Module content is **data in a table**, never code branching |
| C4 | Assessment measures **first-attempt behaviour**, not completion |
| C5 | Every string exists in `en` and `hi`. The `sat` slot is reserved, not shipped. No hardcoded UI text |
| C6 | AR degrades through an explicit fallback ladder to a no-camera path |
| C7 | Certificate issuance requires a **cold-retention re-check** |
| C8 | All attempt telemetry is **step-level**, never module-level |

---

## Stack

React 19 · TypeScript · Vite · Convex + Convex Auth · Tailwind · shadcn/ui · Dexie ·
vite-plugin-pwa · WebCrypto Ed25519 · qrcode / jsQR · Bun

*Three.js / R3F and MindAR are retained in the architecture but not required for MVP.*

---

## Build order

1. ~~Convex schema + `scoring.ts` / `gate.ts`~~ — **done**
2. **Content review** — get one qualified safety reviewer on both modules *(R9, blocks accuracy claims)*
3. **Module manifests as data** — `FIRE.json`, `GAS.json` ← *you are here*
4. Module runner state machine against a hardcoded manifest
5. L2 reticle AR layer + L3 guided fallback
6. Certificate issuance + signed QR
7. `/verify/:code` public page
8. Bilingual UI (en + hi) + recorded Hindi narration
9. Offline queue + sync
10. Admin dashboard + step heatmap
11. Seed data

The rubric, the gate and the schema are the parts that are expensive to get
right and cheap to change later. They are done and tested, so step data can
now be dropped in as pure JSON.

**Record the Hindi narration in week one** — ~36 short clips, one sitting with a native speaker and
a phone voice recorder. Not a blocker, but it must not be left to the last night.

---

## Naming

`KAVACH` (कवच — armour/shield) is a **working name**, unverified as a trademark, used as a
codename so the specs stay consistent. Renaming is a find-and-replace of one token.
