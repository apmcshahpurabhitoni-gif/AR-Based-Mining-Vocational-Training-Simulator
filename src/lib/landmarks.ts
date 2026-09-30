/**
 * What you can navigate by.
 *
 * `docs/16` phase 4. A bay map is a thing you read, and a distinctive
 * silhouette is a thing you walk towards. In a 26 x 20 m room the trainee has to
 * have both, because the map is small and the room is not.
 *
 * A landmark is a **noun**. "Conveyor run", "dust extractor", "tunnel mouth".
 * It is never a sentence, and the test below fails the build if one becomes
 * one — what a thing is for and when to use it is safety copy that belongs to
 * R9's review, and a landmark list is the most tempting place in this project to
 * start writing it by accident. The names here are the same words the marker
 * vocabulary already publishes for those objects, which is the honest source:
 * they name things, they do not teach anything.
 *
 * Derived from `SCENERY` rather than maintained beside it, so a piece of
 * equipment cannot be a landmark in the panel and invisible on the map.
 */

import { EXIT_MOUTH, ROOM, SCENERY, type SceneryItem } from "./environment";

export interface Landmark {
  /** Matches the scenery item's id, or is one of the room's own features. */
  id: string;
  /** The noun shown to the trainee. Two or three words at most. */
  name: string;
  x: number;
  z: number;
  /** False for features of the shell — the tunnel mouth is a hole, not a prop. */
  hasProp: boolean;
}

/** The tunnel mouth: a feature of the shell, so it has no prop of its own. */
const TUNNEL_MOUTH: Landmark = {
  id: "tunnel-mouth",
  name: "tunnel mouth",
  x: EXIT_MOUTH.x,
  z: -ROOM.depth / 2,
  hasProp: false,
};

export const LANDMARKS: readonly Landmark[] = [
  ...SCENERY.filter((item: SceneryItem) => item.landmark !== undefined).map((item) => ({
    id: item.id,
    name: item.landmark as string,
    x: item.x,
    // A landmark on a wall is navigated to by its wall position, not by the
    // height it is mounted at.
    z: item.z,
    hasProp: true,
  })),
  TUNNEL_MOUTH,
].sort((a, b) => a.name.localeCompare(b.name));

export function landmarkById(id: string): Landmark | undefined {
  return LANDMARKS.find((l) => l.id === id);
}

/**
 * Landmarks ordered by how far they are from where the trainee is standing.
 *
 * Nearest first, because "what is near me" is the question a lost trainee is
 * actually asking, and an alphabetical list in a 26 m room answers a different
 * one.
 */
export function landmarksNear(x: number, z: number, radius = Infinity): Landmark[] {
  return LANDMARKS.filter((l) => Math.hypot(l.x - x, l.z - z) <= radius).sort(
    (a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z),
  );
}

/** Metres from a point to a landmark, for the panel's distance column. */
export const landmarkDistance = (from: { x: number; z: number }, to: Landmark): number =>
  Math.hypot(to.x - from.x, to.z - from.z);

/**
 * Which wall of the bay something is against, in words.
 *
 * Purely geometric — it is read off the coordinates, not written — and it is the
 * only sentence the description card is allowed to contain without a reviewer
 * having read it. "What it is" and "when to use it" stay empty.
 */
export function describeWhere(item: { x: number; z: number }): string {
  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;
  // Whichever wall is nearest, with a bias towards the side walls because they
  // are where equipment actually is mounted.
  const dLeft = item.x + halfW;
  const dRight = halfW - item.x;
  const dBack = item.z + halfD;
  const dFront = halfD - item.z;
  const side = Math.min(dLeft, dRight);
  const end = Math.min(dBack, dFront);
  if (side <= end) {
    return dLeft <= dRight ? "against the left wall" : "against the right wall";
  }
  return dBack <= dFront ? "against the back wall" : "against the front wall";
}
