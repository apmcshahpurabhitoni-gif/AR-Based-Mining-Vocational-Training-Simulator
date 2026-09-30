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
  kindOf,
  radiusOf,
  type PropKind,
} from "../lib/ar/prop-shapes";
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
 * This was 22 before, and 22 m is a hall — four objects you must cross a
 * warehouse to reach, and walls too far away to give the room any shape. At 18
 * the equipment reads at a glance, the walls close the space in, and walking
 * between objects is a few steps rather than a trek. The room is still bigger
 * than a real workshop bay, which is what makes walking to the exit meaningful.
 */
const ROOM_W = 18;
const ROOM_D = 18;
const WALL_H = 3.9;
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

export type { RoomObject as SceneObject } from "../lib/room";

/**
 * Candidate positions for unplaced objects, in the order they are offered.
 * Everything lives against a wall, because that is where plant equipment
 * actually lives, and because a scatter across the middle of the floor reads
 * as procedural noise rather than a room. Deterministic: the same step always
 * produces the same room, so a re-check is comparable to its training.
 */
const SLOTS: ReadonlyArray<readonly [number, number, number]> = [
  // [x, z, facing-radians] in room coordinates.
  [-9.4, -6.2, Math.PI * 0.5],
  [-9.4, 0.4, Math.PI * 0.5],
  [-9.4, 6.6, Math.PI * 0.5],
  [9.4, -5.0, -Math.PI * 0.5],
  [9.4, 2.2, -Math.PI * 0.5],
  [9.4, 8.0, -Math.PI * 0.5],
  [-5.0, -9.4, 0],
  [1.6, -9.4, 0],
  [7.4, -9.4, 0],
  [-6.4, 9.4, Math.PI],
  [0.2, 9.4, Math.PI],
  [6.8, 9.4, Math.PI],
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
  // whole point is seeing the alternatives side by side. At 3.6 m half-width
  // the end objects sit at ~38° off centre, which the 76° frustum holds.
  const half = 3.2;
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
  const labelNodes = useRef<Array<HTMLDivElement | null>>([]);
  const crosshairDot = useRef<HTMLDivElement | null>(null);
  const crosshairRing = useRef<HTMLDivElement | null>(null);

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

    // -- Room ----------------------------------------------------------------
    //
    // Every surface here is textured from a canvas drawn at load time. The old
    // room was six flat-coloured planes, which is why it read as a grey box: no
    // grain, no seams, and therefore no sense of scale.
    const floorTex = surfaceTexture({
      base: "#33373d",
      speckle: "#5a6068",
      speckleCount: 5200,
      speckleAlpha: 0.5,
      joint: "#22262b",
      jointEvery: 128,
      repeat: 6,
    });
    const wallTex = surfaceTexture({
      base: "#3d4550",
      speckle: "#59626f",
      speckleCount: 2600,
      speckleAlpha: 0.35,
      joint: "#2b323b",
      jointEvery: 256,
      repeat: 4,
    });
    textures.push(floorTex, wallTex);

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

    const ceiling = new Mesh(new PlaneGeometry(ROOM_W, ROOM_D), wallMat);
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

    // Roof beams, across the short axis.
    const beamGeo = new BoxGeometry(0.26, 0.34, ROOM_D);
    for (const x of [-4.5, 0, 4.5] as const) {
      const beam = new Mesh(beamGeo, steelMat);
      beam.position.set(x, WALL_H - 0.22, 0);
      beam.castShadow = true;
      world.add(beam);
    }

    // A pipe run and cable tray along the far wall.
    const pipeGeo = new CylinderGeometry(0.13, 0.13, ROOM_W - 0.6, 10);
    for (const [y, color] of [
      [WALL_H - 0.55, "#7d6a4a"],
      [WALL_H - 0.85, "#5c6b7a"],
    ] as const) {
      const pipe = new Mesh(
        pipeGeo,
        new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 }),
      );
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, y, -ROOM_D / 2 + 0.28);
      world.add(pipe);
    }

    // Painted walkway down the middle. Safety yellow, worn — and a real scale
    // reference, which is what a large empty floor is missing most.
    const walkwayMat = new MeshStandardMaterial({
      color: "#8a7326",
      roughness: 0.9,
      transparent: true,
      opacity: 0.75,
    });
    for (const x of [-1.15, 1.15] as const) {
      const stripe = new Mesh(new PlaneGeometry(0.16, ROOM_D - 1.6), walkwayMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, 0.012, 0);
      world.add(stripe);
    }

    // -- Landmarks -----------------------------------------------------------
    // Structure, not curriculum. These exist so there is somewhere to walk to
    // and something to navigate by; they carry no safety verdict and are
    // deliberately not tappable.
    const pillarMat = new MeshStandardMaterial({ color: "#4a525d", roughness: 0.8, metalness: 0.2 });
    const pillarGeo = new CylinderGeometry(0.34, 0.34, WALL_H, 12);
    for (const [x, z] of [
      [-5.5, -5.5],
      [5.5, -5.5],
      [-5.5, 5.5],
      [5.5, 5.5],
    ] as const) {
      const pillar = new Mesh(pillarGeo, pillarMat);
      pillar.position.set(x, WALL_H / 2, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      world.add(pillar);
    }

    const crateMat = new MeshStandardMaterial({ color: "#5b4a35", roughness: 1 });
    const crateGeo = new BoxGeometry(1.5, 1.1, 1.1);
    for (const [x, z, ry] of [
      [-6.8, 2.5, 0.3],
      [6.8, -3, -0.5],
      [1.5, -6.8, 0.9],
    ] as const) {
      const crate = new Mesh(crateGeo, crateMat);
      crate.position.set(x, 0.55, z);
      crate.rotation.y = ry;
      crate.castShadow = true;
      crate.receiveShadow = true;
      world.add(crate);
    }

    // -- Placement -----------------------------------------------------------
    // Props the manifest placed keep their authored position. Everything else
    // takes the next free wall slot, so two objects can never end up inside
    // each other, or inside a pillar, or stacked in the middle of the floor.
    //
    // These are also the collision set: pillars, crates and posts are things
    // you cannot walk through. Without them the trainee slides through solid
    // plant, which makes the room feel like a texture rather than a place.
    const taken: Array<{ x: number; z: number; r: number }> = [
      { x: -5.5, z: -5.5, r: 1.0 },
      { x: 5.5, z: -5.5, r: 1.0 },
      { x: -5.5, z: 5.5, r: 1.0 },
      { x: 5.5, z: 5.5, r: 1.0 },
      { x: -6.8, z: 2.5, r: 1.3 },
      { x: 6.8, z: -3, r: 1.3 },
      { x: 1.5, z: -6.8, r: 1.3 },
    ];
    // Everything in `taken` is solid, so pillars and crates block the walker
    // too, not just the props this loop adds.
    const solid: Array<{ x: number; z: number; r: number }> = taken.map((t) => ({ ...t }));
    let slotCursor = 0;

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
    const disposables: BufferGeometry[] = [];
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

    const keep = (g: BufferGeometry) => {
      disposables.push(g);
      return g;
    };

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
        px = (object.x - 0.5) * (ROOM_W - 3);
        pz = (0.5 - object.y) * (ROOM_D - 3);
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
    }

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
    const onKeyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
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
        const limit = ROOM_W / 2 - BODY_R - 0.4;
        walkTo = new Vector3(
          Math.max(-limit, Math.min(limit, ground.x)),
          0,
          Math.max(-limit, Math.min(limit, ground.z)),
        );
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
        const halfW = ROOM_W / 2 - 0.7;
        const halfD = ROOM_D / 2 - 0.7;
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
        if (projected.z > 1) {
          node.style.opacity = "0";
          continue;
        }
        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h;
        node.style.opacity = "1";
        node.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${(y - 6).toFixed(1)}px)`;
      }

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

      {/* Object labels. DOM, not canvas — docs/05 §5. Screen position is driven
          imperatively by the render loop. */}
      {objects.map((o, i) => (
        <div
          key={o.id}
          ref={(n) => {
            labelNodes.current[i] = n;
          }}
          className={clsx(
            "pointer-events-none absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
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
        </div>
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
        tap the floor to walk · tap an object to answer · drag to look · q / e to turn
      </p>
    </div>
  );
}
