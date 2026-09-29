# 05 — AR Technical Specification

**Project:** KAVACH · **Version:** 2.0 · **Date:** 2026-09-29
**Revision:** L0 world tracking and L1 marker tracking **cut from MVP**; L2 + L3 ship
**Governed by:** [03](./03-product-spec.md) §6 (fallback ladder), [02](./02-prd.md) NFR-1…NFR-3, [01](./01-gap-analysis.md) C1/C2

---

## 1. Strategic decision: no plane detection

We do **not** implement ARCore plane detection or world anchoring as the primary path.

**Why:**
- Plane detection on a mid-range phone in an unfamiliar room is the single most reliable way to fail
  a live demo. Lighting, blank walls, and a judge's unfamiliar ceiling will defeat it.
- It requires native ARCore or a heavy WASM path — both cost demo-day risk for a visual effect we
  do not need.
- The pedagogy is *"find the exit in your real space and act on it."* That needs the trainee to
  **attend to their surroundings**, which the phone camera already forces.

**Instead:** camera passthrough with anchored, clearly-labelled targets and a full-screen overlay.
The real world is the scene graph. This is more robust, lighter, and — for this use case —
more pedagogically correct.

---

## 2. Rendering stack

| Layer | Choice | Licence | In MVP | Why |
|---|---|---|---|---|
| Render | **Three.js** | MIT | Yes | 116k stars, ubiquitous, tiny core |
| React binding | **React Three Fiber** | MIT | Yes | 32k stars, declarative, native to our stack |
| Fallback overlay | Plain DOM/CSS | — | Yes | L3 needs no 3D at all |
| Image tracking | **MindAR** (`mind-ar-js`) | MIT | **No — cut** | L1 deferred; 2,740 stars if reinstated |
| Markers | **AR.js** | MIT | **No — cut** | L1 deferred; 5,996 stars if reinstated |
| World tracking | **8th Wall (OSS)** / WebXR hit-test | OSS | **No — cut** | L0 deferred |

**Every dependency is MIT.** *(C1)* No SaaS, no token, no per-seat licence, no runtime network
call to a vendor. In a government procurement conversation this is the whole argument.

**Explicitly rejected:** `react-three-mind` (53 stars, **unlicensed** — all rights reserved, not
reusable) *(C2)*; Zapworks / AR Code / 8th Wall Studio SaaS (vendor lock-in); A-Frame as primary
(too declarative for a data-driven step machine — kept as reference only).

**On the cut libraries.** MindAR and AR.js are not deleted, not removed from `package.json` if
already added, and not "rejected on merit" — they are **deferred**. The `ARMode` type keeps all
four members and `mode.ts` keeps the detection branches, so re-enabling L0/L1 is a feature flag,
not a refactor. They are listed above so nobody re-litigates the research.

---

## 3. Fallback ladder implementation

The ladder from [03](./03-product-spec.md) §6. **Capability detection at session start, manual
override available in the UI.**

### MVP: L2 and L3 only

**L2 (reticle) is the primary path and L3 (guided) is the fallback.** Both are deterministic: no
tracking, no pose estimation, no lighting dependency, no printed assets required. The identical
`Step[]` data, the identical `successCriteria`, the identical attempt telemetry.

```
L2  getUserMedia(rear) → <video> fullscreen
    → touch-driven reticle
    → target outlines at fixed normalised positions
    → tap outline to interact
    → 100% of steps evaluable

L3  no camera
    → large reference photo + same tap-the-object interaction
    → runs on a desktop, a camera-less phone, or a feature-phone text path
```

```ts
// All four modes stay in the type. MVP ships reticle + guided; world and marker
// are optional enhancements behind capability detection — not dead code, not deleted.
export type ARMode = "world" | "marker" | "reticle" | "guided";
export const SHIPPED_MODES: ARMode[] = ["reticle", "guided"];
```

**This is a deliberate simplification, not a compromise.** L2 preserves the pedagogy — the
trainee still points the phone at the real extinguisher and taps it — while eliminating every
failure mode that ends a live demo. The assessment, which is the actual product, is bit-identical
across both modes.

### L0 — World tracking *(deferred)*

