import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Group } from 'three';
import type { Piece } from '../engine';
import { pieceParts } from './pieceGeometry';

const LOOK = {
  white: { body: '#efe5cf', accent: '#5a4632', sheen: 0.55 },
  black: { body: '#2e2b31', accent: '#b89a5e', sheen: 0.75 },
} as const;

interface Props {
  piece: Piece;
  position: [number, number, number];
  selected: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}

/**
 * One chess piece. All piece visuals live here and in pieceGeometry, so they
 * can later be swapped for model files without touching the rest of the scene.
 */
export function PieceMesh({ piece, position, selected, onClick }: Props) {
  const group = useRef<Group>(null);
  const look = LOOK[piece.color];
  const lift = selected ? 0.25 : 0;

  // Glide toward the target square: gives every move a short animation.
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 12);
    g.position.x += (position[0] - g.position.x) * k;
    g.position.z += (position[2] - g.position.z) * k;
    g.position.y += (position[1] + lift - g.position.y) * k;
  });

  // Knights look toward the opponent, turned toward the board's centre line so
  // their profile (not the thin front) is what the players see.
  const KNIGHT_TURN = 0.9;
  const inward = position[0] < 0 ? 1 : -1;
  const facing =
    piece.type === 'knight'
      ? piece.color === 'white'
        ? Math.PI / 2 - inward * KNIGHT_TURN
        : -Math.PI / 2 + inward * KNIGHT_TURN
      : 0;

  return (
    <group
      ref={group}
      position={position}
      onClick={onClick}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <group rotation={[0, facing, 0]}>
        {pieceParts(piece.type).map((part, i) => (
          <mesh key={i} geometry={part.geometry} position={part.position} rotation={part.rotation} castShadow receiveShadow>
            <meshPhysicalMaterial
              color={part.accent ? look.accent : look.body}
              roughness={0.32}
              clearcoat={look.sheen}
              clearcoatRoughness={0.25}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
