# 3D Bay & Control System — Plan

Status: phases 0–6 are built. Phases 0–2 are described below as they were
written; 3–6 have their own sections at the end, with what was actually done and
what a test now holds in place.

Two things in this plan were **not** done, on purpose, and both are recorded
where they belong rather than left to be discovered:

- **The two-bay room** is still unbuilt, and it is the one open item in §9 that
  changes a graded step. It has to precede any further orientation work.
- **The mode tabs** in phase 6 are not built, because they are a product
  decision rather than a rendering one.

Scope: the wide mine bay in `Scene3D`, the equipment in `environment.ts` /
`prop-shapes.ts`, and the controls that drive them. Reference: the uploaded
images — the wide panoramic bay with labelled objects and a minimap, the FIRE
module design board, and the real mine photographs.

## Decisions taken

| Question | Answer | What it changes |
|---|---|---|
| Start point | **Phase 0 only** — presets + on-screen readout | Rest unchanged; phases 1–6 stay unbuilt until the room can be looked at |
| Target device | **Modern mid-range**, tune for typical | Phase 1 is cheaper than planned: no need to survive a 2019 budget phone |
| Room shape | **Two connected bays** | The largest single change in the plan — see below |

### Two bays, and what it costs

The design board draws an alternate route and a refuge chamber, which implies
more than one space. Two bays is a different amount of work from one, and it
should be done as its own phase rather than folded into the lighting work:

- `ROOM` becomes two volumes with a connecting opening, not one box. That
  changes the wall builder, the collision clamp (currently a rectangle), the
  bay map, and the spawn framing.
- The second bay needs its own scenery, and the refuge chamber is
  `docs/13` content — a room that teaches "go here" is teaching something, so
  the second bay is scenery-only until the spec says otherwise.
- The alternate route is paint, not teaching. Which route is correct is safety
  content and is not mine to author (§7).
- **It also makes phase 0 more valuable, not less**: with two spaces, "where am
  I" stops being answerable from a single minimap, so the orientation work in
  phase 4 has to account for a second space before it starts.

It is not on the critical path for phases 1, 2 or 5, so the sequence below is
unchanged — but it should be sequenced *before* phase 4, or phase 4 gets built
twice.

---

# Phase 0 — built

`docs/16` phase 0 asked for a way to see the room and a way to measure it.
Implemented:

- **`src/lib/room-views.ts`** — six named, fixed viewpoints as data: entry,
  conveyor, backwall, tunnel, corner, ceiling. `?view=<id>` on any training URL
  loads one and **locks the camera**, so the same URL gives the same frame on
  any device. That is the whole point: two photos can be compared, and
  "open the app and look around" cannot be.
- **A lock badge** naming the view and what it is for, so a screenshot
  identifies itself. A photo of a frame with nothing on it cannot be told from
  one taken at the entry.
- **`src/lib/frame-stats.ts`** — fps, mean frame ms, **worst** frame ms, draw
  calls, triangles, and the id under the crosshair. On screen, in the corner,
  behind a toggle; on automatically when a preset is loaded. Written straight
  to a DOM node four times a second, so the readout costs nothing close to what
  it measures.
- The worst-frame number is the one to watch. A room running at 30 fps with a
  400 ms stall in the window averages to a respectable 28, and that stall is
  what a trainee calls "it froze".

**How to use it:** open `…/train/FIRE?view=entry` (and the other five ids) on the
phone the pilot will use, and photograph each one. `?view=ceiling` and
`?view=corner` are the two that expose flat ambient light and a ceiling with no
scale. If the numbers in the corner are under 30 fps, phase 1 comes before
phase 2 — better lighting on a 20 fps room is a slide-show with nicer shadows.

### Still true

I still cannot see any of it. Phase 0 makes the room reviewable; it does not
review it.


---

## 0. The thing that has to come first

**No one has seen this room render.** Not me — I have no browser — and not a
human, because the build has only ever been verified by typechecker and unit
test. Everything in this plan is reasoned about the source, not observed.

That matters more than usual here, because "make the 3D perfect" is not a task
I can complete alone. I can make the lighting, the draw-call count and the
control layout correct *by construction*; I cannot tell you whether the result
looks like a mine.

So **Phase 0 is a way of looking**, before any visual work. Everything after it
gets cheaper, because the feedback loop stops being "push code and hope".

### Phase 0 — a way to see and to measure

