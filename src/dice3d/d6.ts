import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * A d6 (a cube) and the math that makes a physically rolled die land on a number chosen in
 * advance (사용자 요청: every die in the game is a six-sided one).
 *
 * The trick: the die's collision shape is the cube, which looks the same under any of its 24
 * symmetry rotations. So we can roll it with real physics, see which face ends up on top, and
 * then rotate only the numbered skin by a symmetry that puts the wanted number on that face. The
 * collider never changes, so the motion and the resting pose are exactly the simulated ones.
 */

/** The 8 corners of a cube whose faces are `half` from its centre. */
export function d6Corners(half = 1): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(new Vector3(x, y, z).multiplyScalar(half));
  return out;
}

export interface D6Face {
  /** Corner indices (into d6Corners), counter-clockwise seen from outside. */
  corners: [number, number, number, number];
  normal: Vector3;
  /** The face's centre on the unit cube (= its normal). */
  centroid: Vector3;
  /** Pips on this face (opposite faces add up to 7). */
  number: number;
}

/** Like a real die: 1 opposite 6, 2 opposite 5, 3 opposite 4. */
const LAYOUT: [Vector3, number][] = [
  [new Vector3(0, 1, 0), 1],
  [new Vector3(0, -1, 0), 6],
  [new Vector3(0, 0, 1), 2],
  [new Vector3(0, 0, -1), 5],
  [new Vector3(1, 0, 0), 3],
  [new Vector3(-1, 0, 0), 4],
];

function buildFaces(): D6Face[] {
  const v = d6Corners(1);
  return LAYOUT.map(([normal, number]) => {
    const on = v.map((c, i) => [c, i] as const).filter(([c]) => Math.abs(c.dot(normal) - 1) < 1e-9);
    // Counter-clockwise about the normal, seen from outside.
    const u = Math.abs(normal.y) > 0.5 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const w = normal.clone().cross(u);
    on.sort(([a], [b]) => Math.atan2(a.dot(w), a.dot(u)) - Math.atan2(b.dot(w), b.dot(u)));
    const corners = on.map(([, i]) => i) as D6Face['corners'];
    return { corners, normal: normal.clone(), centroid: normal.clone(), number };
  });
}

export const D6_FACES: readonly D6Face[] = buildFaces();

export function faceWithNumber(n: number): number {
  return D6_FACES.findIndex((f) => f.number === n);
}

/** Index of the face pointing most nearly straight up for a die in orientation `q`. */
export function topFace(q: Quaternion): number {
  let best = 0;
  let bestY = -Infinity;
  D6_FACES.forEach((f, i) => {
    const y = f.normal.clone().applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      best = i;
    }
  });
  return best;
}

/** Orthonormal frame of a face: its normal, the direction to its first corner, and their cross product. */
function faceFrame(i: number): Matrix4 {
  const verts = d6Corners(1);
  const f = D6_FACES[i];
  const n = f.normal.clone();
  const u = verts[f.corners[0]].clone().sub(f.centroid).normalize();
  const w = n.clone().cross(u);
  return new Matrix4().makeBasis(n, u, w);
}

/**
 * The symmetry rotation that carries face `from` onto face `to` (first corner onto first corner).
 * The rotation group of the cube acts simply transitively on (face, corner of that face) pairs,
 * so this is always one of its 24 symmetries.
 */
export function symmetryTaking(from: number, to: number): Quaternion {
  const m = faceFrame(to).multiply(faceFrame(from).transpose());
  return new Quaternion().setFromRotationMatrix(m);
}

/**
 * How to turn the numbered skin (in the die's own frame) so that, when the die rests in
 * orientation `final`, the face showing `number` is the one on top.
 */
export function skinRotationFor(number: number, final: Quaternion): Quaternion {
  return symmetryTaking(faceWithNumber(number), topFace(final));
}

/** The number a viewer reads on top of a die in orientation `final` wearing skin rotation `skin`. */
export function numberShown(final: Quaternion, skin: Quaternion): number {
  return D6_FACES[topFace(final.clone().multiply(skin))].number;
}
