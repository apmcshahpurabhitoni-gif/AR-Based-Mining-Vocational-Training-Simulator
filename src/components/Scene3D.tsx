/**
 * A 3D room you can walk through, rendered in the browser.
 *
 * This is not AR and is not trying to pretend to be. There is no WebXR, no
 * camera, no world tracking. It is an ordinary first-person 3D space, and that
 * is the point: it runs on every browser including iOS Safari, needs no
 * permissions, works with the network down, and costs one lazily-loaded
 * dependency instead of a headset and a 3D asset pipeline.
 *
 * The assessment underneath is unchanged. Tapping an object dispatches the
 * same `tapTarget` action the 2D scene and the card list already dispatch, so
 * `runner.ts`, `scoring.ts` and `gate.ts` cannot tell which surface the
 * trainee used. The only new measurement this surface enables is *where they
 * were standing* when they answered, which is not yet scored.
 *
 * Controls are deliberately pointer-lock-free. Pointer lock is unreliable in
 * embedded panes and asks for a permission that a trainee on a shared device
 * should not have to grant. Drag-to-look, a thumb pad and explicit turn
 * controls all work everywhere.
 *
 * Text is DOM, never canvas — docs/05 §5. Devanagari does not shape correctly
 * in a WebGL texture and the project is bilingual by contract, so every label
 * here is an absolutely-positioned HTML element projected from world space
 * each frame.
 */

import { useEffect, useRef } from "react";
import clsx from "clsx";
import type { RoomObject } from "../lib/room";
import {
  buildProp as buildPropShared,
  buildScenery,
  kindOf,
  radiusOf,
  type PropKind,
} from "../lib/ar/prop-shapes";
import { ROOM, SCENERY, pushOutOfSolids, scenerySolids } from "../lib/environment";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PointLight,
  Raycaster,
  RepeatWrapping,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

/**
 * Room interior, in metres.
 *
 * Sourced from `lib/environment`, not defined here. The room is data — see the
 * header of that file for why.
 *
 * It has been through three sizes. 22 m read as a hall: four objects you crossed
 * a warehouse to reach, with walls too far away to give the space any shape. 18 m
 * fixed the trek but made it a box. 26 x 20 is deliberately *wide and low* — the
 * equipment reads across the view rather than being stacked up a corridor, and
 * the room has a horizon, which is what "wide" actually needs.
 */
const ROOM_W = ROOM.width;
const ROOM_D = ROOM.depth;
const WALL_H = ROOM.height;
/** Eye height. A person, not a drone. */
const EYE_H = 1.65;
const WALK_SPEED = 4.2;
/**
 * Radians per pixel of drag.
 *
 * 0.0032 needed a 2,000 px drag to turn around, which on a mouse means several
 * sweeps and on a phone means several swipes — you could not check what was
 * behind you, which is exactly what "find the exit" asks a trainee to do.
 */
const TURN_SPEED = 0.0065;
/** Keyboard and button turning are a fallback for the drag, so gentler. */
const KEY_TURN = 2.2;
/** How far up and down you can look. The signs are above eye level. */
const PITCH_LIMIT = 1.05;
/**
 * Movement below this (from where the pointer went *down*, not total path) is a
 * tap, not a look.
 *
 * The old test summed every delta along the drag and cut off at 8 px, which
 * swallowed honest taps: a fingertip rolls 15–30 px on a real press, and the
 * accumulated path is larger still. Tapping an object is how a step is answered,
 * so a threshold that eats taps makes the whole exercise feel broken.
 */
const TAP_SLOP_MOUSE = 6;
const TAP_SLOP_TOUCH = 16;
/** Player radius, for pushback against props. */
const BODY_R = 0.45;

/**
 * Walk-to-a-point. The trainee taps the floor and the camera glides there.
 *
 * Holding a key or a thumb-pad to cross the room is friction that buys nothing:
 * the thing being assessed is *which* object you go to and what you do when you
 * reach it, not your ability to steer. Tap-to-walk also removes the worst
 * conflict in the old scheme, where the same gesture had to mean both "look"
 * and "walk".
 */
const WALK_TARGET_SPEED = 3.4;
const WALK_TARGET_STOP = 0.28;
/**
 * Vertical field of view.
 *
 * 70° was too narrow for the comparison arc: the outer two options of a
 * four-way decide step fell outside it at the distance they stand, so a trainee
 * had to turn to see the choice they were being asked to make. 76° holds the
 * whole row from the entry point without the wide-angle distortion you get past
 * about 80.
 */
const FOV_DEG = 78;
/**
 * How far an object's label stays legible, in metres.
 *
 * The room is 26 m across and carries a dozen objects. Naming all of them at
 * every distance turns the view into a wall of overlapping type: the labels
 * stop describing the room and start hiding it. So a label fades in as the
 * trainee approaches, which has the useful side effect that walking somewhere
 * is how you learn what is there. Past `LABEL_FAR` the bay map is what tells
 * you a thing exists at all.
 *
 * The exit is exempt. "Find the nearest exit" must never depend on the trainee
 * happening to stand close enough for the sign to name itself.
 */
const LABEL_NEAR = 13;
const LABEL_FAR = 22;
/**
 * How close to a wall the walker can get.
 *
 * One number rather than the three that used to disagree: the tap-to-walk
 * clamp and the per-frame clamp were different, so a tap near a wall aimed the
 * trainee at a point the walk loop then refused to reach and the walk gave up
 * on as stalled.
 */
const WALL_MARGIN = 0.7;
/** Bay map size in CSS pixels. Sized like the reference board's, top-right. */
const MAP_W = 156;
const MAP_H = 124;

export type { RoomObject as SceneObject } from "../lib/room";

/**
 * Candidate positions for unplaced objects, in the order they are offered.
 * Everything lives against a wall, because that is where plant equipment
 * actually lives, and because a scatter across the middle of the floor reads
 * as procedural noise rather than a room. Deterministic: the same step always
 * produces the same room, so a re-check is comparable to its training.
 */
const SLOTS: ReadonlyArray<readonly [number, number, number]> = [
  // [x, z, facing-radians] in room coordinates, hugging the 26 x 20 shell.
  // Left wall, facing right.
  [-ROOM.width / 2 + 0.7, -7.6, Math.PI * 0.5],
  [-ROOM.width / 2 + 0.7, -2.8, Math.PI * 0.5],
  [-ROOM.width / 2 + 0.7, 1.8, Math.PI * 0.5],
  [-ROOM.width / 2 + 0.7, 7.0, Math.PI * 0.5],
  // Right wall, facing left. The conveyor runs down this side, so the slots
  // avoid its length rather than overlapping it.
  [ROOM.width / 2 - 0.7, -8.2, -Math.PI * 0.5],
  [ROOM.width / 2 - 0.7, 3.4, -Math.PI * 0.5],
  [ROOM.width / 2 - 0.7, 7.8, -Math.PI * 0.5],
  // Back wall, facing the trainee.
  [-9.8, -ROOM.depth / 2 + 0.7, 0],
  [-1.4, -ROOM.depth / 2 + 0.7, 0],
  [2.6, -ROOM.depth / 2 + 0.7, 0],
  // Front wall, behind the trainee at spawn.
  [-9.8, ROOM.depth / 2 - 0.7, Math.PI],
  [-3.2, ROOM.depth / 2 - 0.7, Math.PI],
  [9.8, ROOM.depth / 2 - 0.7, Math.PI],
];