- **Camera presets.** `?view=entry|conveyor|backwall|tunnel|corner` puts the
  camera at a fixed known viewpoint, so a phone screenshot of five URLs is five
  comparable frames instead of five lucky ones.
- **An in-app readout**: FPS, frame ms, draw calls, triangles, programs. On the
  screen, in the corner, behind a toggle. A number that is on screen is a
  number the reviewer can put in a message; a number in a devtools console on a
  Windows laptop is not evidence about a ₹8,000 Android handset.
- **A "what am I looking at" debug list** — the id of the prop under the
  crosshair. If a piece of equipment looks wrong, we need to name it.

Deliberately small, and deliberately the first thing built. Twelve versions of
a lighting change with nobody looking at them is a waste of the reviewer's
patience, which is the scarcest resource here.

---

## 1. Performance floor — built

Before "make it look better", because a 20 fps room is not improved by
better lighting. This is a mine handset, not a workstation, and the settings
were tuned for the wrong device.

| Was | Why it was wrong | Now |
|---|---|---|
| `setPixelRatio(min(dpr, 2))` | On a 2.75× panel this still rasterises 53% of a 1× baseline — 4× the pixels of a 1× one. Fill rate, not geometry, is what kills these devices. | `src/lib/device-profile.ts`: 1.5× on mobile, 2× desktop, 1× low-power |
| `antialias: true` | MSAA is a WebGL **context attribute** — it cannot be changed after construction, so it is the one setting that had to be decided before the renderer existed. On a phone it pays for the same edges twice, because the pixel ratio already supersamples. | Off at both mobile tiers, on at desktop |
| 26 separate boulder meshes | 26 draw calls, and 26 submissions to the shadow pass, for geometry that never moves and is never picked | One `InstancedMesh`; the count lives in `environment.ts` as `ROCK_RING_COUNT` so a test can see the budget |
| A 2048² shadow map, re-rendered every frame | The room has one shadow-casting light, it never moves, and nothing in the scene ever moves. A per-frame pass was re-rasterising the same depth buffer 60 times a second. | `shadowMap.autoUpdate = false`, `needsUpdate` set once after construction |
| — | — | Readout now prints its own conditions (`standard · 1.5x · no msaa · shadow 1024`), because "28 fps" means different things at different settings |

**Correction to the plan as written:** it said a 4096 shadow map. It is 2048,
and the fix turned out to be better than the one proposed — rather than
dropping shadows on low-end devices, the map is rendered **once**, which takes
the per-frame cost to zero without changing a pixel. Shadows are what stop a
prop floating, so they survive at every tier.

### What is actually proven, and what is not

**Proven, by arithmetic that can be checked by hand** (and is, in
`device-profile.test.ts`):

- Fill cost on a 2.75× Android panel: **52.9% → 29.7%** of a 1× baseline. A 44%
  reduction in per-frame fill.
- The rock ring: **26 draw calls → 1**.
- Shadow fill: **4.19M pixels every frame → 1.05M once** (on the mobile tier).
  Everything after the first frame is zero.

**Not proven:** the frame rate. That needs the target handset and the Phase 0
readout, and it is the one number here that is arithmetic rather than
measurement. `?quality=low|standard|high` forces a tier so the three settings can
be compared on one phone rather than argued about.

**What is proved is that the costs were removed, not that the room now hits a
target.** Those are different claims and only the second one needs a device.

### A real bug this found

The tier rule originally also demanded a 900px short edge before calling a
device a desktop, so a 1280×800 laptop window — a very common resolution — was
demoted to the mobile profile and lost MSAA on a machine that could afford it.
A test caught it. Touch is the reliable signal; screen size is not.

---

## 2. Light and material — built

The widest gap between what was there and what the reference shows. The
reference bay is lit by a row of ceiling strip lights with ducting and cable
trays overhead, and it reads as warm pools with dark corners between. What was
there is one ambient light at a constant level, two directionals and three
point lamps — and the constant is the whole reason it looked flat: a light with
no falloff and no direction puts the same illumination on open floor and on the
inside of a corner, so nothing has a dark side and nothing has a shape.

**A correction to the plan as written.** It asked for PBR. The room already used
`MeshStandardMaterial`, which *is* three.js's physically-based material with a
metalness/roughness workflow — so "PBR" was never about the material class.
What was missing was everything the material needs in order to *behave*
physically: something to reflect. A metal with nothing to reflect is black, and
a rough surface got its ambient from a constant. Both of the real gaps were
occlusion and a ceiling, and both were closed by baking rather than by adding
lights.

