import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Group } from 'three';
import { CORE_TAGS, RIDE, SHIELD, STUN, hasTag, type Color, type Piece, type PieceType } from '../engine';
import { PIECE_HEIGHT, pieceParts } from './pieceGeometry';
import { ShieldBubble, StunStars, TagLabel } from './TagEffects';

const LOOK = {
  white: { body: '#efe5cf', accent: '#5a4632', sheen: 0.55 },
  black: { body: '#2e2b31', accent: '#b89a5e', sheen: 0.75 },
} as const;

/** Just the shape and material of a piece. */
function PieceModel({ type, color, facing }: { type: PieceType; color: Color; facing: number }) {
  const look = LOOK[color];
  return (
    <group rotation={[0, facing, 0]}>
      {pieceParts(type).map((part, i) => (
        <mesh key={i} geometry={part.geometry} position={part.position} rotation={part.rotation} castShadow receiveShadow>
          <meshPhysicalMaterial color={part.accent ? look.accent : look.body} roughness={0.32} clearcoat={look.sheen} clearcoatRoughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

/** Knights look toward the opponent, turned toward the board centre so players see their profile. */
function knightFacing(color: Color, x: number): number {
  const turn = 0.9;
  const inward = x < 0 ? 1 : -1;
  return color === 'white' ? Math.PI / 2 - inward * turn : -Math.PI / 2 + inward * turn;
}

const RIDER_SCALE = 0.62;

function freeTagText(piece: Piece): string | null {
  const free = (piece.tags ?? []).filter((t) => !CORE_TAGS.includes(t.name));
  if (!free.length) return null;
  return free.map((t) => (t.turnsLeft === null ? t.name : `${t.name} ${t.turnsLeft}`)).join(' · ');
}

/** Tag visuals for one piece whose top is at `top`. */
function TagDecorations({ piece, top }: { piece: Piece; top: number }) {
  const label = freeTagText(piece);
  const stunned = hasTag(piece, STUN);
  return (
    <>
      {hasTag(piece, SHIELD) && <ShieldBubble height={top} />}
      {stunned && <StunStars y={top + 0.12} />}
      {label && <TagLabel text={label} y={top + (stunned ? 0.36 : 0.2)} />}
    </>
  );
}

interface Props {
  piece: Piece;
  position: [number, number, number];
  selected: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (hovering: boolean) => void;
}

/**
 * One chess piece with whatever rides on it and its tag effects. All piece
 * visuals live here and in pieceGeometry, so they can later be swapped for
 * model files without touching the rest of the scene.
 */
export function PieceMesh({ piece, position, selected, onClick, onHover }: Props) {
  const group = useRef<Group>(null);
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

  const facing = (p: Piece) => (p.type === 'knight' ? knightFacing(p.color, position[0]) : 0);
  const height = PIECE_HEIGHT[piece.type];
  const rider = piece.rider;
  const riderBase = height - 0.06;

  return (
    <group
      ref={group}
      position={position}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
        onHover(true);
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
        onHover(false);
      }}
    >
      <PieceModel type={piece.type} color={piece.color} facing={facing(piece)} />
      <TagDecorations piece={piece} top={height} />
      {rider && (
        <group position={[0, riderBase, 0]} scale={RIDER_SCALE}>
          <PieceModel type={rider.type} color={rider.color} facing={facing(rider)} />
          <TagDecorations piece={{ ...rider, tags: rider.tags?.filter((t) => t.name !== RIDE) }} top={PIECE_HEIGHT[rider.type]} />
        </group>
      )}
    </group>
  );
}
