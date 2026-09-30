import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ROOM, SCENERY } from "./environment";
import {
  CEILING_LAMPS,
  LIT_LAMP_INDICES,
  aoAt,
  bakeVertexColours,
  floorAoFromUv,
  wallAoAt,
  wallAoFromUv,
} from "./room-lighting";

describe("baked occlusion — the floor has to have a dark side", () => {
  test("open floor is fully lit", () => {
    // The bake can only darken, so somewhere has to be 1.0. If nothing were,
    // the whole room would be uniformly dim and the vertex colours would be
    // doing nothing but subtracting light.
    expect(aoAt(0, 0)).toBe(1);
  });

  test("floor darkens into every wall", () => {
    const open = aoAt(0, 0);
    for (const [x, z] of [
      [ROOM.width / 2 - 0.4, 0],
      [-(ROOM.width / 2 - 0.4), 0],
      [0, ROOM.depth / 2 - 0.4],
      [0, -(ROOM.depth / 2 - 0.4)],
    ] as const) {
      expect(aoAt(x, z)).toBeLessThan(open);
    }
  });

  test("a corner is darker than either of its walls", () => {
    // Being enclosed from two directions at once is a different situation from
    // either alone, and the bake has to know that.
    const cx = ROOM.width / 2 - 0.4;
    const cz = ROOM.depth / 2 - 0.4;
    expect(aoAt(cx, cz)).toBeLessThan(aoAt(cx, 0));
    expect(aoAt(cx, cz)).toBeLessThan(aoAt(0, cz));
  });

  test("the darkest place is still not black", () => {
    // A corner at zero would be a hole in the floor. Rock is dark; it is never
    // a void, and the lamp above it is still lighting it.
    expect(aoAt(ROOM.width / 2, ROOM.depth / 2)).toBeGreaterThan(0.28);
  });

  test("the range is a gradient, not two values", () => {
    // The whole point of the falloff. An earlier version clamped everything
    // below 0.42 to exactly 0.42, so the corner, the skirting and the floor
    // half a metre from the wall all rendered identically — the gradient was
    // there in the maths and absent from the room.
    expect(aoAt(0, 0)).toBe(1);
    expect(aoAt(0, ROOM.depth / 2)).toBeCloseTo(0.55, 2);
    expect(aoAt(ROOM.width / 2, ROOM.depth / 2)).toBeCloseTo(0.3025, 2);
  });

  test("occlusion falls off smoothly, with no crease", () => {
    // A linear ramp meets flat floor with a visible edge, and a hard edge in an
    // ambient term is the one artefact the eye finds instantly. Sampled in
    // small steps across the whole wall reach, every step must be a small
    // change — including the first, which is why this starts from the open
    // floor rather than from the wall.
    const start = ROOM.depth / 2 - 2.6;
    let previous = aoAt(0, start);
    for (let d = 2.55; d > 0.01; d -= 0.05) {
      const value = aoAt(0, ROOM.depth / 2 - d);
      expect(Math.abs(value - previous)).toBeLessThan(0.06);
      previous = value;
    }
  });

  test("the value is always a usable multiplier", () => {
    for (let x = -13; x <= 13; x += 1.3) {
      for (let z = -10; z <= 10; z += 1.3) {
        const ao = aoAt(x, z);
        expect(ao).toBeGreaterThan(0);
        expect(ao).toBeLessThanOrEqual(1);
        expect(Number.isFinite(ao)).toBe(true);
      }
    }
  });

  test("the conveyor lays a dark band, which is the point of it", () => {
    // The single most legible piece of occlusion in the room: a 15.6 m run of
    // belt across open floor. Without it the floor under the conveyor is as
    // bright as the aisle beside it, and the room has no idea the belt is
    // overhead.
    const belt = SCENERY.find((s) => s.kind === "conveyor")!;
    expect(aoAt(belt.x, belt.z)).toBeLessThan(0.6);
    expect(aoAt(belt.x - 5, belt.z)).toBe(1);
  });

  test("wall-mounted kit does not darken the floor in front of it", () => {
    // The hose reel hangs at 1.45 m on the back wall. Treating it as if it
    // blocked the floor would paint a shadow band across open walking room,
    // and it would be a band with nothing above it. Compared against the same
    // point with no scenery at all, so the assertion is about the kit and not
    // about how close to a wall the sample point happens to be.
    const reel = SCENERY.find((s) => s.kind === "hose-reel")!;
    expect((reel.y ?? 0)).toBeGreaterThan(0.6);
    expect(aoAt(reel.x, reel.z + 1.2, [reel])).toBe(aoAt(reel.x, reel.z + 1.2, []));
  });
});