### What was built

- **Baked ambient occlusion, as a vertex bake** (`src/lib/room-lighting.ts`).
  The floor and walls are subdivided and each vertex is darkened by how enclosed
  its position is: into a skirting, into a corner, under the conveyor. One
  multiply per fragment and nothing else. A screen-space AO pass would cost a
  depth pre-pass and a blur every frame for the same picture.
- **One image-based light** (`src/lib/room-env.ts`): a small painted equirect
  through `PMREMGenerator`, giving every PBR surface a directional, warm,
  occluded ambient. The flat ambient was cut to 0.1 to match — leaving both at
  full strength is a double count, and it flattens the room straight back to
  where this phase found it.
- **A ceiling worth looking at**: a ventilation duct with flanges, a cable
  tray, and five strip lights. From standing height you never see the middle of
  a ceiling — you see its far end — so what the ceiling contains has to be
  things with a *silhouette*.
- **The lamps hang over the lights.** The three point lights used to sit at
  arbitrary points, so the room had bright patches on the floor under nothing at
  all. Their positions are now read from the same list the fittings are built
  from.

### Performance: what it costs, honestly

| | |
|---|---|
| Fill rate | **unchanged** — no change to the framebuffer |
| Draw calls, ceiling | **+5** (16 as first written, instanced down to 5) |
| Triangles | **+2,000** — 864 on the floor, ~1,200 on the walls, both flat |
| Lights | **unchanged at 3** — five visible fittings, three of them lit |
| Per-fragment | **+1 env map sample** (standard/high), **+1 multiply** everywhere |
| Shadow pass | **unchanged** — still zero after the first frame |
| Startup | **+one PMREM prefilter** (~10 ms), skipped entirely on the low tier |

The one genuine per-frame cost is the environment sample, and it is tier-gated
off on `low`, where the flat ambient stays and the room looks flatter. That is
the honest trade: on the weakest devices, pixels beat reflections.

### Two real bugs this found

- **The corner term did nothing.** Occlusion was computed as a *minimum* over
  the axes, so a point 0.4 m from the back wall scored identically to a point
  0.4 m from both walls at once — corners rendered exactly as bright as the
  skirting beside them, and the room had no corners. Occlusion is a product
  over the axes. It now is.
- **A clamp was erasing the gradient.** Everything below 0.42 was pinned to
  0.42, so the corner, the skirting and the floor half a metre from a wall all
  rendered identically. The falloff now bottoms out at 0.55 against a wall and
  0.30 in a corner, and there is a test asserting the range is a gradient.

### Still unverified

Whether it *looks* better. The occlusion is arithmetic and the environment map
is a real PBR feature, and neither of those is the same as a human seeing a
room with a shape. That is `?view=corner` and `?view=ceiling` on a phone.

---

## 3. The equipment the board asks for and the room does not have

Image 3's top-down layout names fourteen locations. Nine are present. These
are missing, and all of them are **scenery** — rendered, walked past, never
tappable, never graded, which is the same rule that keeps a fire hose reel
out of a gas module's scoring:

- **Safe assembly point** — the board places it outside the mine, at the end of
  the primary route. It is currently absent, and `assembly-point` *is* in the
  marker vocabulary for FIRE, so its absence from the room is a real gap.
- **Refuge chamber** — also in the GAS marker vocabulary, also absent from the
  room.
- **Alternate route** — needs a second painted route and a second opening. Both
  are geometry; *which* route is safe is safety content and is not mine to
  author (see §7).
- **Control / training area** — the bench exists; the wall monitor and the
  safety whiteboard from image 2 do not.
- **Generator cage, gas cylinder** — visible in the reference, and `gas-cylinder`
  is a tracked AR target, so it is worth having in the room too.

Each one is one `SceneryItem` plus one builder in `prop-shapes.ts`, and the
existing tests then cover it for free. This is the cheapest phase in the plan
and the one that closes the largest gap against the board.

---

## 4. Where you are, and which way you are facing

In a 26 × 20 m room the trainee will get lost, and "I cannot find the exit" is
not a learning outcome, it is a defect.

- **Per-kind spawn framing.** Right now every step opens from one fixed point
  looking one fixed way. A `decide` step wants the arc in front of you; a
  `tapTarget` step wants the object in front of you. Framing the spawn from the
  step kind is a data change, not a render change.
