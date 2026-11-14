import { useEffect, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Vector3, type Group } from 'three';
import { CORE_TAGS, RIDE, SHIELD, STUN, hasTag, type Color, type Piece, type PieceType } from '../engine';
import { PIECE_HEIGHT, pieceParts } from './pieceGeometry';
import { ShieldBubble, StunStars, TagLabel } from './TagEffects';
import { playSfx } from '../audio/sfx';

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
  /** Taken off the board: shown small beside it, not clickable. */
  captured?: boolean;
  /** Animate in (a piece created mid-game) instead of just being there. */
  popIn?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onHover?: (hovering: boolean) => void;
}

const CAPTURED_SCALE = 0.62;

interface Motion {
  from: Vector3;
  to: Vector3;
  fromScale: number;
  toScale: number;
  /** Seconds; the motion starts `delay` after it is planned. */
  delay: number;
  duration: number;
  arc: number;
  startedAt: number | null;
  kind: 'move' | 'captured' | 'pop';
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** How a piece travels between two points: knights jump, sliders glide with a small lift. */
function planMove(piece: Piece, from: Vector3, to: Vector3, captured: boolean): Omit<Motion, 'from' | 'to' | 'fromScale' | 'toScale' | 'startedAt'> {
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  if (captured) {
    // Knocked off when the attacker lands, then carried to the side.
    return { delay: 0.3, duration: 0.75, arc: 1.4, kind: 'captured' };
  }
  if (piece.type === 'knight' && dist < 2.5) return { delay: 0, duration: 0.42, arc: 0.85, kind: 'move' };
  // Long special-action flights arc higher.
  const arc = dist > 3.2 ? Math.min(1.8, 0.3 * dist) : 0.16 + 0.05 * dist;
  return { delay: 0, duration: Math.min(0.85, 0.26 + 0.07 * dist), arc, kind: 'move' };
}

/**
 * One chess piece with whatever rides on it and its tag effects. All piece
 * visuals live here and in pieceGeometry, so they can later be swapped for
 * model files without touching the rest of the scene.
 */
export function PieceMesh({ piece, position, selected, captured = false, popIn = false, onClick, onHover }: Props) {
  const group = useRef<Group>(null);
  const lift = selected && !captured ? 0.25 : 0;
  const targetScale = captured ? CAPTURED_SCALE : 1;
  const motion = useRef<Motion | null>(
    popIn
      ? {
          from: new Vector3(...position).setY(position[1] + 0.8),
          to: new Vector3(...position),
          fromScale: 0.01,
          toScale: targetScale,
          delay: 0.1,
          duration: 0.45,
          arc: 0,
          startedAt: null,
          kind: 'pop',
        }
      : null,
  );
  const shownAt = useRef(new Vector3(...position));
  const shownScale = useRef(popIn ? 0.01 : targetScale);
  const lastTarget = useRef(`${position[0]},${position[2]},${targetScale}`);

  // A new destination: plan the trip from wherever the piece is now.
  useEffect(() => {
    const key = `${position[0]},${position[2]},${targetScale}`;
    if (key === lastTarget.current) return;
    lastTarget.current = key;
    const to = new Vector3(...position);
    const from = shownAt.current.clone();
    motion.current = { from, to, fromScale: shownScale.current, toScale: targetScale, startedAt: null, ...planMove(piece, from, to, captured) };
  }, [position[0], position[2], targetScale]);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const m = motion.current;
    if (m) {
      if (m.startedAt === null) {
        m.startedAt = clock.elapsedTime + m.delay;
        if (m.kind === 'captured') playSfx('knock', { strength: 0.8, delay: m.delay });
      }
      const p = Math.min(1, Math.max(0, (clock.elapsedTime - m.startedAt) / m.duration));
      const e = m.kind === 'pop' ? 1 - (1 - p) ** 3 : easeInOut(p);
      shownAt.current.lerpVectors(m.from, m.to, e);
      shownAt.current.y += Math.sin(Math.PI * p) * m.arc;
      shownScale.current = m.fromScale + (m.toScale - m.fromScale) * e;
      if (p >= 1) {
        motion.current = null;
        shownAt.current.copy(m.to);
        shownScale.current = m.toScale;
        if (m.kind === 'move') playSfx('move', { strength: Math.min(1, 0.55 + 0.1 * m.from.distanceTo(m.to)) });
        else if (m.kind === 'captured') playSfx('land', { strength: 0.6 });
      }
    }
    g.position.copy(shownAt.current);
    // Selection lifts the piece gently (on top of any motion).
    const k = 1 - Math.exp(-dt * 14);
    g.userData.lift = (g.userData.lift ?? 0) + (lift - (g.userData.lift ?? 0)) * k;
    g.position.y += g.userData.lift;
    g.scale.setScalar(shownScale.current);
  });

  const facing = (p: Piece) => (p.type === 'knight' ? knightFacing(p.color, position[0]) : 0);
  const height = PIECE_HEIGHT[piece.type];
  const rider = piece.rider;
  const riderBase = height - 0.06;

  return (
    <group
      ref={group}
      position={position}
      onClick={captured ? undefined : onClick}
      onPointerOver={(e) => {
        if (captured) return;
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
        onHover?.(true);
      }}
      onPointerOut={() => {
        if (captured) return;
        document.body.style.cursor = '';
        onHover?.(false);
      }}
    >
      <PieceModel type={piece.type} color={piece.color} facing={facing(piece)} />
      {!captured && <TagDecorations piece={piece} top={height} />}
      {rider && (
        <group position={[0, riderBase, 0]} scale={RIDER_SCALE}>
          <PieceModel type={rider.type} color={rider.color} facing={facing(rider)} />
          <TagDecorations piece={{ ...rider, tags: rider.tags?.filter((t) => t.name !== RIDE) }} top={PIECE_HEIGHT[rider.type]} />
        </group>
      )}
    </group>
  );
}
