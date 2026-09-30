/**
 * L1 — printed marker AR, through the phone camera.
 *
 * ---------------------------------------------------------------------------
 * What this is
 * ---------------------------------------------------------------------------
 *
 * The trainee points the rear camera at a printed marker taped beside the real
 * object. MindAR locates the marker in the frame, computes its pose, and the
 * object is drawn in place over the live camera feed. `docs/05` §3 calls this
 * the production presentation path.
 *
 * It is a **presentation surface and nothing more**. Tapping an object
 * dispatches the same `tapTarget` / `choose` / `perform` action the 3D room and
 * the card list dispatch, so `runner.ts`, `scoring.ts` and `gate.ts` cannot tell
 * which surface answered. `docs/11` §2 is explicit that a renderer may never
 * reach scoring or a certificate decision, and there is no import here that
 * could: this file touches three, MindAR, and React.
 *
 * ---------------------------------------------------------------------------
 * Which steps can be shown this way
 * ---------------------------------------------------------------------------
 *
 * Only objects with a printed marker (`TRACKED_TARGETS`) — the `observe` steps,
 * where the trainee has to physically find something. A `decide` step presents
 * four alternatives to compare and an `act` step presents an order to follow;
 * both are screen tasks, and neither is improved by being scattered around a
 * room. Those stay in the 3D room.
 *
 * If a step has no marker at all, `Training` never offers this surface. If the
 * camera is denied, the permission is missing, MindAR fails to load, or the
 * context is lost, `onFallback` sends the trainee to the 3D room with the
 * session intact — `docs/05` §8: never lose state, never hard-fail.
 *
 * ---------------------------------------------------------------------------
 * Text is DOM, never canvas — docs/05 §5
 * ---------------------------------------------------------------------------
 *
 * Devanagari does not shape correctly in a WebGL texture, and the project is
 * bilingual by contract. So labels are HTML elements projected from the anchor's
 * world position each frame, written straight to `style.transform`, which costs
 * no React re-render.
 */