- **Landmarks, not a map alone.** The bay map is good, but a map is a thing you
  read; a distinctive silhouette is a thing you navigate by. The tunnel mouth,
  the dust extractor and the conveyor run are already candidates.
- **Route paint** from the entry to the tunnel, so the safe direction is legible
  from the floor and not only from the map.
- **The exit sign never fades** — already the case, and worth keeping: "find the
  nearest exit" must not depend on standing close enough.

---

## 5. Controls

Present today: drag to look, tap floor to walk, tap object to answer, tap label
to walk to it, WASD, Q/E turn, a thumb pad and two turn buttons on touch, a
crosshair, the bay map, and narration. That is a sound base — the tap-to-walk
and click-a-label decisions were the right ones.

Gaps, in the order I would do them:

1. **One thumb zone instead of two.** The pad is bottom-left and the turn
   buttons bottom-right, so on a large phone a thumb has to stretch or the hand
   has to shift. Image 6's single bottom bar is the better shape for a phone
   held one-handed.
2. **A "back to start" control.** Cheapest possible fix for the trainee who has
   walked into a corner and cannot work out which way is which.
3. **Reached-object feedback.** A label goes to a line-through when answered;
   nothing confirms you have walked up to something. In a 26 m room, arriving is
   an event that should be acknowledged.
4. **Desktop pointer lock.** Drag-to-look is right for touch and wrong for a
   mouse. A first-person room on a desktop wants click-to-lock, and the current
   behaviour means the cursor keeps leaving the window.
5. **Gamepad support.** Left stick move, right stick look, `A` answer. Cheap,
   and it is how this gets demoed on a projector.
6. **Reduced motion.** Honour `prefers-reduced-motion`: no camera bob, no
   auto-turn, and the narration button becomes the only way to advance without
   moving the view.

Not planned, on purpose: crouch, lean, physics, inventory, a jump button. None
of them are assessed, and each is a control the trainee has to learn and a thing
that can go wrong on a mine handset.

---

## 6. The shell around the 3D — image 2's UI

Image 2 is a full application chrome, and KAVACH currently renders only the
middle of it: no left "Find and Learn" panel, no bottom description card, no
mode tabs.

- **The "Find and Learn" sidebar is the safe one.** It lists what is in the
  room, and the room's contents are exactly the inert `SCENERY` list — tap a
  name, walk there. Navigation aid, no content authored, no assessment touched.
  This one I can build without asking anyone.
- **The bottom description card needs content.** "What it is · where it is
  located · when to use" is safety copy, and it is R9's. The card can be built
  and left empty; the words are not mine to write.
- **Explore / Learn / Checklist / Assessment tabs are a product decision, not a
  rendering one.** A "checklist" mode turns a step into "find these four
  things", which changes what is being assessed and what counts as a critical
  miss. That is a spec change, and specs are not mine to change.

---

---

# Phases 3–6 — built

Four phases, one sitting, in the order they were written. 65 new tests, 381 in
total. What follows is what was actually done rather than what was proposed, and
where the two differ.

## 3. The missing equipment — built

Six pieces of scenery the design board names and the room did not have, plus the
control area's wall and a little density.

| Added | Where | Why there |
|---|---|---|
| `assembly-yard` | back right, at the end of the primary route | The board puts the assembly point at the end of the route, and `assembly-point` is in the FIRE marker vocabulary, so its absence from the room was a real gap |
| `refuge-alcove` | left wall, mid-depth | Also in the GAS vocabulary. Built into the side of the bay with a green frame, because a chamber you cannot walk up to is a picture |
| `generator-cage` | back wall, left of the tunnel | Visible in the reference, and it gives the back-left corner something to be |
| `gas-rack` | right, mid-depth | `gas-cylinder` is a tracked AR target, so the object the AR view shows should exist in the room too |
| `monitor-left`, `whiteboard-left` | left wall, over the bench | The control and training area had a bench and no wall |
| `chair-a`, `chair-b` | at the bench | A training bay with a bench and nothing to sit on reads as a storage room |

**Every one of them is scenery: rendered, walked past, never tappable, never
graded.** The naming is where that rule is easiest to break, so the two places a
reader would expect a gradable id are deliberately *not* it — the assembly point
is `assembly-yard` and the refuge chamber is `refuge-alcove`, because
`assembly-point` and `refuge-chamber` are real ids a step can be answered with.
A test asserts the four are never conflated, and it was written before the
scenery was, because that is the mistake this project already made once.

