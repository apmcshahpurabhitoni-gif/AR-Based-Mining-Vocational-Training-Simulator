# 07 — Architecture

**Project:** KAVACH · **Version:** 2.0 · **Date:** 2026-09-29
**Revision:** `sat` reserved-not-shipped; L0/L1 deferred; 3D and markers out of MVP
**Governed by:** [01](./01-gap-analysis.md) C1–C8

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **React 19 + TypeScript + Vite** | Project default |
| Language | **TypeScript** | Strict mode |
| Styling | **Tailwind CSS + shadcn/ui** | Project default |
| Animation | **Framer Motion** | Project default; used in step transitions |
| Backend | **Convex** | Reactive queries, mutations, Node actions |
| Auth | **Convex Auth** | Username + password *(see 04 §2.3 for rationale)* |
| 3D | **Three.js + React Three Fiber** | MIT *(C1)*. Optional in MVP — L2/L3 use 2D sprites + DOM |
| AR tracking | **None required in MVP** | L2 reticle + L3 guided. MindAR/8th Wall deferred, MIT *(C1)* |
| Local store | **Dexie (IndexedDB)** | Offline attempts + audio blobs |
| Offline | **vite-plugin-pwa** (Workbox) | Service worker, precache |
| QR generate | **qrcode** | Certificate encoding |
| QR scan | **jsQR** or **@zxing/browser** | Verification page |
| Crypto | **WebCrypto Ed25519** | Signing + verification |
| Icons | **Lucide** | ISC |
| Package mgr | **Bun** | Project default |

**Zero paid dependencies.** *(C1)* No SaaS runtime calls. No vendor analytics on the training
route. Everything runs from our own deployment.

---

## 2. Repository layout

```
/
├── convex/
│   ├── schema.ts              # all tables — 04 §2
│   ├── modules.ts             # modules.list, modules.get
│   ├── sessions.ts            # start, complete
│   ├── attempts.ts            # record (idempotent batch)
│   ├── assessments.ts         # finalize + gate evaluation
│   ├── certificates.ts        # issue, revoke
│   ├── certificatesSign.ts    # Node action — Ed25519  [04 §3]
│   ├── admin.ts               # complianceGrid, stepHeatmap, expiryRadar
│   ├── users.ts               # register, list
│   ├── sync.ts                # markSynced
│   └── _generated/
├── src/
│   ├── main.tsx               # ConvexProvider + auth — DO NOT ALTER HIERARCHY
│   ├── App.tsx                # router
│   ├── index.css              # theme tokens, incl. Devanagari
│   ├── i18n/
│   │   ├── en.json  hi.json    # sat reserved — slot exists, file not shipped (01 §7.1)
│   │   └── useLocale.tsx       # resolver falls back sat → en
│   ├── lib/
│   │   ├── db.ts              # Dexie schema
│   │   ├── syncQueue.ts       # idempotent upload — 04 §5
│   │   ├── scoring.ts         # rubric — 03 §3, SHARED client/server
│   │   ├── gate.ts            # G1..G8 — shared
│   │   ├── verify.ts          # Ed25519 client-side verification
│   │   └── ar/
│   │       ├── mode.ts        # capability detection; world/marker branches deferred
│   │       ├── ReticleTracker.tsx   # MVP primary (L2)
│   │       ├── GuidedMode.tsx      # MVP fallback (L3)
│   │       ├── WorldTracker.tsx    # deferred
│   │       └── MarkerTracker.tsx   # deferred
│   ├── components/
│   │   ├── ar/                # AR scene, hotspot, smoke shader
│   │   ├── train/             # ModuleRunner, StepView, FailureState
│   │   ├── ui/                # shadcn + project components
│   │   └── charts/            # dashboard heatmap
│   ├── routes/
│   │   ├── Landing.tsx
│   │   ├── Auth.tsx
│   │   ├── Train.tsx          # module runner host
│   │   ├── Certificates.tsx   # worker wallet
│   │   ├── Verify.tsx         # PUBLIC /verify/:code
│   │   └── Admin.tsx          # RequireAuth
│   └── modules/               # ← content as data (C3)
│       ├── FIRE.json
│       ├── GAS.json
│       └── LOTO.json          # declared, not published — 06 §5
├── public/
│   ├── audio/{en,hi}/*.m4a    # ~36 clips
│   ├── sprites/*.png          # 13 silhouettes (in-house)
│   └── fonts/
│       ├── NotoSans.woff2
│       └── NotoSansDevanagari.woff2   # SELF-HOSTED (C1)
├── scripts/
│   ├── validate-content.ts    # i18n + audio coverage gate
│   └── seed.ts                # idempotent demo cohort
├── docs/                      # 01..08
└── package.json
```