```ts
const supported = await navigator.xr?.isSessionSupported("immersive-ar");
if (supported) {
  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test", "local"],
    optionalFeatures: ["dom-overlay", "anchors"],
    domOverlay: { root: overlayRef.current },
  });
  // reticle from XRFrame hit-test, tap to place
}
```

**Risk:** Chrome-on-Android exposes `immersive-ar` on a narrow device set, often behind
`chrome://flags`. **Never gate the demo on this.** Not built in MVP — this section is retained so
the decision is documented and reversible.

### L1 — Image tracking *(deferred)*

MindAR, anchored to **printed A4 markers**. This is what will run in the demo for most phones.

```
Target marker → MindAR WASM tracker → THREE.Group with world pose
              → mesh + label + hit area, positioned in world space
```

**Marker set** (13 assets, all authored in-house *(C2)*):

| Marker | Module | Step refs |
|---|---|---|
| `exit-sign` | A | A-01, A-05 |
| `fire-alarm` | A | A-02 |
| `extinguisher-co2` | A | A-03 |
| `extinguisher-abc` | A | A-03 |
| `extinguisher-water` | A | A-03 |
| `assembly-point` | A | A-06 |
| `gas-cylinder` | B | B-01 |
| `ppe-station` | B | B-02 |
| `permit-board` | B | B-03 |
| `zone-barrier` | B | B-04 |
| `valve-main` | B | B-05 |
| `valve-isolate` | B | B-05 |
| `refuge-chamber` | B | B-06 |

L1 in the demo: print the sheet, tape the exit sign and extinguisher markers to two walls. The
judge walks the room, points the phone, taps. **This reads as more impressive than a virtual
world, because it is happening in their actual space** — and it cannot fail on lighting.

### L2 — Aim-and-tap reticle · **MVP PRIMARY**

No tracking. A free-floating reticle follows touch. Step targets show as **outlined silhouettes**
at fixed normalised screen coordinates. The trainee taps the silhouette. Fully deterministic, works
in any lighting, needs no printed assets. This is the **guaranteed demo path** — if in doubt, start
here.

### L3 — Non-AR guided mode · **MVP FALLBACK**

No camera. Large reference photo, tap-the-object exercise, audio-led, identical step data. Runs on
a desktop, a camera-less phone, or a feature phone via the text path. **Never an error state — a
first-class mode with its own label in the UI.**

```ts
export type ARMode = "world" | "marker" | "reticle" | "guided";
```

**Degradation must be visible.** A silent drop from L0 to L3 mid-demo makes the product look
broken; a labelled drop reads as engineering competence. Always show the active mode chip.

---

## 4. Asset pipeline *(C2)*

| Asset | Method | Licence | In MVP | Count |
|---|---|---|---|---|
| Silhouette sprites | In-house SVG → PNG, high-contrast single-object | Original | Yes | 13 |
| Smoke / hazard overlay | Custom CSS + GLSL-free canvas layer, noise FBM | Original | Yes | 2 |
| Iconography | Lucide (ISC) | ISC | Yes | ~30 |
| Font (UI) | Noto Sans (OFL) | OFL | Yes | 1 |
| Font (Devanagari) | Noto Sans Devanagari (OFL) — self-hosted | OFL | Yes | 1 |
| Audio | Recorded in-house — Hindi + English narration | Original/owned | Yes | ~36 |
| 3D props | Primitive geometry + in-house textures | Original | No — deferred | ~8 |
| Marker targets | Vector → PNG, MindAR `.mind` compiled | Original | No — deferred | 13 |

**Rule: nothing downloaded, nothing scraped, nothing licensed from a vendor.** *(C2)*
Fonts are **self-hosted, never a CDN link** — a CDN font would break offline and violate *(C1)*.

**No 3D modelling in MVP.** L2 and L3 render silhouettes and overlays. This removes the single
largest content-production cost identified in the gap analysis and buys assessment depth instead.
If L0/L1 are ever reinstated, the marker targets and 3D props above become the work.

---

## 5. Performance budget *(NFR-1, NFR-2)*

Target: **≥ 30 fps sustained** on a mid-range Android.

