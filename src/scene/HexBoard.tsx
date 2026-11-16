import { useMemo } from 'react';
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, SRGBColorSpace } from 'three';
import { AIR, fileOf, halfOf, rankOf, squareToWorldPlane, type Square } from './hexPlane';
import { HEX_FRAME_R } from './coords';

/*
 * The three-player hexagon on the table (docs/SPEC.md, "3인 육각 맵"): a six-sided wooden frame,
 * the 96 squares as flat tiles (each a quadrilateral, wider toward the centre), and the files and
 * ranks named along each player's side, facing that player.
 */

const DARK = '#a97c50';
const LIGHT = '#ecd9b8';

/** A flat tile over a square's four corners, a hair above the board. */
export function tileGeometry(sq: Square, y = 0, inset = 0): BufferGeometry {
  const c = squareToWorldPlane(sq);
  const mid = c.reduce((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4], [0, 0]);
  const pts = c.map(([x, z]) => [x + (mid[0] - x) * inset, z + (mid[1] - z) * inset]);
  const g = new BufferGeometry();
  // Two triangles, facing up.
  const tri = [0, 1, 2, 0, 2, 3];
  g.setAttribute('position', new Float32BufferAttribute(tri.flatMap((i) => [pts[i][0], y, pts[i][1]]), 3));
  g.computeVertexNormals();
  return g;
}

const labelCache = new Map<string, CanvasTexture>();
function labelTexture(text: string): CanvasTexture {
  let t = labelCache.get(text);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#cbb994';
    ctx.font = '600 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 34);
    t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    labelCache.set(text, t);
  }
  return t;
}

/** The frame (a six-sided slab) with the files along each back rank and the ranks along the flanks. */
export function HexFrame() {
  const labels = useMemo(() => {
    const out: { text: string; x: number; z: number; turn: number }[] = [];
    for (let sq = 0; sq < AIR; sq++) {
      const h = halfOf(sq);
      const [x, z] = squareCentre(sq);
      // Outward from the centre, through the square: the label sits just past the board's edge.
      // Turned so each side's labels read the right way up for the player sitting there.
      const turn = [0, (2 * Math.PI) / 3, (-2 * Math.PI) / 3][h];
      if (rankOf(sq) === 0) {
        // Under the back rank, beyond the edge toward its owner.
        const [dx, dz] = [Math.sin(turn), Math.cos(turn)];
        out.push({ text: 'abcdefgh'[fileOf(sq)], x: x + dx * 0.78, z: z + dz * 0.78, turn });
      }
      if (fileOf(sq) === 0 || fileOf(sq) === 7) {
        const [ax, az] = edgeOutward(sq);
        out.push({ text: String(rankOf(sq) + 1), x: x + ax * 0.78, z: z + az * 0.78, turn });
      }
    }
    return out;
  }, []);
  return (
    <group>
      <mesh position={[0, -0.12, 0]} rotation={[0, 0, 0]} receiveShadow>
        <cylinderGeometry args={[HEX_FRAME_R, HEX_FRAME_R, 0.2, 6]} />
        <meshStandardMaterial color="#3a2a1e" roughness={0.8} />
      </mesh>
      {labels.map((l, i) => (
        <mesh key={i} position={[l.x, 0.001, l.z]} rotation={[-Math.PI / 2, 0, l.turn]}>
          <planeGeometry args={[0.36, 0.36]} />
          <meshBasicMaterial map={labelTexture(l.text)} transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** A square's centre on the table (x, z). */
function squareCentre(sq: Square): [number, number] {
  const c = squareToWorldPlane(sq);
  return [c.reduce((s, p) => s + p[0], 0) / 4, c.reduce((s, p) => s + p[1], 0) / 4];
}
/** Outward across a flank square's outer edge (file a: its left side, file h: its right), unit length. */
function edgeOutward(sq: Square): [number, number] {
  const c = squareToWorldPlane(sq);
  // Corners: (file, rank), (file+1, rank), (file+1, rank+1), (file, rank+1).
  const [a, b] = fileOf(sq) === 0 ? [c[0], c[3]] : [c[1], c[2]];
  const [mx, mz] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [cx, cz] = squareCentre(sq);
  const len = Math.hypot(mx - cx, mz - cz) || 1;
  return [(mx - cx) / len, (mz - cz) / len];
}

/** The tile colour of a square (a1 dark, as on any board). */
export const tileColor = (sq: Square): string => ((fileOf(sq) + rankOf(sq)) % 2 === 0 ? DARK : LIGHT);