**`scoring.ts` and `gate.ts` are shared between client and server.** The client shows live scores
offline; the server recomputes authoritatively. One implementation, no drift. This is why the
rubric lives in `lib/` and not in a Convex action.

---

## 3. Routing & auth flow

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Landing → CTAs into auth |
| `/auth` | Public | Sign in / register; `returnTo` preserved |
| `/train` | `RequireAuth` | Module list |
| `/train/:code` | `RequireAuth` | Module runner |
| `/certificates` | `RequireAuth` | Worker wallet |
| `/verify/:code` | **Public** | Supervisor verification |
| `/admin` | `RequireAuth` + role `admin` | Dashboard |
| `/admin/content` | `RequireAuth` + role `admin` | Module publishing |

**`RequireAuth` preserves the requested path** in `/auth?returnTo=...`, and `/auth`'s
`redirectAfterAuth` fallback points at `/train` — **never** back to the landing page.

**`/verify/:code` is intentionally public and must render without auth, without JS-heavy
dependencies, and on poor signal.** It is the one page a supervisor opens in a mine gallery. It is
also a marketing surface — it must be beautiful and bilingual.

---

## 4. Rendering & performance

| Route | Strategy |
|---|---|
| Landing | Static, fast, theme-specific |
| Train | Client-rendered; AR modules lazily loaded via `React.lazy` |
| Admin | Convex reactive queries — no polling, no refetch logic |
| Verify | Static shell + one thin query; no heavy bundle |

**AR code is code-split.** A supervisor on the `/verify` page must never download the training
bundle. Route-level `React.lazy` with a preload on `/train` entry. In MVP this bundle is small
(no tracking WASM); the split still matters for the main app chunk.

**Convex reactivity over client state.** Server state lives in Convex. Local state holds only:
current session, AR mode, language, and the offline attempt queue.

---

## 5. Offline architecture *(C6, FR-8)*

```
┌─ Service worker (Workbox) ───────────────────────────┐
│  precache: app shell, JS, CSS, sprites, fonts, audio  │
│  runtime: manifest JSON, verify payload                │
│  strategy: cache-first (immutable) + network-first (manifest) │
└────────────────────────────────────────────────────────┘
┌─ Dexie (IndexedDB) ───────────────────────────────────┐
│  attempts      ← written FIRST, always                │
│  audioBlobs   ← narration cache                       │
│  sessions     ← in-progress session state             │
│  certs        ← signed payload for offline verify     │
│  meta         ← contentVersion hash                   │
└────────────────────────────────────────────────────────┘
┌─ Sync engine ─────────────────────────────────────────┐
│  queue → batch (1.5 s debounce) → attempts.record    │
│  dedup by eventId (idempotent)                        │
│  pendingCount → syncState → visible indicator          │
└────────────────────────────────────────────────────────┘
```

**The write path is local-first, always.** No attempt is ever lost to a failed network call.
*(04 §5)*

**Certificate issuance requires one online moment.** The signature is server-side, so it cannot be
minted offline. After issuance the signed payload is cached locally, enabling **offline
verification** against the cached public key. This is stated honestly — no silent degradation.

### Content versioning