| Item | Budget |
|---|---|
| Draw calls | < 30 (L2 uses 2D sprites; 3D path deferred) |
| Textures | < 12 MB total, max 1024², KTX2-compressed |
| RTF overlay | < 3 ms — DOM/CSS, never 3D text |
| Per-step load | < 200 ms (preload next step's assets during current step) |
| Camera stream | 1280×720 @ 30 fps |

**Text is DOM, not the canvas.** Rendering instruction text in a 3D scene is the most common
performance mistake; it also breaks Devanagari shaping. All text is absolutely-positioned HTML
over the video layer.

### Memory

Free textures and geometries on step transition. Target: **< 250 MB** resident.

### Preload strategy

```
step seq N active  →  idle-time preload seq N+1 assets
                    →  pre-compile speech synthesis buffers
                    →  warm the next audio clip in the <audio> element
```

Step transitions must feel instant — latency breaks the illusion that you are in a real drill.

---

## 6. Camera & permissions

- `getUserMedia({ video: { facingMode: "environment" } })` — **rear camera only**. Front camera
  makes the AR pointless.
- HTTPS required. Freebuff preview serves over TLS — verify before the demo.
- Permission denied → **L3 immediately, in < 2 s**, with a friendly message, never an error screen.
- `playsInline`, `muted` to satisfy iOS autoplay policies.
- **No frame ever leaves the device.** *(NFR-7)* Zero upload code path, zero telemetry on the feed.
  This should be a stated feature, not just an absence.

### Android 10+ *(NFR-3)*

Tested target. Android 8 degrades to L3. Large-text and high-contrast modes are toggles in
settings, not media queries — semi-literate users on a dusty phone in daylight need it.

---

## 7. Audio pipeline

Audio is **the primary instruction channel**. *(FR-10)*

```
Recorded clip (wav → m4a, 64 kbps mono)
  → precached in service worker
  → IndexedDB blob store
  → <audio> element, preloaded, played on step entry
  → independent of network
```

**Why recorded, not TTS:** Chrome's Web Speech API does expose `hi-IN`, but it is cloud-dependent,
robotic, and **breaks offline** — which would break the one property we are demoing. Recorded audio
from a native speaker is the only credible path. *(01 §2.5)*

Audio files are committed to the repo — they are content, not build artefacts. CI asserts every
`(stepId, locale)` in every published manifest has a matching clip. **A missing clip fails the
build.** *(03 §9)*

Language switch mid-step swaps the clip and continues — state is never lost. *(C5)*

---

## 8. Failure modes & handling

| Failure | Behaviour | User sees |
|---|---|---|
| Camera permission denied | → L3 | "Camera unavailable — guided mode", full training still works |
| No camera hardware | → L3 | Same, detected not prompted |
| Camera stream drops mid-step | → L3 | Session state preserved, attempt not recorded |
| WebGL context lost | → L3 | Graceful, session state intact |
| Low battery (< 10%) | Warn, suggest L3 | Non-blocking |
| Tab backgrounded | Pause session, keep state | Resume where they were |
| Device overheating | Auto-drop to L3, notify | Visible reason |

**The universal rule: never lose session state, never hard-fail, always offer a path forward.**
With only two modes in MVP this table is short — which is the point. Fewer modes, fewer failure
paths, and the demo cannot land in an unhandled state.

---

## 9. Security & privacy in the AR layer

| Concern | Control |
|---|---|
| Camera feed | Local only, never uploaded *(NFR-7)* |
| Permission abuse | Requested at the point of use, with a plain-language explanation first |
| No background camera | No capture while off-screen |
| Third-party scripts | No AR/analytics vendor scripts on the training route *(C1)* |

---

## 10. Verification checklist before the demo

- [ ] Tested on **a real mid-range Android phone**, not a simulator
- [ ] L2 → L3 degradation tested by revoking camera permission
- [ ] **L2 runs the full 120-second demo with no tracking dependency** ← the critical gate
- [ ] L3 runs both modules end-to-end on a desktop, camera disabled
- [ ] ≥ 30 fps measured in L2 on the actual demo device
- [ ] Devanagari font renders **offline** (airplane mode) with correct conjunct shaping
- [ ] All audio plays offline after first load
- [ ] Language switch mid-module preserves `seq`, `attemptIndex` and all signals
- [ ] Step transition latency < 200 ms on the demo device
- [ ] No console errors in the AR view on the demo device
- [ ] Chrome DevTools device emulation + synthetic camera passes (layout, SW, permissions)
