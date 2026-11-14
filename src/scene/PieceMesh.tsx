import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Group } from 'three';
import type { Piece } from '../engine';
import { pieceBodyGeometry } from './pieceGeometry';

const COLORS = { white: '#ece4cf', black: '#3b3b46' } as const;

interface Props {
  piece: Piece;
  position: [number, number, number];
  selected: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}

/**
 * One chess piece. All piece visuals live here so they can later be swapped
 * for model files without touching the rest of the scene.
 */
export function PieceMesh({ piece, position, selected, onClick }: Props) {
  const group = useRef<Group>(null);
  const color = COLORS[piece.color];
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

  const facing = piece.color === 'white' ? Math.PI : 0;
  const material = <meshStandardMaterial color={color} roughness={0.45} metalness={0.1} />;

  return (
    <group
      ref={group}
      position={position}
      onClick={onClick}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <mesh geometry={pieceBodyGeometry(piece.type)} castShadow>
        {material}
      </mesh>
      {piece.type === 'knight' && (
        <group rotation={[0, facing, 0]}>
          <mesh position={[0, 0.58, 0.02]} rotation={[0.35, 0, 0]} castShadow>
            <boxGeometry args={[0.2, 0.36, 0.26]} />
            {material}
          </mesh>
          <mesh position={[0, 0.66, 0.2]} rotation={[0.9, 0, 0]} castShadow>
            <boxGeometry args={[0.17, 0.3, 0.16]} />
            {material}
          </mesh>
        </group>
      )}
      {piece.type === 'king' && (
        <>
          <mesh position={[0, 1.1, 0]} castShadow>
            <boxGeometry args={[0.06, 0.22, 0.06]} />
            {material}
          </mesh>
          <mesh position={[0, 1.12, 0]} castShadow>
            <boxGeometry args={[0.18, 0.06, 0.06]} />
            {material}
          </mesh>
        </>
      )}
    </group>
  );
}
