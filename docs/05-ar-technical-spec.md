# 05 — AR Technical Specification

**Project:** KAVACH · **Version:** 3.0 · **Date:** 2026-09-30
**Revision:** **L1 marker AR now ships.** L0 world tracking remains cut. L2 + L3 ship as before,
and the walkable 3D room (§3.1) remains the current primary training surface. Four of the four
reactive kinds of presentation are now real: L1 is the only one that renders against the physical
world.
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
| React binding | **React Three Fiber** | MIT | **No — not used** | Considered and dropped. The room is one imperative loop; a reconciler between React and a per-frame loop adds a dependency without adding safety. The direct Three.js loop is smaller and owned end to end. |
| Fallback overlay | Plain DOM/CSS | — | Yes | L3 needs no 3D at all |
| Image tracking | **MindAR** (`mind-ar-js`) | MIT | **Yes — L1** | 2,740 stars. Compiled `.mind` targets, tracked in the camera feed |
| Markers | **AR.js** | MIT | **No — not needed** | Kept as the fallback if MindAR's detector proves too heavy (§3.2) |
| World tracking | **8th Wall (OSS)** / WebXR hit-test | OSS | **No — cut** | L0 deferred |

**Every dependency is MIT.** *(C1)* No SaaS, no token, no per-seat licence, no runtime network
call to a vendor. In a government procurement conversation this is the whole argument.

**Explicitly rejected:** `react-three-mind` (53 stars, **unlicensed** — all rights reserved, not
reusable) *(C2)*; Zapworks / AR Code / 8th Wall Studio SaaS (vendor lock-in); A-Frame as primary
(too declarative for a data-driven step machine — kept as reference only).

**On the cut library.** AR.js is not deleted and not "rejected on merit" — it is a documented
fallback. The `ARMode` type still keeps all four members, so re-enabling L0 is a feature flag,
not a refactor. Both are listed above so nobody re-litigates the research.

**L1 is now built, and it cost the feature flag it was promised to cost.** Re-enabling it meant
adding `"marker"` to `SHIPPED_MODES` in `src/lib/ar.ts`, one renderer (`src/lib/ar/SceneAR.tsx`),
and one compile script. `runner.ts`, `scoring.ts` and `gate.ts` were not touched: the AR view
dispatches the same `tapTarget`/`choose`/`perform` actions as every other surface, so the
assessment cannot tell which one answered.

---

## 3. Fallback ladder implementation

The ladder from [03](./03-product-spec.md) §6. **Capability detection at session start, manual
override available in the UI.**

### Shipped: L1, L2 and L3

**L1 (marker) is the production presentation path (see §3.2), L2 (reticle) and L3 (guided) are the
fallbacks.** L2 and L3 are deterministic: no tracking, no pose estimation, no lighting dependency,
no printed assets required. L1 is the one mode that depends on something physical being prepared.
All of them run the identical `Step[]` data, the identical `successCriteria`, the identical attempt
telemetry.

```
L1  getUserMedia(rear) → MindAR detects a printed marker
    → object drawn on the marker, over the live camera
    → tap the object to interact
    → only observe steps (the ones with a printed marker) are offerable

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
// All four modes stay in the type. Three ship; only world is still cut, and it
// stays in the union so re-enabling it is config rather than a refactor.
//
// SHIPPED_MODES is the feature flag. Removing "marker" from this array is a
// complete rollback of L1: the ModeSwitch reads the array, so the control
disappears with it, and resolveARMode falls through to guided.
export type ARMode = "world" | "marker" | "reticle" | "guided";
export const SHIPPED_MODES = ["marker", "reticle", "guided"] as const;
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

### L1 — Image tracking · **SHIPPED, PRODUCTION PATH**

MindAR, anchored to **printed markers**. This is what runs in the demo for most phones.

```
Target marker → MindAR detector (TFJS/WASM) → THREE.Group with world pose
              → mesh + label + hit area, positioned in world space