Two of the pieces were **moved** during the work rather than added and forgotten:
the generator cage started at (7.6, −6.4), which is where the painted primary
route wants to go, and the route test caught it. It is now in the back-left, and
the test that caught it is permanent.

## 4. Where you are, and which way you are facing — built

**Spawn framing** (`src/lib/spawn-framing.ts`). Every step used to open from one
fixed point looking one fixed way, so a `decide` step — a comparison of four
things side by side — and an `observe` step — one object against a wall — were
framed identically. One of those is always wrong, and the wrong one is
invisible: the room renders, the labels are there, and the trainee is looking at
a wall.

So the spawn is derived from the step:

- **decide / act** — the options are on an arc in front of the entry, so the
  trainee stands at the entry. The arc is the question.
- **observe** — the trainee stands 5.5 m back from the object, facing it, which
  is also the only way the *distractors* on the same step end up in frame. A
  distractor the trainee cannot see is not a distractor.

The geometry is pure and tested: the target is dead ahead from every position in
the room, inside the field of view, the camera is never inside a wall or a piece
of plant, and the whole thing is deterministic — a cold re-check has to be
comparable to the training it re-tests, and that extends to where the camera
started.

**Route paint** (`src/lib/floor-paint.ts`). Two routes, as data. The primary runs
from the entry to the tunnel; the alternate leaves the entry on a different line
and joins the same tunnel from the other side, and it is **dashed** — visually
secondary, never labelled as right or wrong, because which way a person should
take is safety content and this project does not author it. Every route is
asserted to stay inside the room, to keep a walkable clearance from the plant,
and to genuinely diverge from the other one rather than running alongside it.

**Landmarks** (`src/lib/landmarks.ts`). Nine nouns a trainee can navigate by,
derived from the scenery table rather than maintained beside it, so a piece of
equipment cannot be a landmark in the panel and invisible on the map. A landmark
name is a noun, and a test fails the build if one becomes a sentence: the panel
is the most likely place in this project for safety copy to appear by accident.

**The exit sign never fades** — still true, and still asserted behaviour.

## 5. Controls — built

1. **One thumb zone instead of two.** The pad and the turn buttons were in
   opposite bottom corners; on a large phone a thumb had to stretch or the hand
   had to shift, and shifting hands mid-task is how a trainee walks into the
   conveyor. There is now a single bottom bar: turn, walk, turn, start.
2. **Back to start.** One control, in the bar and on the gamepad. It restores
   the *step's own* spawn framing, not a fixed point, so an observe step is
   re-framed on the thing it is about.
3. **Arrival feedback.** A label gains a green ring inside 2.2 m. In a 26 m bay
   the difference between standing at the switchboard and near it was invisible,
   so a trainee who had walked to the right place had no confirmation and kept
   walking.
4. **Desktop pointer lock.** Click to look around; the cursor stops leaving the
   window mid-sweep. Escape releases it and the controls are released with it, so
   a lock left behind by an alt-tab cannot leave the view turning. While locked,
   the crosshair is the aim, which is what it already was.
5. **Gamepad.** Left stick walks, right stick looks, the answer button answers
   what the crosshair is on, and buttons are edge-detected — a held button is
   one press, because a step answered sixty times is a step whose score depends
   on frame rate. It exists because this is how the room gets demonstrated on a
   projector: a presenter holding a phone-shaped handset is a hostage to the
   touch layout.
6. **Reduced motion — partly already true, and now measured.** The room has no
   camera bob and no auto-turn, so the guidance for motion sensitivity is
   mostly satisfied by the design rather than by code. What *is* app-initiated
   is the crosshair's size pop when the highlight changes, and that is now gated
   on `prefers-reduced-motion`. Stated plainly because it is a smaller win than
   the plan implied, not because it was skipped.

**Two silent gamepad bugs the tests caught before a pad was ever plugged in:** a
diagonal stick push is √2 long, so walking at an angle moved 41% further per
frame and the room appeared to speed up; and a resting stick reporting 0.04
walked the trainee into the conveyor while they were trying to look at it. Both
are deadzone and clamp arithmetic, and both are now in `lib/input-prefs.ts` with
a test for each, plus a `NaN` guard for a pad that reconnects mid-session.

## 6. The shell around the 3D — built, minus the tabs