import { useEffect, useRef } from "react";
import clsx from "clsx";
import {
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from "three";

import { MindARThree } from "./mindar-three.js";
import { buildProp, kindOf } from "./prop-shapes";
import type { RoomObject } from "../room";
import { MARKER_PRINT_M, targetIndexFor, TRACKED_TARGETS } from "./targets";

/** URL of the compiled feature set, written by `bun run make:targets`. */
const TARGET_SRC = "/targets.mind";

/** A drag longer than this is a look, not a tap. Matches the 3D room. */
const TAP_SLOP_TOUCH = 16;
const TAP_SLOP_MOUSE = 6;

export interface SceneARProps {
  objects: RoomObject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Camera refused, tracking failed, or the mind file would not load. */
  onFallback: () => void;
}

export function SceneAR({ objects, selectedId, onSelect, onFallback }: SceneARProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelNodes = useRef<Array<HTMLDivElement | null>>([]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;

    // Objects that actually have a printed marker. Anything else cannot be
    // tracked, so it is not drawn — showing an untrackable object would put a
    // target on screen that no amount of pointing could align.
    const tracked = objects.filter((o) => targetIndexFor(o.id) >= 0);
    if (tracked.length === 0) {
      fallbackRef.current();
      return;
    }

    let mindar: MindARThree;
    try {
      mindar = new MindARThree({
        container: mount,
        imageTargetSrc: TARGET_SRC,
        // One marker at a time. A trainee is looking at one object, and every
        // extra tracked target is detector cost on a mid-range phone.
        maxTrack: 1,
        uiLoading: "no",
        uiScanning: "no",
        uiError: "no",
      });
    } catch {
      fallbackRef.current();
      return;
    }

    const { renderer, scene, camera } = mindar;

    scene.add(new AmbientLight("#ffffff", 0.95));
    const key = new DirectionalLight("#fff4e0", 1.3);
    key.position.set(1, 2, 1);
    scene.add(key);

    const geometries: BufferGeometry[] = [];
    const keep = (g: BufferGeometry) => {
      geometries.push(g);
      return g;
    };
    const pickable: Mesh[] = [];
    const idOf = new Map<Mesh, string>();
    const labelAnchors = new Map<string, Vector3>();

    // One anchor per tracked marker, with this step's object on it.
    for (const object of tracked) {
      const index = targetIndexFor(object.id);
      const anchor = mindar.addAnchor(index);

      const bodyMat = new MeshStandardMaterial({
        color: object.isExit ? "#22c55e" : "#c8d2e0",
        emissive: object.isExit ? "#0b3d1c" : "#000000",
        roughness: 0.55,
      });
      const { group, meshes, anchorY } = buildProp(kindOf(object.id), bodyMat, keep);

      // MindAR's world unit is the printed marker's own width, so a prop built
      // in metres has to be divided by the marker's real size to come out
      // life-size on screen. Without this the object is either toy-sized or
      // fills the frame depending on how big the sheet was printed.
      const scale = 1 / MARKER_PRINT_M;
      const holder = new Group();
      holder.scale.setScalar(scale);
      holder.add(group);
      anchor.group.add(holder);

      for (const mesh of meshes) {
        pickable.push(mesh);
        idOf.set(mesh, object.id);
      }
      labelAnchors.set(object.id, new Vector3(0, anchorY * scale, 0));
    }

    let downX = 0;
    let downY = 0;
    let downKind = "mouse";
    const el = renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      downKind = e.pointerType;
    };

    const onPointerUp = (e: PointerEvent) => {
      const slop = downKind === "touch" ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > slop) return;

      const rect = el.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const hit = new Raycaster();
      hit.setFromCamera(ndc, camera);
      const found = hit.intersectObjects(pickable, false)[0];
      const id = found ? idOf.get(found.object as Mesh) : undefined;
      if (id) onSelectRef.current(id);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    const start = async () => {
      try {
        await mindar.start();
      } catch {
        // getMedia refused, no camera, or the .mind would not load. All three
        // land in the 3D room with the session intact.
        if (!disposed) fallbackRef.current();
        return;
      }
      if (disposed) return;

      const projected = new Vector3();
      const project = () => {
        frame = requestAnimationFrame(project);
        renderer.render(scene, camera);

        const w = mount.clientWidth || 1;
        const h = mount.clientHeight || 1;
        for (const [id, local] of labelAnchors) {
          const node = labelNodes.current[tracked.findIndex((o) => o.id === id)];
          if (!node) continue;
          const anchor = mindar.anchors.find((a) => a.targetIndex === targetIndexFor(id));
          if (!anchor) continue;

          // World position of the label, taken from the anchor's own matrix
          // rather than the group's, because the anchor is matrixAutoUpdate=false
          // and its world matrix is composed by MindAR each frame.
          projected.copy(local).applyMatrix4(anchor.group.matrixWorld).project(camera);

          // Behind the camera, or lost: hide rather than flip to the far side.
          if (projected.z > 1 || !anchor.visible) {
            node.style.opacity = "0";
            continue;
          }
          const x = (projected.x * 0.5 + 0.5) * w;
          const y = (-projected.y * 0.5 + 0.5) * h;
          node.style.opacity = "1";
          node.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${(y - 10).toFixed(1)}px)`;
        }
      };
      project();
    };

    void start();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      for (const g of geometries) g.dispose();
      try {
        mindar.stop();
      } catch {
        // Already stopped, or never fully started. Teardown must not throw — a
        // throw here leaves the camera light on.
      }
      // MindAR registers a window resize listener and never removes it (it binds
      // without keeping the reference). Its first act is `if (!video) return;`,
      // so dropping the reference neutralises the stale handler.
      (mindar as unknown as { video?: HTMLVideoElement }).video = undefined;
      mount.replaceChildren();
    };
  }, [objects]);

  const tracked = objects.filter((o) => targetIndexFor(o.id) >= 0);

  return (
    <div ref={mountRef} className="relative h-full w-full overflow-hidden bg-ink-950">
      {/* Labels are DOM, projected each frame by the loop above. */}
      {tracked.map((o, i) => (
        <div
          key={o.id}
          ref={(n) => {
            labelNodes.current[i] = n;
          }}
          className={clsx(
            "pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
            selectedRef.current === o.id
              ? "bg-go-500/25 text-go-200"
              : "bg-ink-950/75 text-fog-100",
          )}
          style={{ opacity: "0" }}
        >
          {o.label}
        </div>
      ))}

      <p className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-md bg-ink-950/75 px-2.5 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-fog-400">
        point the camera at the printed marker · tap the object to answer
      </p>
    </div>
  );
}
