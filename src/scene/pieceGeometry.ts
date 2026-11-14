import { LatheGeometry, Vector2 } from 'three';
import type { PieceType } from '../engine';

// Profiles are [radius, height] pairs from the base upward, in square units.
const PROFILES: Record<PieceType, [number, number][]> = {
  pawn: [[0, 0], [0.3, 0], [0.3, 0.06], [0.22, 0.12], [0.12, 0.3], [0.1, 0.38], [0.17, 0.42], [0.18, 0.5], [0.14, 0.6], [0, 0.63]],
  rook: [[0, 0], [0.32, 0], [0.32, 0.06], [0.24, 0.14], [0.19, 0.5], [0.25, 0.56], [0.25, 0.72], [0.17, 0.72], [0.17, 0.66], [0, 0.66]],
  knight: [[0, 0], [0.32, 0], [0.32, 0.06], [0.24, 0.14], [0.18, 0.36], [0.22, 0.4], [0, 0.42]],
  bishop: [[0, 0], [0.31, 0], [0.31, 0.06], [0.23, 0.14], [0.13, 0.5], [0.2, 0.56], [0.12, 0.6], [0.17, 0.72], [0.12, 0.84], [0.05, 0.88], [0, 0.9]],
  queen: [[0, 0], [0.33, 0], [0.33, 0.06], [0.25, 0.14], [0.14, 0.62], [0.23, 0.68], [0.15, 0.74], [0.22, 0.92], [0.12, 0.96], [0.07, 1.02], [0, 1.04]],
  king: [[0, 0], [0.34, 0], [0.34, 0.06], [0.26, 0.14], [0.15, 0.68], [0.24, 0.74], [0.16, 0.8], [0.2, 0.98], [0, 1.0]],
};

const cache = new Map<PieceType, LatheGeometry>();

export function pieceBodyGeometry(type: PieceType): LatheGeometry {
  let g = cache.get(type);
  if (!g) {
    g = new LatheGeometry(PROFILES[type].map(([r, h]) => new Vector2(r, h)), 32);
    cache.set(type, g);
  }
  return g;
}