**Find and Learn** is built, and it is the safe one: it lists what is in the
room — exactly the inert scenery table — nearest first, and tapping a name walks
you there. Navigation aid, no content authored, no assessment touched.

**The description card** is built and mostly empty, which is the honest state of
it. "Where it is" is filled in, because it is read off the coordinates and
therefore cannot disagree with the room. "What it is" and "When to use it" say
*pending safety review*, because those are the R9 packet's inputs and writing
them is the one thing this project will not do on its own.

**The mode tabs are not built.** Explore / Learn / Checklist / Assessment is a
product decision, not a rendering one: a "checklist" mode turns a step into "find
these four things", which changes what is being assessed and what counts as a
critical miss. That is a spec change, and specs are not mine to change.

## Still unverified

Everything above is arithmetic, geometry and tests. **No human has seen the room
with any of it in.** The `?view=` presets are how to check, and there are now
more things worth photographing than there were: `?view=corner` for the refuge
alcove and the new wall kit, `?view=ceiling` for the lit fittings, `?view=entry`
for the spawn framing and the bottom bar, and the panel open over each of them.

---

## 7. What I will not do without a decision

- **Write safety text.** Object descriptions, route instruction, assembly-point
  procedure. The R9 packet is generated and waiting; these are its inputs.
- **Teach which route to take.** Painting a second route on the floor is
  geometry. Making it a *correct* route is safety content.
- **Change what a step assesses.** No new step kinds, no "checklist" scoring,
  no change to the marker vocabulary.
- **Touch `runner.ts`, `scoring.ts` or `gate.ts`.** The gate is the product.
  Nothing in a rendering plan needs to move it.

---

## 8. Sequence, and what each phase is worth

| # | Phase | Depends on | State | Value if we stop after it |
|---|---|---|---|---|
| 0 | See it: presets + on-screen readout | — | **built** | Everything else becomes reviewable |
| 1 | Performance floor | 0 | **built** | The costs are gone; the frame rate still needs a phone |
| 2 | Light and material | 1 | **built** | It has occlusion, reflections and a ceiling |
| 3 | The missing equipment | 1 | **built** | The board is matched |
| 4 | Spawn framing and landmarks | 1 | **built** | Nobody opens a step looking at a wall |
| 5 | Controls | 0 | **built** | A thumb can drive it one-handed |
| 6 | Sidebar + description card | 0 + 3 | **built** | The chrome matches image 2, minus the tabs |
| 6b | Mode tabs | — | **not built** | A spec decision, not a rendering one |
| — | Two connected bays | R9 answer on exits | **not built** | See §9.5 — it changes a graded step |

**3 and 5 are independent of each other and of 1–2**, so if the reviewer is
short on time those are the two to run in parallel.

The honest summary: phases 0–3 are where the visual gap is, phase 1 is the one
that decides whether any of it is usable, and phase 0 is the only one that makes
the rest verifiable instead of merely plausible.

---

## 9. Open questions

1. ~~**Which handset is the target?**~~ — answered: modern mid-range.
2. **Do you want the reference room's density or a cleaner one?** Image 2 is
   dense — ducting, trays, monitor, whiteboard, chairs. Density reads as real
   and costs draw calls and clarity on a small screen. My recommendation:
   match the density, cut it back only where it costs legibility. Now cheaper
   than planned, given the mid-range target.
3. ~~**Is the bay one room, or two connected spaces?**~~ — answered: two. Now
   sequenced as its own phase, before phase 4. **Phase 4 was built for the
   single bay anyway**, because question 5 below is unanswered and a second
   opening changes a graded step. The framing functions read the room's data
   rather than hardcoding it, so this is a delay rather than a redo.
4. **Who reviews the object descriptions?** The sidebar can be built without
   them, but it is a poor panel with empty rows. If R9 is the bottleneck, I would
   rather build the panel last and have it fill in.
5. **Does the second bay get its own exit?** Two bays and two ways out is the
   arrangement image 3 implies. It also changes what "the nearest emergency
   exit" means, which is a graded step — so it is a spec question, not a
   rendering one, and it should go to R9 with the packet. **This is the one
   open item that blocks planned work**, and it is why the two-bay room is not
   built: a second opening on the far wall changes the collision clamp, the bay
   map, the spawn framing and the meaning of a step that is already graded.
   Phase 4 was built for the single bay deliberately, and its framing functions
   take the room's own data, so a second bay is additive rather than a rewrite —
   but it must not be started before this question is answered.