```

**Implemented** in `src/lib/ar/SceneAR.tsx`, over a marker set compiled by
`bun run make:targets`. Four of the thirteen marker assets are compiled so far — the four
`observe` targets that actually appear in the shipped manifests (`exit-sign`, `fire-alarm`,
`gas-cylinder`, `zone-barrier`). The rest are deferred with the L1 rollout, not with the level.

**Scope: `observe` steps only.** A `decide` step presents four alternatives to compare and an `act`
step presents an order to follow; both are screen tasks, and scattering them around a room makes
them worse, not better. Where a step has no printed marker, the AR surface is not offered and the
3D room is used instead — the `ModeSwitch` reads `SHIPPED_MODES` and disables the option rather
than offering a button that opens onto a camera looking for something that is not there.

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

**These 13 ids are live, not aspirational.** The printed A4 markers are deferred with L1, but the
*object vocabulary* is enforced today: it lives in `src/lib/markers.ts`, every id belongs to
exactly one module, and `validate-content` fails the build if any id outside this table reaches a
manifest. This table is the reason a gas-detection room cannot contain a fire hose reel — a
plausible-looking object that is in no manifest, no doc and no spec, and that used to be wired
straight into the grading path, so tapping it recorded a real gas-safety consequence against
something that does not exist.

L1 in the demo: print the sheet, tape the exit sign and extinguisher markers to two walls. The
judge walks the room, points the phone, taps. **This reads as more impressive than a virtual
world, because it is happening in their actual space** — and it cannot fail on lighting.

### 3.2 L1 — what it actually costs, and the risks

**Two honest costs, both measured or measurable:**

1. **Bundle weight.** The AR chunk is ~1.03 MB minified / ~266 kB gzipped, because MindAR pulls in
   TensorFlow.js and a detector model. It is behind a dynamic import, so a trainee who never opens
   the AR view downloads none of it — but a trainee who does pays for it once.
2. **Frame budget.** The detector is the heaviest thing in the app. `NFR-1` wants 30 fps sustained
   on a mid-range Android, and that has **not been measured on real hardware**. This is the number
   most likely to send L1 back into a fallback role, and §10 lists it as open.

**Two dependencies had to be worked around, and both are documented in code:**

- MindAR 1.2.5 imports `sRGBEncoding` from `three`, which three removed in r152. This project runs
  three 0.186, so the upstream module cannot resolve. `src/lib/ar/mindar-three.js` is a vendored
  copy with a two-line correction, and the exact diff is at the top of that file.
- MindAR depends on the native `canvas` package, which needs node-gyp. There is no C++ toolchain in
  the hosting image, and `bun install` runs from clean on every deploy, so that dependency would
  break the build. It is stubbed via `overrides` in `package.json`; the `.mind` compiler is driven
  by `scripts/make-targets.ts` using `@napi-rs/canvas` instead.

**If the frame budget fails,** AR.js with barcode markers is the documented fallback: no TFJS, no
model, far lighter, at the cost of the marker being a barcode rather than a sign that looks like the
real thing. That trade was made deliberately and can be unmade.

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

### 3.1 The 3D room — a second surface, not a fifth level

The ladder above is unchanged: four levels, two shipped. What changed is that each shipped level
now has **two surfaces** — the 2D scene it always had, and a walkable 3D room
(`src/components/Scene3D.tsx`).

**It is not AR, and it does not pretend to be.** No WebXR, no camera, no world tracking, no image
tracking, no hit-test. It is an ordinary first-person 3D space rendered by Three.js, and the UI
labels it "3d room" rather than dressing it as something it is not. That is the point of the
trade: it runs on iOS Safari, where WebXR immersive AR does not exist at all; it needs no camera
permission and no printed markers; and it works with the network down.

The room is the default surface on `observe` steps and toggles back to the 2D scene from the step
header, because on a shared or low-end handset the 2D scene is sometimes the more usable surface —
entering a room you cannot leave is a worse failure than a flat one. Three.js loads as a single
lazy chunk that is only fetched when the room is actually opened, so a trainee who never leaves
the 2D scene never pays for it.

Tapping an object dispatches the same `tapTarget` action the 2D scene and the card list already
dispatch. `runner.ts`, `scoring.ts` and `gate.ts` cannot tell which surface was used, so **the
assessment is bit-identical across all three surfaces.** The only thing the 3D room measures that
the others cannot is where the trainee was standing when they answered; that is captured and
deliberately not scored.

**Controls** are pointer-lock-free on purpose. Pointer lock is unreliable in embedded panes, and
it asks for a permission a trainee on a shared training handset should not have to grant. Instead:
drag-to-look, `WASD`/arrows to walk, `Q`/`E` to turn, hold-to-turn buttons for touch, and a
screen-centre crosshair that raycasts to whatever is aimed. Controls release on `blur` and
`visibilitychange`, so an alt-tab, a lock screen or an incoming phone call cannot leave a key stuck
down and walk the trainee into a wall for the rest of the session.

**L1 reinstated would still be the AR path.** The 3D room does not consume the marker set and does
not replace it. It is a third surface, orthogonal to the ladder.

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
| 3D props | Primitive geometry (box/cylinder/plane) + procedural materials | Original | Yes | 5 kinds + shell |
| Marker targets | Generated PNG → MindAR `.mind` compiled by `scripts/make-targets.ts` | Original | Yes | 4 of 13 |

**Rule: nothing downloaded, nothing scraped, nothing licensed from a vendor.** *(C2)*
Fonts are **self-hosted, never a CDN link** — a CDN font would break offline and violate *(C1)*.

**No authored 3D modelling — and still none.** This remains true and it remains the reason the
3D room is affordable at all. Every prop is assembled from primitive geometry at runtime: five
shapes (`sign`, `extinguisher`, `cylinder`, `valve`, `shelter`) over a procedural room shell. No
`.glb`, no texture atlas, no DCC tool in the loop, and therefore no asset pipeline to fund or to
break on demo day. L2 and L3 still render silhouettes and overlays with no 3D involved. If L0/L1
are ever reinstated, the marker targets above become the work — the 3D props already exist.

---

## 5. Performance budget *(NFR-1, NFR-2)*

Target: **≥ 30 fps sustained** on a mid-range Android.

| Item | Budget |
|---|---|
| Draw calls | < 30 for L2/L3 — 2D sprites, no 3D in the path. The 3D room is **not yet measured**; every mesh is a primitive sharing a small material set, so it is *expected* to sit well under 200, but that is an expectation and not a result. See §10. |
| Textures | < 12 MB total, max 1024², KTX2-compressed |
| RTF overlay | < 3 ms — DOM/CSS, never 3D text |
| Per-step load | < 200 ms (preload next step's assets during current step) |
| Camera stream | 1280×720 @ 30 fps |

**Text is DOM, not the canvas.** Rendering instruction text in a 3D scene is the most common
performance mistake; it also breaks Devanagari shaping. All text is absolutely-positioned HTML
over the video layer. The 3D room holds to the same rule from the opposite direction: its labels
are HTML elements projected from world space to screen coordinates on every frame and written
straight to `style.transform`, so the label pass costs zero React re-renders.

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
| L1: camera permission denied | → L2, then L3 | Falls through the chain; session state intact |
| L1: `.mind` fails to load | → L2 | Same. A bad or missing target file is a fallback, not an error screen |
| L1: marker never found | Stays in L1 showing "scanning" | The trainee is looking at the wrong place; this is guidance, not failure |
| L1: step has no printed marker | L1 not offered for that step | `ModeSwitch` disables it; the 3D room is used |
| Camera permission denied | → L3 | "Camera unavailable — guided mode", full training still works |
| No camera hardware | → L3 | Same, detected not prompted |
| Camera stream drops mid-step | → L3 | Session state preserved, attempt not recorded |
| WebGL context lost | In the 3D room → the 2D scene of the same step. No WebGL at all → L3 | Graceful, session state intact |
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
- [ ] **3D room: ≥ 30 fps measured on the demo device — not yet done, and it is the one number in this document still resting on an expectation**
- [ ] **L1: ≥ 30 fps measured in the AR view on the demo device — not yet done, and the single largest open risk in this document (§3.2)**
- [ ] L1: `bun run make:targets` reproduces `public/targets.mind` byte-for-byte from a clean cache
- [ ] L1: markers printed at ~15 cm and taped beside the real object; camera locks from arm's length
- [ ] L1: pointing at the *wrong* marker does not bind the object to it (the index contract, tested in `targets.test.ts`)
- [ ] L1: denying the camera drops to L2 → L3 with `seq`, `attemptIndex` and all signals intact
- [ ] L1: the AR chunk is not fetched until the AR view is opened (Network tab, cold load)
- [ ] 3D room: walk, turn, and tap-to-answer all work on touch without a keyboard
- [ ] 3D room: controls release on `blur` / `visibilitychange` — no stuck keys after a phone call
- [ ] 3D room → 2D scene toggle is reachable from every `observe` step, and 2D is never a dead end
- [ ] Every object in every room is in `src/lib/markers.ts` and is same-module — `validate-content` fails the build otherwise