`syncState.contentVersion` = hash of published manifests. Mismatch → refetch. Sessions pin
`moduleVersion`, so a live session always runs the manifest it started with. *(04 §5)*

---

## 6. Deployment

| Aspect | Decision |
|---|---|
| Hosting | Freebuff-managed static hosting (Vite → `dist/`) |
| Backend | Convex cloud |
| HTTPS | Required for camera + WebXR — mandatory, verify before demo |
| Install | `bun install` |
| Build | `vite build` |
| Dev | `vite dev` on `0.0.0.0` |
| Env | `CONVEX_DEPLOYMENT`, `CERT_PRIVATE_KEY` (Node action only) |

**No server in the build.** Build produces static `dist/` and exits.

**Critical pre-demo check:** a phone on 4G must reach the HTTPS URL and the camera must
initialise. A non-HTTPS origin silently breaks `getUserMedia` and the entire AR layer.

---

## 7. Security

| Layer | Control |
|---|---|
| Auth | Convex Auth, role on every user record |
| Authorization | Server-side role checks on every `admin.*` and `certs.revoke` *(FR-12)* |
| Signing key | `process.env` in a Node action. **Never in the client bundle.** |
| Public verify | Minimal payload — name, worker code, org, modules, dates. No phone, no email, no address |
| Code entropy | 60 bits, non-sequential, rate-limited *(NFR-6)* |
| Camera | On-device only, never uploaded *(NFR-7)* |
| Content integrity | Manifest hash; server recomputes scores authoritatively |
| Input validation | Convex validators on every table and argument |
| Dependencies | MIT/Apache/ISC/OFL only, audited *(C1, C2)* |

**Threat model note:** the realistic threat is a forged certificate, not a network attack. Ed25519
over a canonical payload defeats forgery; a public chain would add cost and latency without
changing that. *(01 §6)*

---

## 8. Seed data

**The dashboard must never be empty on stage.** Seed:

- 2 orgs (1 mine, 1 plant), 2 sites
- 3 supervisors, 1 admin
- **48 workers** with realistic worker codes
- Assignments across both modules
- **Attempt history** producing a realistic heatmap — deliberately seeded so extinguisher
  selection shows ~38% failure, the headline insight
- 31 valid certificates, 4 expired, 2 revoked, 1 expired-then-revoked

**Never use real company or person names.** Fictional orgs only.

`scripts/seed.ts` is idempotent and re-runnable.

---

## 9. CI gates

| Gate | Rule |
|---|---|
| Typecheck | `tsc -b --noEmit` clean |
| i18n coverage | Every `en` key present in `hi`. `sat` permitted to be absent |
| Audio coverage | Every `(stepId, locale)` in published manifests has a clip, for `en` and `hi` |
| Content schema | Every manifest validates against the `Step` schema |
| Font check | Devanagari woff2 self-hosted, no CDN references in the bundle |
| Dependency audit | No non-MIT/Apache/ISC/OFL runtime dependency |
| Sprite check | Every `sprite` referenced in a manifest exists in `/public/sprites` |

**These are the constraints of the product, expressed as tests.** C1, C2 and C5 are not
conventions — they fail the build.

---

## 10. Architecture-level risks

| Risk | Mitigation |
|---|---|
| AR bundle bloats the initial load | Route-level `React.lazy`, preload on `/train` |
| Convex offline conflicts | Append-only attempts, idempotent `eventId` *(04 §5)* |
| Weak device performance | L2 primary / L3 fallback, text budget, DOM overlay *(05 §5)* |
| i18n drift | CI gate, not discipline |
| Missing audio at demo | Build fails; fall back to English audio with Hindi text |
| HTTPS misconfiguration | Pre-demo checklist item — silent killer for `getUserMedia` |
| Scoring drift client vs server | Shared `scoring.ts` / `gate.ts` — one implementation |
| **Content inaccuracy** *(R9)* | Qualified safety reviewer signs off before any accuracy claim *(06 §1.3)* |
