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
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { ROOM, type SceneryKind } from "../environment";

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

/**
 * Build one piece of scenery.
 *
 * Scenery is context, never a target — see the header of `lib/environment.ts`
 * for why that separation is what makes a rich room safe. Nothing here is
 * returned as pickable, and the renderer must not make it so: an inert object
 * that answers a tap is indistinguishable from a graded one, and grading an id
 * no manifest knows about is the exact bug that put a fire hose reel in a gas
 * module.
 *
 * These are deliberately a little undersized relative to the real plant. A room
 * built to true scale reads as empty because the walls vanish and everything sits
 * far apart; slightly small equipment on a wide floor reads as a working bay.
 */
export function buildScenery(kind: SceneryKind, keep: (g: BufferGeometry) => BufferGeometry): Group {
  const group = new Group();

  const mat = (color: string, opts: { rough?: number; metal?: number; emissive?: string } = {}) => {
    const m = new MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0.1,
    });
    if (opts.emissive) m.emissive.set(opts.emissive);
    return m;
  };

  const put = (
    geo: BufferGeometry,
    material: MeshStandardMaterial,
    at: readonly [number, number, number],
    rot?: readonly [number, number, number],
  ) => {
    const m = new Mesh(keep(geo), material);
    m.position.set(at[0], at[1], at[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  if (kind === "conveyor") {
    // The largest object in the room and the one that makes it read as a mine:
    // a long yellow belt line on trestles.
    const steel = mat("#6b7280", { rough: 0.5, metal: 0.5 });
    const belt = mat("#c9a227", { rough: 0.85 });
    const dark = mat("#2b3038", { rough: 0.9 });
    put(new BoxGeometry(1.9, 0.32, 12), belt, [0, 1.16, 0]);
    put(new BoxGeometry(2.05, 0.12, 12.2), dark, [0, 0.96, 0]);
    for (let z = -5.5; z <= 5.5; z += 2.75) {
      put(new BoxGeometry(1.5, 0.9, 0.22), steel, [0, 0.5, z]);
    }
    // Rollers, so the belt reads as machinery from a distance.
    for (let z = -5; z <= 5; z += 1.25) {
      put(new CylinderGeometry(0.16, 0.16, 2.0, 10), steel, [0, 1.34, z], [0, 0, Math.PI / 2]);
    }
    return group;
  }

  if (kind === "switchboard") {
    // An electrical cabinet with the hazard striping every mine cabinet has.
    const shell = mat("#5a6470", { rough: 0.55, metal: 0.45 });
    const hazard = mat("#d9b310", { rough: 0.7 });
    put(new BoxGeometry(0.72, 2.0, 0.42), shell, [0, 1.0, 0]);
    put(new BoxGeometry(0.78, 0.22, 0.46), hazard, [0, 0.24, 0]);
    put(new BoxGeometry(0.5, 0.3, 0.06), mat("#111418"), [0, 1.62, 0.24]);
    for (let i = 0; i < 3; i++) {
      put(
        new CylinderGeometry(0.045, 0.045, 0.05, 8),
        mat(i === 0 ? "#ef4444" : i === 1 ? "#facc15" : "#22c55e", { emissive: "#000000" }),
        [-0.2 + i * 0.2, 1.02, 0.24],
        [Math.PI / 2, 0, 0],
      );
    }
    return group;
  }

  if (kind === "extractor") {
    // Dust extractor: a duct running into a fan housing.
    const duct = mat("#7b838f", { rough: 0.45, metal: 0.6 });
    const body = mat("#4d5560", { rough: 0.6, metal: 0.3 });
    put(new CylinderGeometry(0.42, 0.42, 1.1, 14), body, [0, 0, 0], [0, 0, Math.PI / 2]);
    put(new CylinderGeometry(0.3, 0.3, 2.4, 12), duct, [0, 0, 0], [Math.PI / 2, 0, 0]);
    put(new BoxGeometry(1.2, 1.0, 0.18), body, [0, 0, 0.55]);
    return group;
  }

  if (kind === "hose-reel") {
    // Red reel on a wall — the single most recognisable piece of fire kit.
    const red = mat("#c0392b", { rough: 0.7 });
    const hose = mat("#8e2f22", { rough: 0.95 });
    put(new BoxGeometry(0.9, 0.7, 0.22), red, [0, 0, 0]);
    put(new TorusGeometry(0.26, 0.1, 8, 18), hose, [0, 0, 0.2]);
    put(new CylinderGeometry(0.08, 0.08, 0.4, 10), red, [0, 0, 0.24], [Math.PI / 2, 0, 0]);
    return group;
  }

  if (kind === "first-aid") {
    // White box, green cross.
    const box = mat("#e5e7eb", { rough: 0.75 });
    const green = mat("#16a34a", { rough: 0.7 });
    put(new BoxGeometry(0.62, 0.5, 0.22), box, [0, 0, 0]);
    put(new BoxGeometry(0.34, 0.1, 0.03), green, [0, 0, 0.12]);
    put(new BoxGeometry(0.1, 0.34, 0.03), green, [0, 0, 0.12]);
    return group;
  }

  if (kind === "gas-monitor") {
    // Small wall unit with a lit display. The one piece of kit that is bright in
    // a dark bay, which is how a real one catches the eye.
    const shell = mat("#3f4650", { rough: 0.6 });
    put(new BoxGeometry(0.34, 0.44, 0.18), shell, [0, 0, 0]);
    put(
      new BoxGeometry(0.24, 0.14, 0.03),
      new MeshStandardMaterial({ color: "#22c55e", emissive: "#0f3d22", roughness: 0.4 }),
      [0, 0.06, 0.1],
    );
    return group;
  }

  if (kind === "phone") {
    // Emergency communication handset.
    put(new BoxGeometry(0.3, 0.5, 0.16), mat("#b45309", { rough: 0.75 }), [0, 0, 0]);
    put(new BoxGeometry(0.24, 0.44, 0.06), mat("#1f2937"), [0, 0, 0.1]);
    return group;
  }

  if (kind === "estop") {
    // Red mushroom button on a yellow post. Meant to be findable at a glance.
    const post = mat("#d9b310", { rough: 0.8 });
    put(new BoxGeometry(0.16, 1.4, 0.16), post, [0, 0.7, 0]);
    put(
      new CylinderGeometry(0.14, 0.14, 0.1, 12),
      new MeshStandardMaterial({ color: "#dc2626", emissive: "#3b0a0a", roughness: 0.6 }),
      [0, 1.1, 0.12],
      [Math.PI / 2, 0, 0],
    );
    return group;
  }

  if (kind === "bench") {
    // Work table with a scatter of parts on top.
    const wood = mat("#6b5136", { rough: 0.95 });
    const steel = mat("#4b5563", { rough: 0.5, metal: 0.5 });
    put(new BoxGeometry(2.2, 0.1, 0.9), wood, [0, 0.88, 0]);
    for (const dx of [-0.95, 0.95]) {
      for (const dz of [-0.34, 0.34]) {
        put(new BoxGeometry(0.1, 0.86, 0.1), steel, [dx, 0.43, dz]);
      }
    }
    put(new BoxGeometry(0.4, 0.16, 0.3), steel, [-0.5, 1.0, 0.1]);
    put(new BoxGeometry(0.28, 0.22, 0.28), mat("#a16207"), [0.6, 1.03, -0.1]);
    return group;
  }

  if (kind === "toolboard") {
    // Pegboard with a few hanging tools.
    put(new BoxGeometry(1.5, 1.1, 0.08), mat("#4b3f2f", { rough: 1 }), [0, 0, 0]);
    for (const [x, h] of [
      [-0.5, 0.42],
      [-0.15, 0.3],
      [0.2, 0.5],
      [0.55, 0.34],
    ] as const) {
      put(new BoxGeometry(0.06, h, 0.06), mat("#9ca3af", { metal: 0.6, rough: 0.4 }), [x, -0.1 - h / 2, 0.1]);
    }
    return group;
  }

  if (kind === "crate") {
    const wood = mat("#6b5333", { rough: 1 });
    put(new BoxGeometry(1.1, 0.8, 0.9), wood, [0, 0.4, 0]);
    put(new BoxGeometry(1.16, 0.08, 0.96), mat("#4a3823"), [0, 0.62, 0]);
    return group;
  }

  if (kind === "rock") {
    // Broken rock. Deterministic irregular scaling — three.js has no noise
    // displacement here, and a scaled icosahedron faceted by flat shading reads
    // as rock at the distances that matter without a geometry pass per boulder.
    const stone = mat("#5b5348", { rough: 1 });
    put(new IcosahedronGeometry(0.85, 0), stone, [0, 0.34, 0], [0.4, 0.9, 0.2]).scale.set(1.5, 0.75, 1.2);
    put(new IcosahedronGeometry(0.5, 0), mat("#4c453c", { rough: 1 }), [0.9, 0.2, 0.5], [0.9, 0.2, 0.6]).scale.set(1.1, 0.8, 1.0);
    return group;
  }

  if (kind === "assembly-yard") {
    // A painted square on the floor with a post and a board over it.
    //
    // The board is blank on purpose. What stands at an assembly point says what
    // to do when you get there, and that is safety copy — R9's, not a
    // renderer's. The painted square is geometry; the words are not, so the
    // words are absent until the review lands.
    const paint = mat("#c9a227", { rough: 0.95 });
    const post = mat("#8a919b", { rough: 0.5, metal: 0.5 });
    const board = mat("#e8eaed", { rough: 0.7 });
    for (const [dx, dz, w, d] of [
      [0, -1.6, 3.2, 0.22],
      [0, 1.6, 3.2, 0.22],
      [-1.6, 0, 0.22, 3.2],
      [1.6, 0, 0.22, 3.2],
    ] as const) {
      put(new BoxGeometry(w, 0.03, d), paint, [dx, 0.015, dz]);
    }
    put(new CylinderGeometry(0.07, 0.07, 2.3, 8), post, [0, 1.15, 0]);
    put(new BoxGeometry(1.1, 0.7, 0.07), board, [0, 2.4, 0]);
    return group;
  }

  if (kind === "refuge-alcove") {
    // A chamber built into the side of the bay: three solid walls, an open face,
    // and a bench inside. It reads as a refuge at a glance because of the
    // silhouette — a box in a bay full of open floor.
    const shell = mat("#9aa3ad", { rough: 0.7, metal: 0.2 });
    const frame = mat("#16a34a", { rough: 0.7 });
    const seat = mat("#4b5563", { rough: 0.85 });
    put(new BoxGeometry(2.6, 2.6, 0.16), shell, [0, 1.3, -1.2]);
    put(new BoxGeometry(0.16, 2.6, 2.4), shell, [-1.3, 1.3, 0]);
    put(new BoxGeometry(0.16, 2.6, 2.4), shell, [1.3, 1.3, 0]);
    put(new BoxGeometry(2.9, 0.18, 2.6), shell, [0, 2.7, 0]);
    // The green frame round the opening: the one piece of the room a trainee
    // can find from across the floor, which is the entire job of it here.
    put(new BoxGeometry(2.6, 0.16, 0.2), frame, [0, 2.5, 1.2]);
    for (const dx of [-1.3, 1.3]) put(new BoxGeometry(0.2, 2.6, 0.2), frame, [dx, 1.3, 1.2]);
    put(new BoxGeometry(1.8, 0.12, 0.5), seat, [0, 0.62, -0.85]);
    for (const dx of [-0.8, 0.8]) put(new BoxGeometry(0.1, 0.56, 0.4), seat, [dx, 0.3, -0.85]);
    return group;
  }

  if (kind === "generator-cage") {
    // A mesh cage with a genset inside. The bars are the silhouette: a box you
    // can see into, which is why it is drawn as a frame rather than a solid.
    const bar = mat("#6b7280", { rough: 0.5, metal: 0.6 });
    const plant = mat("#b45309", { rough: 0.7 });
    const skid = mat("#374151", { rough: 0.8 });
    put(new BoxGeometry(2.2, 0.16, 1.6), skid, [0, 0.08, 0]);
    put(new BoxGeometry(1.5, 0.9, 1.0), plant, [0, 0.6, 0]);
    put(new CylinderGeometry(0.16, 0.16, 0.7, 10), bar, [0.55, 1.35, 0]);
    for (let i = -1; i <= 1; i++) {
      for (const dz of [-0.8, 0.8]) {
        put(new BoxGeometry(0.07, 2.0, 0.07), bar, [i * 1.1, 1.0, dz]);
      }
      for (const dx of [-1.1, 1.1]) {
        put(new BoxGeometry(0.07, 2.0, 0.07), bar, [dx, 1.0, i * 0.8]);
      }
    }
    for (const y of [0.2, 1.0, 1.8]) {
      put(new BoxGeometry(2.3, 0.06, 0.06), bar, [0, y, -0.8]);
      put(new BoxGeometry(2.3, 0.06, 0.06), bar, [0, y, 0.8]);
    }
    for (let i = -2; i <= 2; i++) {
      put(new BoxGeometry(0.05, 1.8, 0.05), bar, [i * 0.44, 1.0, -0.8]);
      put(new BoxGeometry(0.05, 1.8, 0.05), bar, [i * 0.44, 1.0, 0.8]);
    }
    return group;
  }

  if (kind === "gas-rack") {
    // Bottles in a rack. Bands and a valve cap each, so a row of them reads as
    // cylinders rather than as a row of pillars.
    const bottle = mat("#2f6f4f", { rough: 0.6, metal: 0.3 });
    const band = mat("#d9b310", { rough: 0.7 });
    const frame = mat("#5a6470", { rough: 0.5, metal: 0.5 });
    put(new BoxGeometry(2.0, 0.1, 0.8), frame, [0, 0.05, 0]);
    for (const dx of [-0.95, 0.95]) put(new BoxGeometry(0.08, 1.4, 0.8), frame, [dx, 0.7, 0]);
    for (const [i, dx] of [-0.62, 0, 0.62].entries()) {
      const h = 1.25 - (i === 1 ? 0.12 : 0);
      put(new CylinderGeometry(0.21, 0.21, h, 12), bottle, [dx, 0.1 + h / 2, 0]);
      put(new CylinderGeometry(0.22, 0.22, 0.07, 12), band, [dx, 0.1 + h * 0.55, 0]);
      put(new CylinderGeometry(0.09, 0.11, 0.16, 8), frame, [dx, 0.1 + h + 0.07, 0]);
    }
    return group;
  }

  if (kind === "monitor") {
    // A wall screen. Lit, because in a bay this dark a screen is the brightest
    // thing on the wall and that is exactly how one catches the eye.
    put(new BoxGeometry(1.5, 0.86, 0.1), mat("#2b3038", { rough: 0.5 }), [0, 0, 0]);
    put(
      new BoxGeometry(1.36, 0.72, 0.03),
      new MeshStandardMaterial({ color: "#1d4ed8", emissive: "#0b1f4d", roughness: 0.35 }),
      [0, 0, 0.06],
    );
    put(new BoxGeometry(0.4, 0.1, 0.06), mat("#111418"), [0, -0.52, 0.05]);
    return group;
  }

  if (kind === "whiteboard") {
    // A whiteboard, wiped. The writing on it is the training content and is
    // not authored here; an empty board is the honest pending state.
    put(new BoxGeometry(1.8, 1.15, 0.07), mat("#f4f5f7", { rough: 0.35 }), [0, 0, 0]);
    put(new BoxGeometry(1.9, 1.25, 0.05), mat("#9aa3ad", { rough: 0.5, metal: 0.4 }), [0, 0, -0.04]);
    put(new BoxGeometry(1.7, 0.05, 0.1), mat("#6b7280", { rough: 0.5 }), [0, -0.62, 0.06]);
    return group;
  }

  if (kind === "chair") {
    // A stool. Three legs and a seat is the whole silhouette at the distances
    // this room is seen from.
    const frame = mat("#4b5563", { rough: 0.5, metal: 0.5 });
    const seat = mat("#6b5136", { rough: 0.9 });
    put(new CylinderGeometry(0.28, 0.28, 0.08, 12), seat, [0, 0.46, 0]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      put(new CylinderGeometry(0.03, 0.03, 0.46, 6), frame, [Math.cos(a) * 0.18, 0.23, Math.sin(a) * 0.18], [
        Math.sin(a) * 0.12,
        0,
        -Math.cos(a) * 0.12,
      ]);
    }
    return group;
  }

  // pipe-run — the service line across the roof.
  put(
    new CylinderGeometry(0.14, 0.14, ROOM.width - 1.2, 10),
    mat("#7d6a4a", { rough: 0.6, metal: 0.3 }),
    [0, 0, 0],
    [0, 0, Math.PI / 2],
  );
  return group;
}
