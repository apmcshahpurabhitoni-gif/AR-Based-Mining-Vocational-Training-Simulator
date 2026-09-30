/**
 * The geometry of every object a trainee can see.
 *
 * ---------------------------------------------------------------------------
 * Why this is shared
 * ---------------------------------------------------------------------------
 *
 * Both presentation surfaces draw the same objects: the 3D room (`Scene3D`) and
 * the camera AR view (`SceneAR`). Before this module each had its own copy, which
 * is exactly how two renderers drift — an extinguisher gains a nozzle in one
 * view and not the other, and the object a trainee learns to recognise in the
 * room is not quite the object they see over the camera.
 *
 * The assessment does not depend on this file. It is shape only: it says a gas
 * cylinder is tall and round so the trainee can find it, and says nothing about
 * what is correct near one. That is R9's job, not a renderer's.
 *
 * No authored models. docs/04: "nothing downloaded, nothing scraped, nothing
 * licensed from a vendor" — every prop is primitive geometry assembled at
 * runtime, which is why there is no asset pipeline to fund or to break.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";

export type PropKind =
  | "sign"
  | "extinguisher"
  | "cylinder"
  | "valve"
  | "shelter"
  | "ppe"
  | "person"
  | "actuator"
  | "case";

export function kindOf(id: string): PropKind {
  if (id.includes("extinguisher")) return "extinguisher";
  if (id.includes("cylinder")) return "cylinder";
  if (id.includes("valve")) return "valve";
  if (id.includes("chamber") || id.includes("station")) return "shelter";
  // Interactable families. A person is a person. Respiratory gear is worn, so
  // it is a compact object at hand height. The PASS elements are parts you
  // operate on an extinguisher, so they sit on a plinth like the tool would.
  if (id.startsWith("person-")) return "person";
  if (id === "sampler" || id === "cloth-mask" || id === "canvas-gloves") return "ppe";
  if (id === "pull-pin" || id === "squeeze" || id === "aim-base" || id === "sweep") {
    return "actuator";
  }
  // A choice with nothing physical of its own — a buddy-system option, a
  // return-to-work decision — is presented as a labelled case. It is a real
  // thing to select, just not a thing you would find bolted to a wall.
  if (id === "co2" || id === "water" || id === "abc" || id === "foam") return "extinguisher";
  return "case";
}

/** Approximate footprint in metres, used for spacing and for pushback. */
export const radiusOf = (kind: PropKind) => (kind === "shelter" ? 1.0 : 0.6);

export interface BuiltProp {
  group: Group;
  /** Meshes that should be pickable by a tap. */
  meshes: Mesh[];
  /** Height of the object's label anchor above its base, in metres. */
  anchorY: number;
}

/**
 * Build one prop.
 *
 * Every mesh it returns is pickable, because a sign you have to hit on a 42 cm
 * face is not a tap target, it is a dexterity test — and on a phone at arm's
 * length it is a coin toss.
 *
 * `keep` receives each geometry so the caller can dispose it. Disposal differs
 * between the two surfaces (the room tracks what it built; the AR view tears the
 * whole scene down), so it is injected rather than assumed.
 */
export function buildProp(
  kind: PropKind,
  bodyMat: MeshStandardMaterial,
  keep: (geometry: BufferGeometry) => BufferGeometry,
): BuiltProp {
  const group = new Group();
  const meshes: Mesh[] = [];

  const add = (geo: BufferGeometry, y: number) => {
    const m = new Mesh(keep(geo), bodyMat);
    m.position.set(0, y, 0);
    // Cast, so the prop sits on the floor instead of hovering over it.
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    meshes.push(m);
    return m;
  };

  if (kind === "extinguisher") {
    add(new CylinderGeometry(0.17, 0.17, 0.86, 14), 0.58);
    add(new CylinderGeometry(0.07, 0.09, 0.2, 10), 1.1);
    add(new BoxGeometry(0.3, 0.06, 0.08), 1.22);
    return { group, meshes, anchorY: 1.5 };
  }

  if (kind === "cylinder") {
    // Gas bottles are tall, narrow and banded. The bands are what make it
    // read as a gas bottle at a glance rather than as a pillar.
    add(new CylinderGeometry(0.24, 0.24, 1.5, 14), 0.75);
    add(new CylinderGeometry(0.11, 0.13, 0.18, 10), 1.58);
    add(new CylinderGeometry(0.255, 0.255, 0.09, 14), 0.55);
    add(new CylinderGeometry(0.255, 0.255, 0.09, 14), 1.0);
    return { group, meshes, anchorY: 1.95 };
  }

  if (kind === "valve") {
    add(new BoxGeometry(0.46, 0.46, 0.3), 1.35);
    const wheel = new Mesh(keep(new TorusGeometry(0.26, 0.055, 8, 18)), bodyMat);
    wheel.position.set(0, 1.35, 0.3);
    wheel.castShadow = true;
    group.add(wheel);
    meshes.push(wheel);
    return { group, meshes, anchorY: 1.95 };
  }

  if (kind === "shelter") {
    add(new BoxGeometry(1.5, 2.0, 1.0), 1.0);
    add(new BoxGeometry(1.7, 0.12, 1.2), 2.06);
    return { group, meshes, anchorY: 2.5 };
  }

  if (kind === "person") {
    // Someone waiting to be counted. Legs, body, head — enough silhouette that
    // three of them in a row read as three people and not as three markers,
    // which is the distinction the withdrawal-order step tests.
    add(new CylinderGeometry(0.15, 0.13, 0.85, 8), 0.42);
    add(new CylinderGeometry(0.26, 0.22, 0.72, 10), 1.2);
    add(new SphereGeometry(0.17, 12, 10), 1.73);
    return { group, meshes, anchorY: 2.05 };
  }

  if (kind === "ppe") {
    // Worn kit: compact, at hand height, on a stand.
    add(new CylinderGeometry(0.07, 0.07, 1.0, 8), 0.5);
    add(new BoxGeometry(0.44, 0.34, 0.26), 1.2);
    return { group, meshes, anchorY: 1.62 };
  }

  if (kind === "actuator") {
    // A part you operate, on a plinth. The P-A-S-S steps are four separate
    // stations, so each is a thing you walk up to rather than four labels on
    // one extinguisher.
    add(new BoxGeometry(0.9, 0.7, 0.9), 0.35);
    add(new CylinderGeometry(0.13, 0.13, 0.5, 10), 0.95);
    return { group, meshes, anchorY: 1.35 };
  }

  if (kind === "case") {
    // A labelled case: a decision with no physical form of its own.
    add(new BoxGeometry(0.85, 0.85, 0.5), 0.43);
    add(new BoxGeometry(0.95, 0.12, 0.6), 0.92);
    return { group, meshes, anchorY: 1.25 };
  }

  // sign — a board on a post, angled so the raycaster has a broad face.
  add(new CylinderGeometry(0.07, 0.07, 2.1, 8), 1.05);
  const board = new Mesh(keep(new BoxGeometry(1.15, 0.42, 0.1)), bodyMat);
  board.position.set(0, 2.25, 0);
  board.rotation.y = Math.PI / 4;
  board.castShadow = true;
  group.add(board);
  meshes.push(board);
  return { group, meshes, anchorY: 2.7 };
}
