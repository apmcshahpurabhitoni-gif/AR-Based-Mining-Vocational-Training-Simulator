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
 * should not have to grant. Drag-to-look and a thumb pad work everywhere.
 */

import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

/** Room interior, in metres. Big enough to feel like a workshop, small enough to cross. */
const ROOM_W = 22;
const ROOM_D = 22;
const WALL_H = 4.2;
/** Eye height. A person, not a drone. */
const EYE_H = 1.65;
const WALK_SPEED = 4.2;
const TURN_SPEED = 0.0032;
/** A drag longer than this is a look, not a tap. */
const TAP_SLOP_PX = 8;

export interface SceneObject {
  id: string;
  label: string;
  /** Normalised 0..1 from the content manifest, mapped onto the room. */
  x: number;
  y: number;
  /** The fire exit is drawn the way one is actually seen: green and lit. */
  isExit?: boolean;
}

export function Scene3D({
  objects,
  onSelect,
  selectedId,
  onFallback,
}: {
  objects: SceneObject[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  onFallback: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const padRef = useRef({ x: 0, y: 0, active: false });
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    } catch {
      // No WebGL, or the context is refused. The 2D scene is a complete
      // fallback, so this is never fatal.
      onFallback();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color("#0a0d12");
    // Depth cue. Without it a grey room in dim light reads as a flat backdrop.
    scene.fog = new Fog("#0a0d12", 14, 34);

    const camera = new PerspectiveCamera(70, 1, 0.1, 100);
    camera.position.set(0, EYE_H, ROOM_D / 2 - 1.2);

    // -- Light ---------------------------------------------------------------
    scene.add(new AmbientLight("#5a6472", 0.55));
    const key = new DirectionalLight("#ffd9a0", 0.5);
    key.position.set(6, 12, 4);
    scene.add(key);
    // Sodium-ish pools, the way a mine workshop is actually lit.
    for (const [x, z] of [
      [-6, -5],
      [6, 5],
    ] as const) {
      const lamp = new PointLight("#ffb457", 22, 20);
      lamp.position.set(x, WALL_H - 0.9, z);
      scene.add(lamp);
    }

    const world = new Group();
    scene.add(world);

    // -- Room ----------------------------------------------------------------
    const floorMat = new MeshStandardMaterial({ color: "#2a2f36", roughness: 0.95 });
    const wallMat = new MeshStandardMaterial({
      color: "#39414b",
      roughness: 0.9,
      side: DoubleSide,
    });
    const floor = new Mesh(new PlaneGeometry(ROOM_W, ROOM_D), floorMat);
    floor.rotation.x = -Math.PI / 2;
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
      const wall = new Mesh(new PlaneGeometry(
        x === 0 ? ROOM_W : ROOM_D,
        WALL_H,
      ), wallMat);
      wall.position.set(x, WALL_H / 2, z);
      wall.rotation.y = rotY;
      world.add(wall);
    }

    // -- Landmarks -----------------------------------------------------------
    // Structure, not curriculum. These exist so there is somewhere to walk to
    // and something to navigate by; they carry no safety verdict and are
    // deliberately not tappable.
    const pillarMat = new MeshStandardMaterial({ color: "#4a525d", roughness: 0.85 });
    const pillarGeo = new CylinderGeometry(0.34, 0.34, WALL_H, 12);
    for (const [x, z] of [
      [-5.5, -5.5],
      [5.5, -5.5],
      [-5.5, 5.5],
      [5.5, 5.5],
    ] as const) {
      const pillar = new Mesh(pillarGeo, pillarMat);
      pillar.position.set(x, WALL_H / 2, z);
      world.add(pillar);
    }

    const crateMat = new MeshStandardMaterial({ color: "#5b4a35", roughness: 1 });
    const crateGeo = new BoxGeometry(1.5, 1.1, 1.1);
    for (const [x, z, ry] of [
      [-8.5, 2.5, 0.3],
      [8, -3, -0.5],
      [1.5, -8, 0.9],
    ] as const) {
      const crate = new Mesh(crateGeo, crateMat);
      crate.position.set(x, 0.55, z);
      crate.rotation.y = ry;
      world.add(crate);
    }

    // -- Targets -------------------------------------------------------------
    // Manifest coordinates are normalised 0..1; here they become room
    // coordinates, so a content author placing a sign in the top-right of the
    // 2D scene puts it in the far corner of the room.
    const hit = new Raycaster();
    const pickable: Mesh[] = [];
    const highlight: Mesh[] = [];
    // Mesh -> manifest id. A side table rather than `userData`, which would
    // need a cast on every read and would fight the library's own typing.
    const idOf = new Map<Mesh, string>();
    const disposables: BufferGeometry[] = [];

    for (const object of objects) {
      const wx = (object.x - 0.5) * (ROOM_W - 3);
      const wz = (0.5 - object.y) * (ROOM_D - 3);

      const group = new Group();
      group.position.set(wx, 0, wz);
      world.add(group);

      const colour = object.isExit ? "#22c55e" : "#94a3b8";
      const bodyMat = new MeshStandardMaterial({
        color: colour,
        // The exit sign is lit; the rest are painted steel. The eye should find
        // the exit the way it does in a real smoke-filled room.
        emissive: object.isExit ? "#0b3d1c" : "#000000",
        roughness: 0.6,
      });

      // A sign on a post: post, panel, and a cone marking the spot on the floor.
      const postGeo = new CylinderGeometry(0.07, 0.07, 2.1, 8);
      const post = new Mesh(postGeo, bodyMat);
      post.position.y = 1.05;
      group.add(post);
      disposables.push(postGeo);

      const panelGeo = new BoxGeometry(1.15, 0.42, 0.1);
      const panel = new Mesh(panelGeo, bodyMat);
      panel.position.y = 2.25;
      group.add(panel);
      disposables.push(panelGeo);

      // Facing the player, so the raycaster has a broad face to hit.
      panel.rotation.y = Math.PI / 4;

      if (object.isExit) {
        const glow = new PointLight("#22c55e", 9, 7);
        glow.position.y = 2.25;
        group.add(glow);

        // A pool of light on the floor. This is what makes it findable at all.
        const poolGeo = new PlaneGeometry(3, 3);
        const pool = new Mesh(
          poolGeo,
          new MeshBasicMaterial({ color: "#22c55e", transparent: true, opacity: 0.14 }),
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.y = 0.02;
        group.add(pool);
        disposables.push(poolGeo);
      } else {
        const coneGeo = new ConeGeometry(0.42, 0.9, 10);
        const cone = new Mesh(coneGeo, bodyMat);
        cone.position.y = 0.45;
        group.add(cone);
        disposables.push(coneGeo);
      }

      pickable.push(panel);
      highlight.push(panel);
      idOf.set(panel, object.id);
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
    const onKeyDown = (e: KeyboardEvent) => {
      keys.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let yaw = Math.PI; // start facing into the room, away from the near wall
    let pitch = 0;
    const forward = new Vector3();
    const right = new Vector3();

    // Pointer state. One pair of handlers covers mouse and touch, so the two
    // platforms cannot drift apart.
    let dragging = false;
    let movedPx = 0;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      movedPx = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      movedPx += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX;
      lastY = e.clientY;
      yaw -= dx * TURN_SPEED;
      pitch = Math.max(-0.6, Math.min(0.6, pitch - dy * TURN_SPEED));
    };

    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      if (movedPx > TAP_SLOP_PX) return; // that was a look, not a tap
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      hit.setFromCamera(ndc, camera);
      const found = hit.intersectObjects(pickable, false)[0];
      const id = found ? idOf.get(found.object as Mesh) : undefined;
      if (id) onSelectRef.current(id);
    };

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    // Thumb pad, for a phone held in one hand. Held in a ref because the pad is
    // rendered as sibling markup outside the canvas, which this effect owns.
    const pad = { x: 0, y: 0, active: false };
    padRef.current = pad;

    // -- Loop ----------------------------------------------------------------
    const clock = { last: performance.now() };
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - clock.last) / 1000, 0.05);
      clock.last = now;

      // Movement is camera-relative, so "forward" is wherever you are looking.
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      forward.set(-fx, 0, -fz);
      right.set(-fz, 0, fx);

      let mx = 0;
      let mz = 0;
      if (keys.has("w") || keys.has("arrowup")) mz += 1;
      if (keys.has("s") || keys.has("arrowdown")) mz -= 1;
      if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
      if (keys.has("d") || keys.has("arrowright")) mx += 1;
      if (pad.active) {
        mx += pad.x;
        mz -= pad.y;
      }
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        const step = (WALK_SPEED * dt) / Math.max(1, len);
        camera.position.addScaledVector(right, mx * step);
        camera.position.addScaledVector(forward, mz * step);
        // Walls. A clamp is enough for a rectangular room and costs nothing.
        const halfW = ROOM_W / 2 - 0.7;
        const halfD = ROOM_D / 2 - 0.7;
        camera.position.x = Math.max(-halfW, Math.min(halfW, camera.position.x));
        camera.position.z = Math.max(-halfD, Math.min(halfD, camera.position.z));
      }
      camera.position.y = EYE_H;
      camera.rotation.set(pitch, yaw, 0, "YXZ");

      // Tint the object under the crosshair, so "tap what you are aiming at" is
      // legible before the tap rather than after it.
      hit.setFromCamera(new Vector2(0, 0), camera);
      const aimed = hit.intersectObjects(pickable, false)[0];
      const aimedId = aimed ? idOf.get(aimed.object as Mesh) : undefined;
      for (const mesh of highlight) {
        const id = idOf.get(mesh);
        const material = mesh.material as MeshStandardMaterial;
        material.emissive.set(id === aimedId || id === selectedId ? "#3f2d00" : "#000000");
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
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      for (const geo of disposables) geo.dispose();
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
  }, [objects, selectedId]);

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />

      {/* Thumb pad. Desktop uses the keyboard, so it is hidden where there is
          no touch screen. Dragging the canvas looks around; the pad walks. */}
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
        onPointerUp={() => {
          padRef.current.active = false;
          padRef.current.x = 0;
          padRef.current.y = 0;
        }}
        onPointerCancel={() => {
          padRef.current.active = false;
          padRef.current.x = 0;
          padRef.current.y = 0;
        }}
        aria-label="Movement pad"
      >
        <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fog-500/60 bg-fog-500/20" />
      </div>

      <p className="pointer-events-none absolute bottom-4 right-4 rounded-md bg-ink-950/70 px-2.5 py-1.5 text-right font-mono text-[10px] uppercase tracking-wider text-fog-500">
        <span className="hidden lg:inline">drag to look · wasd to walk</span>
        <span className="lg:hidden">drag to look · pad to walk</span>
      </p>
    </div>
  );
}