describe("baked occlusion — walls", () => {
  test("the skirting is dark and head height is not", () => {
    expect(wallAoAt(0, 0.5)).toBeLessThan(wallAoAt(3.4, 0.5));
  });

  test("a wall is brightest away from its own ends", () => {
    // Otherwise four walls meet and read as one flat backdrop, which is the
    // exact failure the bake exists to prevent.
    expect(wallAoAt(3.4, 0.5)).toBeGreaterThan(wallAoAt(3.4, 0.02));
    expect(wallAoAt(3.4, 0.5)).toBeGreaterThan(wallAoAt(3.4, 0.98));
  });

  test("the value is always a usable multiplier", () => {
    for (let h = 0; h <= ROOM.height; h += 0.25) {
      for (let a = 0; a <= 1; a += 0.1) {
        const ao = wallAoAt(h, a);
        expect(ao).toBeGreaterThan(0);
        expect(ao).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("the vertex bake itself", () => {
  test("produces one RGB triple per vertex, laid out in order", () => {
    const colours = bakeVertexColours(4, 3, (u, v) => u * 0.5 + v * 0.5);
    expect(colours.length).toBe(4 * 3 * 3);
    // First vertex: u=0, v=0 -> 0.
    expect(colours[0]).toBe(0);
    // Last vertex: u=1, v=1 -> 1, written three times because a colour
    // attribute is RGB and the value is a scalar. Compared element-wise: a
    // Float32Array never `toEqual`s a plain array.
    expect(Array.from(colours.slice(-3))).toEqual([1, 1, 1]);
  });

  test("a single-vertex grid is centred rather than dividing by zero", () => {
    expect(bakeVertexColours(1, 1, () => 0.5)[0]).toBe(0.5);
  });

  test("the floor bake darkens the corners of the actual room", () => {
    // Through the UV mapping the renderer uses, not the position function
    // directly — the mapping is where a bake goes wrong silently.
    expect(floorAoFromUv(0.5, 0.5)).toBe(1);
    expect(floorAoFromUv(0, 0)).toBeLessThan(0.6);
    expect(floorAoFromUv(1, 1)).toBeLessThan(0.6);
    expect(floorAoFromUv(0, 1)).toBeLessThan(0.6);
  });

  test("the wall bake is dark at the bottom of the plane", () => {
    // v = 0 is the skirting on a PlaneGeometry, which is the end that must be
    // dark. Getting this upside down puts the shadow on the ceiling.
    expect(wallAoFromUv(0.5, 0)).toBeLessThan(wallAoFromUv(0.5, 1));
  });
});

describe("the lamps", () => {
  test("five, along the wide axis, inside the room", () => {
    expect(CEILING_LAMPS.length).toBe(5);
    for (const lamp of CEILING_LAMPS) {
      expect(Math.abs(lamp.x)).toBeLessThan(ROOM.width / 2);
      expect(lamp.y).toBeLessThan(ROOM.height);
      expect(lamp.y).toBeGreaterThan(ROOM.height - 1.2);
    }
  });

  test("evenly spaced, so the ceiling reads as a length", () => {
    const gaps = CEILING_LAMPS.slice(1).map((l, i) => l.x - CEILING_LAMPS[i]!.x);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 6);
  });

  test("the lit ones are the middle three", () => {
    // The trade, stated as a test so it cannot be quietly widened: a point
    // light is a term in every fragment's shading loop, forever.
    expect(LIT_LAMP_INDICES.length).toBe(3);
    for (const i of LIT_LAMP_INDICES) {
      expect(CEILING_LAMPS[i]).toBeDefined();
    }
  });

  test("the lit lamps are the central ones, not the ones at the ends", () => {
    // The two outer fittings are over the ends of a 26 m room, where the
    // baked skirting occlusion is already doing the darkening work.
    for (const i of LIT_LAMP_INDICES) {
      expect(Math.abs(CEILING_LAMPS[i]!.x)).toBeLessThanOrEqual(4);
    }
  });
});

/**
 * Phase 2's renderer settings, guarded.
 *
 * The occlusion bake and the environment map are only worth anything if the
 * material is set up to receive them, and each of these is a single line whose
 * removal is silent: the room still renders, it is just flat again.
 */
describe("phase 2 — the room cannot quietly go flat again", () => {
  const code = readFileSync("src/components/Scene3D.tsx", "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    " ",
  );

  test("floor and walls receive the baked vertex occlusion", () => {
    expect(code.match(/vertexColors:\s*true/g)?.length).toBe(2);
    // And the bake is actually installed on the geometry, not just switched on.
    expect(code).toMatch(/setAttribute\(\s*"color"/);
  });

  test("the floor is subdivided, or there is nowhere to bake to", () => {
    // A PlaneGeometry with no segments has four vertices, and four vertices
    // cannot describe a room with corners.
    expect(code).toMatch(/new PlaneGeometry\(ROOM_W, ROOM_D, 24, 18\)/);
    expect(code).toMatch(/new PlaneGeometry\(span, WALL_H, 24, 5\)/);
  });

  test("there is one image-based light, and the flat one backs off", () => {
    expect(code).toMatch(/PMREMGenerator/);
    expect(code).toMatch(/scene\.environment\s*=/);
    // The double count the comment above warns about.
    expect(code).toMatch(/tier === "low" \? 0\.2 : 0\.1/);
  });

  test("the environment map is skipped on the low tier, not just dimmed", () => {
    // `envMapIntensity: 0` is not the same as not generating it: the prefilter
    // is startup work and a mip chain is memory, and neither is worth paying
    // for a texture that contributes nothing.
    expect(code).toMatch(/if \(profileRef\.current\.tier !== "low"\) \{\s*const equirect/);
  });

  test("the room grew a ceiling worth looking at", () => {
    expect(code).toMatch(/CEILING_LAMPS/);
    expect(code).toMatch(/CylinderGeometry\(0\.62, 0\.62/);
    expect(code).toMatch(/TorusGeometry/);
  });

  test("the ceiling services are instanced, not one mesh per fitting", () => {
    // Phase 1's lesson, applied to the geometry Phase 2 added. Sixteen draw
    // calls for five lamps and four flanges would have spent a chunk of what
    // the pixel-ratio cap bought back, on objects that are all identical apart
    // from where they sit.
    expect(code).toMatch(/new InstancedMesh\(lampGeo, lampMat, CEILING_LAMPS\.length\)/);
    expect(code).toMatch(/new InstancedMesh\(lampGeo, darkMat, CEILING_LAMPS\.length\)/);
    expect(code).toMatch(/new InstancedMesh\(flangeGeo, serviceMat, 4\)/);
    // A mesh per fitting would still be here.
    expect(code).not.toMatch(/for \(const lamp of CEILING_LAMPS\) \{\s*const fitting = new Mesh/);
  });

  test("nothing in Phase 2 touched the room's size", () => {
    // A dimension change would invalidate every preset, collision radius and
    // distance fade in the product, invisibly, inside a "lighting" diff.
    expect(ROOM.width).toBe(26);
    expect(ROOM.depth).toBe(20);
    expect(ROOM.height).toBe(4.6);
  });

  test("the lamps are emissive meshes, not five more lights", () => {
    // The rule that keeps Phase 2 cheap: a light is a term in every fragment's
    // loop, forever. Five `PointLight`s would cost more than the entire
    // performance floor of Phase 1 bought back.
    //
    // Two `new PointLight(` sites and no more: one is the three sodium pools,
    // which is a loop over `LIT_LAMP_INDICES`, and one is the green glow on the
    // exit sign. A third would be a light added by Phase 2.
    expect(code.match(/new PointLight\(/g)?.length).toBe(2);
    expect(code).toMatch(/for \(const index of LIT_LAMP_INDICES\)/);
  });
});