/**
 * Where the trainee enters the room, and therefore what they are looking at
 * when a step opens.
 */
const SPAWN_Z = ROOM_D / 2 - 1.2;

/**
 * Interactables are laid out on a shallow arc in front of the entry, not
 * scattered against the walls.
 *
 * A `decide` step is a comparison — four options that only mean anything
 * beside each other. An `act` step is a sequence — an order that only means
 * anything left to right. Wall slots would put a fire hose reel behind the
 * trainee and a gas valve in the corner, which is fine for finding equipment
 * and useless for choosing between things. A bow keeps the end options angled
 * inward so the whole set is legible in one look from where you stand.
 *
 * Deterministic: the same step always produces the same arc, so a cold
 * re-check is comparable to the training it re-tests.
 */
function arcSlot(index: number, count: number): { x: number; z: number; ry: number } {
  const t = count <= 1 ? 0.5 : index / (count - 1);
  //
  // The width is not a free choice. Everything on the arc has to fit inside the
  // camera's horizontal field of view from the entry point, or the outermost
  // options are off-screen until the trainee turns — and on a decide step the
  // whole point is seeing the alternatives side by side. At 3.8 m half-width the
  // end objects sit ~37° off centre including their own radius, which the 78°
  // frustum holds. Widening past that starts pushing them out of frame.
  const half = 3.8;
  const x = (t - 0.5) * 2 * half;
  // Bow the edges *away*, so the row curves around the viewer rather than
  // bunching toward them and pushing the ends out of frame.
  const z = 3.0 - Math.abs(t - 0.5) * 1.0;
  return { x, z, ry: Math.atan2(-x, SPAWN_Z - z) };
}

/** Deterministic value noise, so the room looks identical on every load. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A tiling surface texture, drawn into a canvas at load time.
 *
 * docs/04: "nothing downloaded, nothing scraped, nothing licensed from a
 * vendor." So the room has no texture files — the grain, the speckle and the
 * panel seams are generated here. This is what stops every surface being a flat
 * untextured plane, which is most of why the room read as a grey box rather
 * than a place.
 */
