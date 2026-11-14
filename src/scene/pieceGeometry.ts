import {
  BoxGeometry,
  BufferGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  SphereGeometry,
  SplineCurve,
  Vector2,
} from 'three';
import type { PieceType } from '../engine';

// All sizes are in board squares (1 = one square). Profiles are [radius, height] from the base upward.

/** Shared foot: a wide, slightly rounded base with a small step. */
const FOOT: [number, number][] = [
  [0.34, 0], [0.35, 0.025], [0.34, 0.06], [0.3, 0.085], [0.31, 0.1], [0.3, 0.115], [0.26, 0.13],
];

const BODY: Record<Exclude<PieceType, 'knight'>, [number, number][]> = {
  pawn: [[0.2, 0.16], [0.145, 0.24], [0.115, 0.32], [0.105, 0.355], [0.17, 0.37], [0.175, 0.39], [0.1, 0.405], [0.06, 0.42]],
  rook: [[0.24, 0.16], [0.205, 0.26], [0.19, 0.42], [0.195, 0.5], [0.235, 0.53], [0.25, 0.57], [0.25, 0.66], [0.19, 0.665], [0.185, 0.62], [0.1, 0.62]],
  bishop: [[0.22, 0.16], [0.155, 0.27], [0.115, 0.42], [0.11, 0.48], [0.18, 0.505], [0.185, 0.525], [0.11, 0.545], [0.1, 0.56], [0.13, 0.6], [0.15, 0.67], [0.135, 0.74], [0.09, 0.8], [0.04, 0.84]],
  queen: [[0.23, 0.16], [0.16, 0.28], [0.12, 0.45], [0.11, 0.58], [0.19, 0.615], [0.195, 0.64], [0.12, 0.665], [0.12, 0.7], [0.15, 0.76], [0.2, 0.86], [0.21, 0.885], [0.17, 0.9], [0.1, 0.915], [0.05, 0.93]],
  king: [[0.24, 0.16], [0.17, 0.28], [0.13, 0.46], [0.12, 0.62], [0.2, 0.655], [0.205, 0.68], [0.13, 0.705], [0.13, 0.74], [0.16, 0.8], [0.2, 0.9], [0.2, 0.925], [0.13, 0.94], [0.08, 0.97], [0.04, 0.99]],
};

const KNIGHT_BODY: [number, number][] = [[0.24, 0.16], [0.21, 0.21], [0.22, 0.245], [0.18, 0.26], [0.1, 0.265]];

/**
 * Pieces are designed compactly, then stretched vertically above the foot so
 * they stand at roughly tournament (Staunton) proportions: king ≈ 1.6 squares
 * tall, pawn ≈ 0.9. Round parts (balls, beads) are moved, not squashed.
 */
const FOOT_TOP = 0.13;
const TALL = 1.4;
const stretch = (y: number) => (y <= FOOT_TOP ? y : FOOT_TOP + (y - FOOT_TOP) * TALL);

function lathe(profile: [number, number][]): LatheGeometry {
  // Smooth the profile, keeping the axis endpoints exact so the solid is closed.
  const pts = profile.map(([r, h]) => new Vector2(r, stretch(h)));
  const smooth = new SplineCurve(pts).getPoints(pts.length * 6);
  const first = smooth[0];
  const last = smooth[smooth.length - 1];
  return new LatheGeometry([new Vector2(0, first.y), ...smooth, new Vector2(0, last.y)], 56);
}

/** Horse head silhouette in the XY plane (x = forward), extruded and bevelled. */
function knightHead(): BufferGeometry {
  const s = new Shape();
  s.moveTo(-0.19, 0);
  s.splineThru([
    new Vector2(-0.215, 0.12),
    new Vector2(-0.19, 0.27),
    new Vector2(-0.12, 0.4),
    new Vector2(-0.06, 0.47),
  ]);
  s.lineTo(-0.035, 0.56); // ear tip
  s.lineTo(0.02, 0.47);
  s.splineThru([new Vector2(0.11, 0.43), new Vector2(0.19, 0.34), new Vector2(0.245, 0.24)]);
  s.splineThru([new Vector2(0.25, 0.19), new Vector2(0.21, 0.16)]); // muzzle
  s.splineThru([new Vector2(0.13, 0.17), new Vector2(0.05, 0.2)]); // jaw
  s.splineThru([new Vector2(0.01, 0.15), new Vector2(0.06, 0.06), new Vector2(0.13, 0)]); // throat, chest
  s.lineTo(-0.19, 0);
  const depth = 0.17;
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 6,
    curveSegments: 16,
  });
  g.translate(0, 0, -depth / 2);
  // Sculpt the slab: narrow the muzzle and ears so it reads as a head from every angle.
  const pos = g.attributes.position;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const f = 1 - 0.38 * clamp01((x - 0.04) / 0.2) - 0.35 * clamp01((y - 0.42) / 0.14);
    pos.setZ(i, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

export interface PiecePart {
  geometry: BufferGeometry;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Rendered in the accent (detail) material instead of the body material. */
  accent?: boolean;
}

/** Parts in the piece's local frame; for knights, +x faces the opponent before the caller rotates it. */
function buildParts(type: PieceType): PiecePart[] {
  switch (type) {
    case 'pawn':
      return [{ geometry: lathe([...FOOT, ...BODY.pawn]) }, { geometry: new SphereGeometry(0.125, 40, 28), position: [0, 0.52, 0] }];
    case 'rook': {
      const merlons: PiecePart[] = Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return {
          geometry: new BoxGeometry(0.1, 0.075, 0.07),
          position: [Math.cos(a) * 0.215, 0.695, Math.sin(a) * 0.215],
          rotation: [0, -a + Math.PI / 2, 0],
        };
      });
      return [{ geometry: lathe([...FOOT, ...BODY.rook]) }, ...merlons];
    }
    case 'bishop':
      return [
        { geometry: lathe([...FOOT, ...BODY.bishop]) },
        { geometry: new SphereGeometry(0.04, 20, 14), position: [0, 0.875, 0] },
        { geometry: new BoxGeometry(0.31, 0.02, 0.05), position: [0.02, 0.7, 0], rotation: [0, 0, 0.75], accent: true },
      ];
    case 'queen': {
      const beads: PiecePart[] = Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        return { geometry: new SphereGeometry(0.034, 16, 12), position: [Math.cos(a) * 0.195, 0.9, Math.sin(a) * 0.195] };
      });
      return [
        { geometry: lathe([...FOOT, ...BODY.queen]) },
        ...beads,
        { geometry: new SphereGeometry(0.055, 24, 16), position: [0, 0.97, 0] },
      ];
    }
    case 'king':
      return [
        { geometry: lathe([...FOOT, ...BODY.king]) },
        { geometry: new BoxGeometry(0.05, 0.2, 0.05), position: [0, 1.08, 0] },
        { geometry: new BoxGeometry(0.15, 0.05, 0.05), position: [0, 1.1, 0] },
      ];
    case 'knight':
      return [
        { geometry: lathe([...FOOT, ...KNIGHT_BODY]) },
        { geometry: knightHead().scale(1.15, 1.5, 1.15), position: [-0.02, 0.24, 0] },
      ];
  }
}

const cache = new Map<PieceType, PiecePart[]>();

export function pieceParts(type: PieceType): PiecePart[] {
  let parts = cache.get(type);
  if (!parts) {
    parts = buildParts(type).map((p) =>
      p.position ? { ...p, position: [p.position[0], stretch(p.position[1]), p.position[2]] as [number, number, number] } : p,
    );
    cache.set(type, parts);
  }
  return parts;
}
