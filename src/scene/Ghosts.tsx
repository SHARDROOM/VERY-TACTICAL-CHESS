import { useMemo } from 'react';
import { DoubleSide, MeshBasicMaterial } from 'three';
import type { Color, RemainsMark } from '../engine';
import { squareToWorld } from './coords';
import { pieceParts } from './pieceGeometry';
import { knightFacing } from './PieceMesh';

/** A faint tint per side: the remains look like the piece's ghost. */
const GHOST_TINT: Record<Color, string> = { white: '#dfe9ff', black: '#6c6a82', red: '#ff9c8c', gray: '#b9b9b9' };

/** One material per side and strength (the remains fade with the turns they have left). */
const materials = new Map<string, MeshBasicMaterial>();
function ghostMaterial(color: Color, turnsLeft: number): MeshBasicMaterial {
  const key = `${color}:${turnsLeft}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshBasicMaterial({ color: GHOST_TINT[color], transparent: true, opacity: 0.1 + 0.06 * Math.min(3, turnsLeft), depthWrite: false, side: DoubleSide });
    materials.set(key, m);
  }
  return m;
}

/**
 * The remains (유해) of pieces that fell lately: a faint, still outline of each on the square where
 * it fell, fainter as its turns run out (one per square, the newest). Reviving it there is easier.
 * Still on purpose: nothing here moves, so the table is not redrawn for it (see renderPace).
 */
export function Ghosts({ remains }: { remains: readonly RemainsMark[] }) {
  const shown = useMemo(() => {
    const bySquare = new Map<number, RemainsMark>();
    for (const r of remains) bySquare.set(r.at, r);
    return [...bySquare.values()];
  }, [remains]);
  return (
    <group>
      {shown.map((r) => {
        const [x, y, z] = squareToWorld(r.at);
        const mat = ghostMaterial(r.color, r.turnsLeft);
        return (
          <group key={r.pieceId} position={[x, y + 0.01, z]} rotation={[0, r.type === 'knight' ? knightFacing(r.color, x, z) : 0, 0]} scale={0.92}>
            {pieceParts(r.type).map((part, i) => (
              <mesh key={i} geometry={part.geometry} material={mat} position={part.position} rotation={part.rotation} raycast={() => null} renderOrder={2} />
            ))}
          </group>
        );
      })}
    </group>
  );
}