function surfaceTexture(opts: {
  base: string;
  speckle: string;
  speckleCount: number;
  speckleAlpha: number;
  joint: string;
  jointEvery: number;
  repeat: number;
}): CanvasTexture {
  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  // A 2D context is effectively always available; if it is not, the surface
  // falls back to flat colour rather than failing to render at all.
  const g = canvas.getContext("2d");

  if (g) {
    g.fillStyle = opts.base;
    g.fillRect(0, 0, S, S);

    // Grain. Dense, low-alpha dots — reads as aggregate in concrete and as
    // stipple on painted steel.
    g.fillStyle = opts.speckle;
    g.globalAlpha = opts.speckleAlpha;
    for (let i = 0; i < opts.speckleCount; i++) {
      const x = noise(i * 1.7) * S;
      const y = noise(i * 3.1 + 5) * S;
      const r = 0.5 + noise(i * 7.3) * 1.8;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // Expansion joints / panel seams. Without these a large plane has no scale
    // cue and reads as infinitely far away however close it is.
    g.strokeStyle = opts.joint;
    g.lineWidth = 2;
    for (let p = 0; p <= S; p += opts.jointEvery) {
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, S);
      g.moveTo(0, p);
      g.lineTo(S, p);
      g.stroke();
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(opts.repeat, opts.repeat);
  return tex;
}

/** A hold-to-turn button. Present so a phone never needs two thumbs at once. */
function TurnButton({
  dir,
  turnRef,
}: {
  dir: -1 | 1;
  turnRef: React.RefObject<number>;
}) {
  return (
    <button
      type="button"
      aria-label={dir === -1 ? "Turn left" : "Turn right"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        turnRef.current = dir;
      }}
      onPointerUp={() => {
        turnRef.current = 0;
      }}
      onPointerCancel={() => {
        turnRef.current = 0;
      }}
      className="h-14 w-14 touch-none rounded-full border border-fog-700/40 bg-ink-900/60 font-mono text-lg text-fog-300 select-none active:bg-ink-800"
    >
      {dir === -1 ? "‹" : "›"}
    </button>
  );
}

export function Scene3D({
  objects,
  onSelect,
  selectedId,
  onFallback,
}: {
  objects: RoomObject[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  onFallback: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const padRef = useRef({ x: 0, y: 0, active: false });
  const turnRef = useRef(0);
  // Label nodes, positioned imperatively by the render loop. Keeping them in a
  // ref means a 60 fps room triggers zero React re-renders.
  const labelNodes = useRef<Array<HTMLElement | null>>([]);
  /**
   * Where each object actually stands, in room coordinates.
   *
   * The label is a button, so it needs the position of the thing it names — and
   * that position is decided inside the scene-construction effect, by slots the
   * label markup cannot see. Publishing it here is what lets "tap a name to be
   * taken there" work without hoisting the whole layout problem into React.
   */
  const placesRef = useRef<Array<{ x: number; z: number }>>([]);
  /** A walk the trainee asked for from a label. Consumed by the walk loop. */
  const wantWalk = useRef<{ x: number; z: number } | null>(null);
  const crosshairDot = useRef<HTMLDivElement | null>(null);
  const crosshairRing = useRef<HTMLDivElement | null>(null);
  /** The bay map canvas. Drawn from the same world positions the room is. */
  const miniRef = useRef<HTMLCanvasElement | null>(null);

  // Selection is read through a ref, not a dependency. It used to be a
  // dependency, which meant every tap destroyed and rebuilt the whole scene —
  // the trainee was teleported back to the door the moment they answered, and
  // "walk to the thing" became "walk to the thing, then be reset".
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    } catch {
      // No WebGL, or the context is refused. The 2D scene is a complete
      // fallback, so this is never fatal.
      fallbackRef.current();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Shadows and tone mapping. Between them these do more for the room than
    // any amount of extra geometry: contact shadows are what stop a prop
    // floating, and ACES keeps the sodium lamps from clipping to white.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    // A context can also be lost after it was already running — GPU reset, a
    // backgrounded tab, low-memory eviction. docs/05 §8 requires this to land
    // in a complete mode with the session intact, not a frozen canvas.
    const onContextLost = (e: Event) => {
      e.preventDefault();
      fallbackRef.current();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    const scene = new Scene();
    scene.background = new Color("#0a0d12");
    // Depth cue. Without it a grey room in dim light reads as a flat backdrop.
    scene.fog = new Fog("#0a0d12", 18, 46);

    const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    camera.position.set(0, EYE_H, SPAWN_Z);

    // -- Light ---------------------------------------------------------------
    //
    // Ambient was 0.75 here, which is why everything looked like flat plastic:
    // fill light that high means no surface has a dark side, and a shape with no
    // dark side has no shape. It is 0.34 now, so the directional light actually
    // models the geometry, and the sodium lamps read as light rather than as a
    // general brightening.
    scene.add(new AmbientLight("#5c6b80", 0.34));

    const key = new DirectionalLight("#ffe0b0", 1.45);
    key.position.set(5, 11, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -ROOM_W / 2;
    key.shadow.camera.right = ROOM_W / 2;
    key.shadow.camera.top = ROOM_D / 2;
    key.shadow.camera.bottom = -ROOM_D / 2;
    // A bias stops the floor shadowing itself into stripes across the whole
    // room, which is the classic way this effect goes wrong.
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    // A cool bounce, so a sign below eye level is not a silhouette.
    const fill = new DirectionalLight("#8fa4bd", 0.26);
    fill.position.set(-7, 3, -6);
    scene.add(fill);

    // Sodium-ish pools, the way a mine workshop is actually lit.
    const lamps: PointLight[] = [];
    for (const [x, z] of [
      [-5, -4],
      [5, 4],
      [0, 5],
    ] as const) {
      const lamp = new PointLight("#ffb457", 30, 20, 2);
      lamp.position.set(x, WALL_H - 0.7, z);
      scene.add(lamp);
      lamps.push(lamp);
    }

    const world = new Group();
    scene.add(world);

    /** Canvas textures must be released by hand; the scene traversal below
     *  disposes geometry and materials, but it never sees a texture map. */
    const textures: CanvasTexture[] = [];
    /**
     * Geometry built during this effect, released on teardown.
     *
     * Declared up here rather than beside the props because the room, the rock
     * band and the scenery are all built before them, and all three allocate.
     */
    const disposables: BufferGeometry[] = [];
    const keep = (g: BufferGeometry) => {
      disposables.push(g);
      return g;
    };

    // -- Room ----------------------------------------------------------------
    //
    // Every surface here is textured from a canvas drawn at load time. The old
    // room was six flat-coloured planes, which is why it read as a grey box: no
    // grain, no seams, and therefore no sense of scale.
    const floorTex = surfaceTexture({
      base: "#3a3a38",
      speckle: "#5f5f5a",
      speckleCount: 5200,
      speckleAlpha: 0.5,
      joint: "#262624",
      jointEvery: 128,
      repeat: 7,
    });
    // Rock, not painted steel. The reference this room is built from is an
    // underground mine bay, and the single change that does most of that work is
    // the wall material: coarse, warm, uneven in colour, with no panel seams.
    const wallTex = surfaceTexture({
      base: "#4a4038",
      speckle: "#6d6055",
      speckleCount: 4200,
      speckleAlpha: 0.55,
      joint: "#3a322b",
      jointEvery: 64,
      repeat: 5,
    });
    const roofTex = surfaceTexture({
      base: "#2e2a26",
      speckle: "#463f39",
      speckleCount: 1800,
      speckleAlpha: 0.4,
      joint: "#241f1c",
      jointEvery: 512,
      repeat: 3,
    });
    //
    // Tiling is set per surface, because one `repeat` number is correct for
    // exactly one plane shape. Both the floor (26 x 20 m) and the walls
    // (26 x 4.6 m) started at a uniform repeat, which stretched the wall grain
    // about six-to-one vertically — the fastest way to make a texture read as
    // wallpaper. These numbers aim for roughly three-metre tiles on each.
    wallTex.repeat.set(9, 1.6);
    roofTex.repeat.set(9, 7);
    textures.push(floorTex, wallTex, roofTex);

    const floorMat = new MeshStandardMaterial({
      map: floorTex,
      color: "#ffffff",
      roughness: 0.88,
      metalness: 0.05,
    });
    const wallMat = new MeshStandardMaterial({
      map: wallTex,
      color: "#ffffff",
      roughness: 0.92,
      side: DoubleSide,
    });

    const floor = new Mesh(new PlaneGeometry(ROOM_W, ROOM_D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    world.add(floor);

    const ceiling = new Mesh(
      new PlaneGeometry(ROOM_W, ROOM_D),
      new MeshStandardMaterial({ map: roofTex, roughness: 0.98, side: DoubleSide }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_H;
    world.add(ceiling);

    for (const [x, z, rotY] of [
      [0, -ROOM_D / 2, 0],
      [0, ROOM_D / 2, Math.PI],
      [-ROOM_W / 2, 0, Math.PI / 2],
      [ROOM_W / 2, 0, -Math.PI / 2],
    ] as const) {
      const wall = new Mesh(
        new PlaneGeometry(x === 0 ? ROOM_W : ROOM_D, WALL_H),
        wallMat,
      );
      wall.position.set(x, WALL_H / 2, z);
      wall.rotation.y = rotY;
      wall.receiveShadow = true;
      world.add(wall);
    }

    // -- Structure -----------------------------------------------------------
    //
    // Not curriculum. This is what makes the space legible as a workshop rather
    // than a box: a skirting line at floor level, roof beams that give the
    // ceiling a height, cable trays and a pipe run along one wall, and a painted
    // walkway that reads as "the safe route". None of it is tappable and none of
    // it carries a safety verdict.
    const steelMat = new MeshStandardMaterial({
      color: "#565f6b",
      roughness: 0.55,
      metalness: 0.45,
    });
    const darkMat = new MeshStandardMaterial({ color: "#23272d", roughness: 0.95 });

    // Skirting: a dark band where wall meets floor, which is what visually
    // locks the two together instead of leaving them as two intersecting planes.
    const skirtingGeo = new BoxGeometry(ROOM_W, 0.22, 0.1);
    for (const [x, z, ry] of [
      [0, -ROOM_D / 2 + 0.05, 0],
      [-ROOM_W / 2 + 0.05, 0, Math.PI / 2],
      [ROOM_W / 2 - 0.05, 0, Math.PI / 2],
    ] as const) {
      const skirt = new Mesh(skirtingGeo, darkMat);
      skirt.position.set(x, 0.11, z);
      skirt.rotation.y = ry;
      world.add(skirt);
    }

    // Roof beams. Spaced across the *wide* axis, which is what gives the ceiling
    // a sense of span — the same beams on the short axis read as a corridor.
    const beamGeo = keep(new BoxGeometry(0.26, 0.34, ROOM_D));
    for (let x = -ROOM_W / 2 + 3; x <= ROOM_W / 2 - 3; x += 5) {
      const beam = new Mesh(beamGeo, steelMat);
      beam.position.set(x, WALL_H - 0.22, 0);
      beam.castShadow = true;
      world.add(beam);
    }

    // -- Rock ----------------------------------------------------------------
    // What makes this a mine rather than a warehouse.
    //
    // A ring of broken rock along the wall footings, one shared icosahedron and
    // one shared material so the whole band is a couple of draw calls. Placement
    // is a deterministic walk along a sine, so the room is the same on every load
    // — a cold re-check has to be comparable to the training that preceded it,
    // and that extends to the scenery.
    const rockGeo = keep(new IcosahedronGeometry(0.8, 0));
    const rockMat = new MeshStandardMaterial({ color: "#5f574c", roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const along = i / 25;
      const side = i % 2 === 0 ? -1 : 1;
      const x = (along * 2 - 1) * (ROOM_W / 2 - 1.1);
      const z = side * (ROOM_D / 2 - 0.9) + Math.sin(i * 2.3) * 0.5;
      const rock = new Mesh(rockGeo, rockMat);
      rock.position.set(x, 0.16 + Math.abs(Math.sin(i * 1.7)) * 0.22, z);
      rock.rotation.set(Math.sin(i * 0.9) * 0.6, i * 1.3, Math.cos(i * 1.1) * 0.4);
      rock.scale.set(0.7 + Math.abs(Math.sin(i * 0.7)) * 0.9, 0.45, 0.6 + Math.abs(Math.cos(i)) * 0.7);
      rock.castShadow = true;
      rock.receiveShadow = true;
      world.add(rock);
    }

    // A tunnel mouth in the back wall. The room needs somewhere to lead, and
    // "find the nearest exit" is meaningless in a sealed box.
    const tunnelMat = new MeshStandardMaterial({ color: "#0b0a09", roughness: 1 });
    const tunnel = new Mesh(keep(new PlaneGeometry(2.6, 2.5)), tunnelMat);
    tunnel.position.set(6.4, 1.25, -ROOM_D / 2 + 0.06);
    world.add(tunnel);
    const frameMat = new MeshStandardMaterial({ color: "#8a8f96", roughness: 0.6, metalness: 0.4 });
    for (const [x, y, w, h] of [
      [6.4, 2.62, 3.0, 0.16],
      [5.0, 1.25, 0.16, 2.5],
      [7.8, 1.25, 0.16, 2.5],
    ] as const) {
      const part = new Mesh(keep(new BoxGeometry(w, h, 0.2)), frameMat);
      part.position.set(x, y, -ROOM_D / 2 + 0.12);
      part.castShadow = true;
      world.add(part);
    }

    // Painted walkway, running from the entry to the tunnel mouth. It reads as
    // "the safe route" and it is the only thing in the room with a direction,
    // which at this size is what a trainee actually needs to orient by.
    const walkwayMat = new MeshStandardMaterial({
      color: "#8a7326",
      roughness: 0.9,
      transparent: true,
      opacity: 0.7,
    });
    for (const offset of [-1.3, 1.3] as const) {
      const stripe = new Mesh(keep(new PlaneGeometry(0.16, ROOM_D - 2.4)), walkwayMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(6.4 + offset, 0.012, 0.6);
      world.add(stripe);
    }

    // -- Scenery -------------------------------------------------------------
    //
    // The equipment of the bay, read from `lib/environment`.
    //
    // **None of this is tappable, and none of it is graded.** That is the whole
    // reason the room can be this full. Scenery is context; the answer surface is
    // the marker vocabulary, and the two must not be confused — an earlier version
    // of this room was furnished from ids that existed in no manifest and were
    // nonetheless wired into grading, so tapping a fire hose reel in a gas module
    // recorded a gas-safety failure. See the header of `lib/environment.ts`.
    //
    // The meshes are deliberately never pushed into `pickable`, so the raycaster
    // cannot return one and the crosshair cannot light up on it.
    for (const item of SCENERY) {
      const group = buildScenery(item.kind, keep);
      group.position.set(item.x, item.y ?? 0, item.z);
      group.rotation.y = item.ry;
      if (item.scale) group.scale.set(item.scale[0], item.scale[1], item.scale[2]);
      world.add(group);
    }
    // Collision comes from the data, already turned into circles — including the
    // chain of circles that keeps the 17 m conveyor solid along its whole length
    // rather than only where its centre is. See `scenerySolids`.
    const scenerySolid = scenerySolids();

    // -- Placement -----------------------------------------------------------
    // Props the manifest placed keep their authored position. Everything else
    // takes the next free wall slot, so two objects can never end up inside
    // each other, or inside the conveyor, or stacked in the middle of the floor.
    //
    // These are also the collision set: pillars, crates and posts are things
    // you cannot walk through. Without them the trainee slides through solid
    // plant, which makes the room feel like a texture rather than a place.
    //
    // Seeded from the scenery, so graded props cannot spawn inside the conveyor
    // or a boulder. This used to be a hand-copied list of the pillar and crate
    // positions, which is a duplicate that silently drifts the moment either the
    // layout or the props move; now there is one source for where things are.
    const taken: Array<{ x: number; z: number; r: number }> = scenerySolid.map((s) => ({ ...s }));
    // Scenery blocks the walker too, not just the graded props added below.
    const solid: Array<{ x: number; z: number; r: number }> = scenerySolid.map((s) => ({ ...s }));
    let slotCursor = 0;

    /**
     * Push a point out of the plant, then back inside the walls.
     *
     * The geometry is in `lib/environment` so a test can check it; the wall
     * clamp belongs here, because how close to a wall a thing may stand is a
     * property of the walker rather than of the room's contents.
     */
    const pushOut = (x: number, z: number, radius: number) => {
      const moved = pushOutOfSolids(x, z, radius, solid);
      const halfW = ROOM_W / 2 - WALL_MARGIN;
      const halfD = ROOM_D / 2 - WALL_MARGIN;
      return {
        x: Math.max(-halfW, Math.min(halfW, moved.x)),
        z: Math.max(-halfD, Math.min(halfD, moved.z)),
      };
    };

    /** Next wall slot with clearance, or a wall-edge fallback if all are full. */
    const claimSlot = (radius: number) => {
      for (let n = 0; n < SLOTS.length; n++) {
        const slot = SLOTS[(slotCursor + n) % SLOTS.length];
        slotCursor++;
        if (!slot) continue;
        const clash = taken.some(
          (p) => Math.hypot(p.x - slot[0], p.z - slot[1]) < p.r + radius + 0.4,
        );
        if (clash) continue;
        taken.push({ x: slot[0], z: slot[1], r: radius });
        return { x: slot[0], z: slot[1], ry: slot[2] };
      }
      // More objects than slots. Tuck the overflow along a wall rather than
      // dropping it on top of something that is already there.
      const side = slotCursor % 2 === 0 ? -1 : 1;
      const z = ((slotCursor * 3.1) % (ROOM_D - 5)) - (ROOM_D - 5) / 2;
      const x = side * (ROOM_W / 2 - 1.3);
      taken.push({ x, z, r: radius });
      return { x, z, ry: side === -1 ? Math.PI * 0.5 : -Math.PI * 0.5 };
    };

    // -- Targets -------------------------------------------------------------
    const hit = new Raycaster();
    const pickable: Mesh[] = [];
    // Mesh -> manifest id. A side table rather than `userData`, which would
    // need a cast on every read and would fight the library's own typing.
    const idOf = new Map<Mesh, string>();
    // Per-object materials, so one prop can light up without lighting its
    // neighbours.
    const bodies = new Map<string, MeshStandardMaterial[]>();
    // Each object's resting emissive, so the exit sign keeps its green glow
    // when it is neither aimed at nor already answered.
    const resting = new Map<string, string>();
    const anchors: Array<{ at: Vector3 }> = [];
    /** Where each object stands, for the label buttons. */
    const places: Array<{ x: number; z: number }> = [];

    /**
     * The shapes come from `lib/ar/prop-shapes`, which the camera AR view also
     * imports. One definition, so the object a trainee learns in the room is
     * the object they see over the camera.
     */
    const buildProp = (kind: PropKind, bodyMat: MeshStandardMaterial) =>
      buildPropShared(kind, bodyMat, keep);

    for (const [index, object] of objects.entries()) {
      const kind = kindOf(object.id);
      const radius = radiusOf(kind);
      const interactive = object.role === "interactable";

      let px: number;
      let pz: number;
      let ry: number;
      if (interactive) {
        const slot = arcSlot(index, objects.length);
        px = slot.x;
        pz = slot.z;
        ry = slot.ry;
        taken.push({ x: px, z: pz, r: radius });
      } else if (object.authored) {
        const placed = pushOut(
          (object.x - 0.5) * (ROOM_W - 3),
          (0.5 - object.y) * (ROOM_D - 3),
          radius,
        );
        px = placed.x;
        pz = placed.z;
        // Face the middle of the room, so an authored sign is never edge-on.
        ry = Math.atan2(-px, -pz);
        taken.push({ x: px, z: pz, r: radius });
      } else {
        const slot = claimSlot(radius);
        px = slot.x;
        pz = slot.z;
        ry = slot.ry;
      }

      const bodyMat = new MeshStandardMaterial({
        // An interactable is the answer surface, so it is tinted to read as
        // selectable at a glance. Everything else is painted steel.
        color: object.isExit
          ? "#22c55e"
          : interactive
            ? object.done
              ? "#3f4a44"
              : "#b98a3c"
            : "#9aa7b8",
        // The exit sign is lit; the rest are painted steel. The eye should find
        // the exit the way it does in a real smoke-filled room.
        emissive: object.isExit ? "#0b3d1c" : interactive ? (object.done ? "#0a140d" : "#3a2a06") : "#000000",
        roughness: 0.6,
      });
      bodies.set(object.id, [bodyMat]);
      resting.set(object.id, object.isExit ? "#0b3d1c" : interactive ? (object.done ? "#0a140d" : "#3a2a06") : "#000000");

      const { group, meshes, anchorY } = buildProp(kind, bodyMat);
      group.position.set(px, 0, pz);
      group.rotation.y = ry;
      world.add(group);
      solid.push({ x: px, z: pz, r: radius });

      for (const mesh of meshes) {
        pickable.push(mesh);
        idOf.set(mesh, object.id);
      }

      if (interactive) {
        // A pad under every option. The arc is the lesson — you are meant to
        // see all of them at once — so each one gets a footprint that says
        // "this is a thing you select", which a wall-mounted prop does not.
        const pad = new Mesh(
          keep(new PlaneGeometry(2.0, 2.0)),
          new MeshBasicMaterial({
            color: object.done ? "#22c55e" : "#fbbf24",
            transparent: true,
            opacity: object.done ? 0.18 : 0.12,
          }),
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(0, 0.02, 0);
        group.add(pad);
      }

      if (object.isExit) {
        const glow = new PointLight("#22c55e", 11, 8);
        glow.position.set(0, anchorY - 0.3, 0.5);
        group.add(glow);

        // A pool of light on the floor. This is what makes it findable at all.
        const pool = new Mesh(
          keep(new PlaneGeometry(3.2, 3.2)),
          new MeshBasicMaterial({ color: "#22c55e", transparent: true, opacity: 0.16 }),
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(0, 0.02, 0.6);
        group.add(pool);
      }

      anchors.push({ at: new Vector3(px, anchorY, pz) });
      places[index] = { x: px, z: pz };
    }
    placesRef.current = places;

    // -- Sizing --------------------------------------------------------------
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // -- Travel --------------------------------------------------------------
    const keys = new Set<string>();
    /**
     * Is this keystroke someone typing rather than someone steering?
     *
     * The listeners are on `window`, because a canvas is not a focus target a
     * trainee should have to find. That means every keystroke anywhere on the
     * page reached them — so spelling a word into a form field walked the
     * trainee across the room, one `w` at a time.
     */
    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el || typeof el.tagName !== "string") return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      // Modified keys are the browser's: `w` is forward, `cmd-w` is a closed
      // tab, and swallowing it would be a bug you only notice once.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      // Arrow keys scroll the document by default, so walking with them also
      // scrolled the page out from under the room.
      if (key.startsWith("arrow")) e.preventDefault();
      keys.add(key);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    // A keyup that never arrives — alt-tab mid-stride, a lock screen, a phone
    // call — used to leave the trainee walking into a wall indefinitely.
    const releaseControls = () => {
      keys.clear();
      turnRef.current = 0;
      padRef.current.active = false;
      padRef.current.x = 0;
      padRef.current.y = 0;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseControls);
    document.addEventListener("visibilitychange", releaseControls);

    // Facing into the room.
    //
    // This was Math.PI, and the comment claimed the same thing the code was
    // failing to do: a Three.js camera looks down its own -Z, and yaw = PI
    // points that axis at +Z — the near wall. So every trainee spawned 1.2 m
    // from a wall, staring at it, with the objects behind them and `W` walking
    // them into it. Zero is the value that means "into the room".
    let yaw = 0;
    let pitch = 0;
    const forward = new Vector3();
    const right = new Vector3();

    // Pointer state. One pair of handlers covers mouse and touch, so the two
    // platforms cannot drift apart.
    let dragging = false;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let downKind: string = "mouse";
    /** Where the trainee asked to walk. Null when not walking. */
    let walkTo: Vector3 | null = null;
    let walkLastD = Infinity;
    let walkStall = 0;

    /**
     * How far the pointer travelled from where it went down.
     *
     * Displacement, not summed path. Summing every delta punished a small
     * wobble in both directions as much as a deliberate sweep, so a tap that
     * drifted 5 px right and 5 px back scored as 10 px of looking.
     */
    const travel = (e: PointerEvent) => Math.hypot(e.clientX - downX, e.clientY - downY);

    const slopFor = () =>
      downKind === "touch" ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      downKind = e.pointerType;
      // An explicit tap cancels an in-flight walk: the trainee has changed
      // their mind, and continuing to the old target would feel like the app
      // ignoring them.
      walkTo = null;
      renderer.domElement.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      // Dead zone, so the first pixels of a press do not nudge the view.
      if (travel(e) > slopFor()) {
        yaw -= dx * TURN_SPEED;
        pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - dy * TURN_SPEED));
      }
    };

    const floorPlane = new Plane(new Vector3(0, 1, 0), 0);

    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      if (travel(e) > slopFor()) return; // that was a look, not a tap

      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      hit.setFromCamera(ndc, camera);

      // An object first. If the tap landed on something answerable, that is the
      // whole meaning of the gesture and it must never also start a walk.
      const found = hit.intersectObjects(pickable, false)[0];
      const id = found ? idOf.get(found.object as Mesh) : undefined;
      if (id) {
        onSelectRef.current(id);
        return;
      }

      // Otherwise it is the floor: walk there. Tap-to-walk is the low-friction
      // scheme — the exercise is about which object you approach and what you
      // do at it, not about holding a key down to steer.
      const ground = hit.ray.intersectPlane(floorPlane, new Vector3());
      if (ground) {
        // Clamped to the same margin the walk loop clamps to. When the two
        // disagreed, a tap close to a wall set a target the walker could never
        // stand on, and the walk abandoned itself as stalled. The aim point is
        // also pulled a body-radius off the wall, so tapping the floor where you
        // are standing does not walk you into it.
        const cx = Math.max(-(ROOM_W / 2 - WALL_MARGIN - BODY_R), Math.min(ROOM_W / 2 - WALL_MARGIN - BODY_R, ground.x));
        const cz = Math.max(-(ROOM_D / 2 - WALL_MARGIN - BODY_R), Math.min(ROOM_D / 2 - WALL_MARGIN - BODY_R, ground.z));
        walkTo = new Vector3(cx, 0, cz);
        walkLastD = Infinity;
        walkStall = 0;
      }
    };

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    padRef.current = { x: 0, y: 0, active: false };

    // -- Loop ----------------------------------------------------------------
    const clock = { last: performance.now() };
    const centre = new Vector2(0, 0);
    const projected = new Vector3();
    let frame = 0;
    let miniTick = 0;
    let mapSized = false;

    /**
     * The bay map.
     *
     * A 26 x 20 m room is big enough to get turned around in, and "which way is
     * the tunnel" is a safety question rather than a nicety — the reference
     * board carries a minimap for the same reason. It is drawn from the same
     * world positions the room is built from, so it cannot disagree with what
     * the trainee is looking at; it is not a hand-drawn diagram that drifts.
     *
     * Up on the map is the far wall, where the tunnel is, and the trainee is the
     * wedge, so the map answers "which way am I facing" as well as "where am
     * I". Drawn at devicePixelRatio so it is not soft on a phone.
     */
    const drawMap = () => {
      const canvas = miniRef.current;
      if (!canvas) return;
      if (!mapSized) {
        const dpr = Math.min(window.devicePixelRatio, 2);
        canvas.width = Math.round(MAP_W * dpr);
        canvas.height = Math.round(MAP_H * dpr);
        const setup = canvas.getContext("2d");
        setup?.setTransform(dpr, 0, 0, dpr, 0, 0);
        mapSized = true;
      }
      const g = canvas.getContext("2d");
      if (!g) return;

      const s = Math.min((MAP_W - 14) / ROOM_W, (MAP_H - 16) / ROOM_D);
      const ox = (MAP_W - ROOM_W * s) / 2;
      const oy = (MAP_H - ROOM_D * s) / 2 + 2;
      const mx = (x: number) => ox + (x + ROOM_W / 2) * s;
      const my = (z: number) => oy + (z + ROOM_D / 2) * s;

      g.clearRect(0, 0, MAP_W, MAP_H);
      g.fillStyle = "rgba(11,15,21,0.78)";
      g.fillRect(ox, oy, ROOM_W * s, ROOM_D * s);
      g.strokeStyle = "rgba(148,163,184,0.4)";
      g.lineWidth = 1;
      g.strokeRect(ox, oy, ROOM_W * s, ROOM_D * s);

      // The tunnel, drawn as a stub through the far wall: somewhere to go, and
      // the one fixed point the whole map can be read against.
      g.strokeStyle = "rgba(74,222,128,0.85)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(mx(5.0), oy);
      g.lineTo(mx(7.8), oy);
      g.stroke();
      g.beginPath();
      g.moveTo(mx(6.4), oy);
      g.lineTo(mx(6.4), oy - 6);
      g.stroke();
      g.fillStyle = "rgba(74,222,128,0.85)";
      g.font = "600 7px ui-monospace, monospace";
      g.fillText("EXIT", mx(5.2), oy - 8.5);

      // The painted walkway. It is the only thing in the room with a direction,
      // which at this size is what a trainee actually orients by.
      g.strokeStyle = "rgba(138,115,38,0.55)";
      g.lineWidth = 1;
      for (const offset of [-1.3, 1.3]) {
        g.beginPath();
        g.moveTo(mx(6.4 + offset), oy + 5);
        g.lineTo(mx(6.4 + offset), my(ROOM_D / 2 - 1.2));
        g.stroke();
      }

      // Scenery, faint. It is context for the graded objects rather than a
      // landmark in its own right, but the conveyor run down the right-hand
      // side is what makes the map match the room you are standing in.
      for (const item of SCENERY) {
        if (item.kind === "pipe-run") continue;
        const px = mx(item.x);
        const pz = my(item.z);
        if (item.kind === "conveyor") {
          const half = 6 * (item.scale?.[2] ?? 1) * s;
          g.strokeStyle = "rgba(201,162,39,0.8)";
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(px, pz - half);
          g.lineTo(px, pz + half);
          g.stroke();
          continue;
        }
        g.fillStyle = "rgba(148,163,184,0.32)";
        g.fillRect(px - 1.5, pz - 1.5, 3, 3);
      }

      // The answers. Same colour language as the room: green for the exit,
      // amber for something you can select, dim for equipment you can only find.
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        const object = objects[i];
        if (!anchor || !object) continue;
        const px = mx(anchor.at.x);
        const pz = my(anchor.at.z);
        const done = object.done || object.id === selectedRef.current;
        g.beginPath();
        g.arc(px, pz, object.isExit ? 3.4 : 2.6, 0, Math.PI * 2);
        g.fillStyle = object.isExit
          ? "#4ade80"
          : done
            ? "#facc15"
            : object.role === "interactable"
              ? "#fbbf24"
              : "rgba(226,232,240,0.6)";
        g.fill();
        if (object.isExit) {
          g.strokeStyle = "rgba(74,222,128,0.45)";
          g.lineWidth = 4;
          g.stroke();
        }
      }

      // The trainee: a view cone, so facing is readable at a glance, with the
      // wedge over it marking exactly where you stand.
      const px = mx(camera.position.x);
      const pz = my(camera.position.z);
      const ax = -Math.sin(yaw);
      const az = -Math.cos(yaw);
      const heading = Math.atan2(az, ax);
      g.beginPath();
      g.moveTo(px, pz);
      g.arc(px, pz, 24, heading - 0.55, heading + 0.55);
      g.closePath();
      g.fillStyle = "rgba(226,232,240,0.12)";
      g.fill();

      g.beginPath();
      g.moveTo(px + ax * 6, pz + az * 6);
      g.lineTo(px - az * 3.2 - ax * 1.6, pz + ax * 3.2 - az * 1.6);
      g.lineTo(px + az * 3.2 - ax * 1.6, pz - ax * 3.2 - az * 1.6);
      g.closePath();
      g.fillStyle = "#e2e8f0";
      g.fill();
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - clock.last) / 1000, 0.05);
      clock.last = now;

      // Turning, from keys or the on-screen buttons. Without this the only way
      // to look around was to drag the mouse, which is not a control scheme
      // anyone brings to a shared training handset.
      let turn = turnRef.current;
      if (keys.has("q")) turn -= 1;
      if (keys.has("e")) turn += 1;
      if (turn !== 0) yaw += turn * KEY_TURN * dt;

      // Movement is camera-relative, so "forward" is wherever you are looking.
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      forward.set(-fx, 0, -fz);
      right.set(-fz, 0, fx);

      let mx = 0;
      let mz = 0;
      if (keys.has("w") || keys.has("arrowup")) mz += 1;
      if (keys.has("s") || keys.has("arrowdown")) mz -= 1;
      if (keys.has("a")) mx -= 1;
      if (keys.has("d")) mx += 1;
      if (padRef.current.active) {
        mx += padRef.current.x;
        mz -= padRef.current.y;
      }
      // A label was tapped: walk to the thing it names. This is the coarse
      // control the wide room needs — judging where a spot on the floor is, in
      // three dimensions, at 20 m, is a skill the exercise is not testing.
      if (wantWalk.current) {
        walkTo = new Vector3(wantWalk.current.x, 0, wantWalk.current.z);
        walkLastD = Infinity;
        walkStall = 0;
        wantWalk.current = null;
      }

      // Two movement sources: what the trainee is holding, and where they
      // tapped. Holding something wins and cancels the walk, because a person
      // who starts steering has changed their mind about the destination.
      const len = Math.hypot(mx, mz);
      let stepX = 0;
      let stepZ = 0;

      if (len > 0) {
        walkTo = null;
        const step = WALK_SPEED * dt;
        stepX = (right.x * mx + forward.x * mz) * (step / Math.max(1, len));
        stepZ = (right.z * mx + forward.z * mz) * (step / Math.max(1, len));
      } else if (walkTo) {
        const tx = walkTo.x - camera.position.x;
        const tz = walkTo.z - camera.position.z;
        const d = Math.hypot(tx, tz);
        if (d <= WALK_TARGET_STOP) {
          walkTo = null;
        } else {
          const step = Math.min(WALK_TARGET_SPEED * dt, d);
          stepX = (tx / d) * step;
          stepZ = (tz / d) * step;
        }
      }

      if (stepX !== 0 || stepZ !== 0) {
        camera.position.x += stepX;
        camera.position.z += stepZ;

        // Walls. A clamp is enough for a rectangular room and costs nothing.
        const halfW = ROOM_W / 2 - WALL_MARGIN;
        const halfD = ROOM_D / 2 - WALL_MARGIN;
        camera.position.x = Math.max(-halfW, Math.min(halfW, camera.position.x));
        camera.position.z = Math.max(-halfD, Math.min(halfD, camera.position.z));

        // Props are solid. Without this you can end up standing inside the fire
        // exit, which is a surreal way to fail a safety step.
        for (const p of solid) {
          const dx = camera.position.x - p.x;
          const dz = camera.position.z - p.z;
          const need = p.r + BODY_R;
          const d = Math.hypot(dx, dz);
          if (d > 0 && d < need) {
            const push = (need - d) / d;
            camera.position.x += dx * push;
            camera.position.z += dz * push;
          }
        }

        // Give up on a walk that stops making progress, or a target tucked
        // against a prop would leave the trainee grinding against it forever.
        if (walkTo) {
          const remaining = Math.hypot(
            walkTo.x - camera.position.x,
            walkTo.z - camera.position.z,
          );
          if (remaining > walkLastD - Math.min(0.004, Math.hypot(stepX, stepZ) * 0.3)) {
            walkStall += 1;
            if (walkStall > 12) walkTo = null;
          } else {
            walkStall = 0;
          }
          walkLastD = remaining;
        }
      }
      camera.position.y = EYE_H;
      camera.rotation.set(pitch, yaw, 0, "YXZ");

      // Tint the object under the crosshair, so "tap what you are aiming at" is
      // legible before the tap rather than after it.
      hit.setFromCamera(centre, camera);
      const aimed = hit.intersectObjects(pickable, false)[0];
      const aimedId = aimed ? idOf.get(aimed.object as Mesh) : undefined;
      const chosen = selectedRef.current;
      for (const [id, mats] of bodies) {
        const base = resting.get(id) ?? "#000000";
        const lit = id === chosen ? "#1c6b38" : id === aimedId ? "#4a3600" : base;
        for (const mat of mats) mat.emissive.set(lit);
      }
      if (crosshairDot.current && crosshairRing.current) {
        const on = Boolean(aimedId);
        crosshairDot.current.style.background = on
          ? "#fbbf24"
          : "rgba(226,232,240,0.65)";
        crosshairRing.current.style.borderColor = on
          ? "rgba(251,191,36,0.9)"
          : "rgba(226,232,240,0.28)";
        crosshairRing.current.style.transform = on
          ? "translate(-50%, -50%) scale(1.25)"
          : "translate(-50%, -50%) scale(1)";
      }

      // Project every label into screen space, straight onto its DOM node.
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      for (let i = 0; i < anchors.length; i++) {
        const node = labelNodes.current[i];
        const anchor = anchors[i];
        if (!node || !anchor) continue;
        projected.copy(anchor.at).project(camera);
        // z > 1 is behind the camera. Three.js has already mirrored those into
        // the frame, so without this a label for the thing behind you renders
        // on top of the thing in front of you.
        if (projected.z > 1) {
          node.style.opacity = "0";
          continue;
        }
        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h;

        // Distance fade. Names in the room you are standing in, and lets the
        // bay map handle the far end — see LABEL_NEAR/LABEL_FAR.
        const distance = camera.position.distanceTo(anchor.at);
        const alpha =
          objects[i]?.isExit || distance <= LABEL_NEAR
            ? 1
            : Math.max(0, (LABEL_FAR - distance) / (LABEL_FAR - LABEL_NEAR));
        node.style.opacity = alpha.toFixed(2);
        node.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${(y - 6).toFixed(1)}px)`;
      }

      // The bay map is redrawn every other frame. It has nothing to do with the
      // camera update, so 30 Hz is indistinguishable from 60 and halves the
      // 2D canvas work this surface does.
      if (miniTick++ % 2 === 0) drawMap();

      renderer.render(scene, camera);
    };
    tick();

    // -- Teardown ------------------------------------------------------------
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseControls);
      document.removeEventListener("visibilitychange", releaseControls);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("webglcontextlost", onContextLost);
      for (const geo of disposables) geo.dispose();
      for (const tex of textures) tex.dispose();
      scene.traverse((node) => {
        const mesh = node as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    // `objects` is the only input to scene construction. Selection is read
    // through a ref precisely so that answering does not rebuild the room.
  }, [objects]);

  const releasePad = () => {
    padRef.current.active = false;
    padRef.current.x = 0;
    padRef.current.y = 0;
  };

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />

      {/* Crosshair. The highlight raycast reads from screen centre, so
          something has to be visible there. */}
      <div
        ref={crosshairRing}
        className="pointer-events-none absolute left-1/2 top-1/2 h-9 w-9 rounded-full border"
        style={{ transform: "translate(-50%, -50%) scale(1)" }}
      />
      <div
        ref={crosshairDot}
        className="pointer-events-none absolute left-1/2 top-1/2 h-1 w-1 rounded-full"
        style={{ transform: "translate(-50%, -50%)" }}
      />

      {/* The bay map. Top-right, like the reference board's. It is drawn from
          the room's own world coordinates each frame, so it can never disagree
          with what the trainee is standing in front of — and it is the only
          thing that answers "where is the tunnel" from across 26 m. */}
      <div className="pointer-events-none absolute right-2 top-2 origin-top-right scale-[0.78] rounded-lg border border-fog-700/40 bg-ink-950/80 p-1.5 backdrop-blur-sm sm:right-3 sm:top-3 sm:scale-100">
        <p className="px-0.5 pb-1 font-mono text-[9px] uppercase tracking-widest text-fog-500">
          bay map
        </p>
        <canvas
          ref={miniRef}
          aria-hidden="true"
          className="block"
          style={{ width: MAP_W, height: MAP_H }}
        />
        <p className="flex items-center gap-1 px-0.5 pt-1 font-mono text-[9px] uppercase tracking-wider text-fog-600">
          <span className="h-1.5 w-1.5 rounded-full bg-fog-300" />
          you are here
        </p>
      </div>

      {/* Object labels. DOM, not canvas — docs/05 §5. Screen position is driven
          imperatively by the render loop. */}
      {objects.map((o, i) => (
        <button
          key={o.id}
          type="button"
          ref={(n) => {
            labelNodes.current[i] = n;
          }}
          // A label is how you travel. It is also why these are buttons and not
          // decorated divs: a name you can tab to and press is the same control
          // for a keyboard as for a thumb.
          onClick={() => {
            wantWalk.current = placesRef.current[i] ?? null;
          }}
          title={`Walk to ${o.label}`}
          className={clsx(
            "absolute left-0 top-0 flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
            o.isExit
              ? "bg-go-500/20 text-go-300"
              : o.role === "interactable"
                ? o.done
                  ? "bg-go-500/15 text-go-300/80 line-through"
                  : "bg-amber-500/20 text-amber-200"
                : "bg-ink-950/70 text-fog-300",
          )}
          style={{ opacity: "0" }}
        >
          {/* An act step is a sequence. The number is the sequence. */}
          {o.order !== undefined && (
            <span className="opacity-70 tabular-nums">{o.order}</span>
          )}
          {o.label}
        </button>
      ))}

      {/* Thumb pad, for a phone held in one hand. Hidden where there is a
          keyboard, because two movement schemes at once is worse than one. */}
      <div
        className="absolute bottom-4 left-4 h-24 w-24 touch-none rounded-full border border-fog-700/40 bg-ink-900/60 select-none lg:hidden"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          padRef.current.active = true;
        }}
        onPointerMove={(e) => {
          if (!padRef.current.active) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const max = rect.width / 2;
          let dx = e.clientX - (rect.left + max);
          let dy = e.clientY - (rect.top + max);
          const len = Math.hypot(dx, dy);
          if (len > max) {
            dx = (dx / len) * max;
            dy = (dy / len) * max;
          }
          padRef.current.x = dx / max;
          padRef.current.y = dy / max;
        }}
        onPointerUp={releasePad}
        onPointerCancel={releasePad}
        aria-label="Movement pad"
      >
        <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fog-500/60 bg-fog-500/20" />
      </div>

      {/* Turn buttons, so turning never needs a second thumb at once. */}
      <div className="absolute bottom-4 right-4 flex gap-2 lg:hidden">
        <TurnButton dir={-1} turnRef={turnRef} />
        <TurnButton dir={1} turnRef={turnRef} />
      </div>

      <p className="pointer-events-none absolute bottom-4 right-4 hidden rounded-md bg-ink-950/70 px-2.5 py-1.5 text-right font-mono text-[10px] uppercase tracking-wider text-fog-500 lg:block">
        tap the floor to walk · tap an object to answer · drag to look · w a s d to walk · q / e to turn
      </p>
    </div>
  );
}
