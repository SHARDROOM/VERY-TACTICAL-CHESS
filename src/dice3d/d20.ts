import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * A d20 (regular icosahedron) and the math that makes a physically rolled die
 * land on a number chosen in advance.
 *
 * The trick: the die's collision shape is the icosahedron, which looks the same
 * under any of its 60 symmetry rotations. So we can roll it with real physics, see
 * which face ends up on top, and then rotate only the numbered skin by a symmetry
 * that puts the wanted number on that face. The collider never changes, so the
 * motion and the resting pose are exactly the simulated ones.
 */

const PHI = (1 + Math.sqrt(5)) / 2;

/** The 12 vertices, scaled so the die's circumradius is `radius`. */
export function d20Vertices(radius = 1): Vector3[] {
  const raw = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ];
  return raw.map(([x, y, z]) => new Vector3(x, y, z).normalize().multiplyScalar(radius));
}

export interface D20Face {
  /** Vertex indices, counter-clockwise seen from outside. */
  vertices: [number, number, number];
  normal: Vector3;
  centroid: Vector3;
  /** The number printed on this face (opposite faces add up to 21). */
  number: number;
}

function buildFaces(): D20Face[] {
  const v = d20Vertices(1);
  const edge = v[0].distanceTo(v[1]);
  const adjacent = (a: number, b: number) => Math.abs(v[a].distanceTo(v[b]) - edge) < 1e-6;
  const faces: D20Face[] = [];
  for (let a = 0; a < 12; a++)
    for (let b = a + 1; b < 12; b++)
      for (let c = b + 1; c < 12; c++) {
        if (!adjacent(a, b) || !adjacent(b, c) || !adjacent(a, c)) continue;
        const centroid = v[a].clone().add(v[b]).add(v[c]).divideScalar(3);
        let normal = v[b].clone().sub(v[a]).cross(v[c].clone().sub(v[a])).normalize();
        let tri: [number, number, number] = [a, b, c];
        if (normal.dot(centroid) < 0) {
          tri = [a, c, b];
          normal = normal.negate();
        }
        faces.push({ vertices: tri, normal, centroid, number: 0 });
      }
  // Number the faces so that opposite faces add up to 21, like a real d20.
  let next = 1;
  for (const f of faces) {
    if (f.number) continue;
    const opposite = faces.find((g) => g !== f && g.normal.dot(f.normal) < -0.999)!;
    f.number = next;
    opposite.number = 21 - next;
    next++;
  }
  return faces;
}

export const D20_FACES: readonly D20Face[] = buildFaces();

export function faceWithNumber(n: number): number {
  return D20_FACES.findIndex((f) => f.number === n);
}

/** Index of the face pointing most nearly straight up for a die in orientation `q`. */
export function topFace(q: Quaternion): number {
  let best = 0;
  let bestY = -Infinity;
  D20_FACES.forEach((f, i) => {
    const y = f.normal.clone().applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      best = i;
    }
  });
  return best;
}

/** Orthonormal frame of a face: its normal, the direction to its first vertex, and their cross product. */
function faceFrame(i: number): Matrix4 {
  const verts = d20Vertices(1);
  const f = D20_FACES[i];
  const n = f.normal.clone();
  const u = verts[f.vertices[0]].clone().sub(f.centroid).normalize();
  const w = n.clone().cross(u);
  return new Matrix4().makeBasis(n, u, w);
}

/**
 * The symmetry rotation that carries face `from` onto face `to` (first vertex onto first
 * vertex). The rotation group of the icosahedron acts simply transitively on (face, vertex)
 * pairs, so this is always one of its 60 symmetries.
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
  return D20_FACES[topFace(final.clone().multiply(skin))].number;
}
