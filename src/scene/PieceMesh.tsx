import { createContext, useContext, useEffect, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Euler, Quaternion, Vector3, type Group } from 'three';
import { CORE_TAGS, RIDE, SHIELD, STUN, hasTag, type Color, type Piece, type PieceType } from '../engine';
import { PIECE_HEIGHT, pieceParts } from './pieceGeometry';
import { ShieldBubble, StunStars, TagLabel } from './TagEffects';
import { playSfx } from '../audio/sfx';
import { ballistic, simulatePiece, tumble, type Obstacle, type PieceRun } from './piecePhysics';
import { TABLE_TOP_Y } from './WoodTable';

/** What the pieces share for physics: which side the dice are on, and where taken pieces lie. */
export interface PiecePhysics {
  diceSide: 1 | -1;
  /** Pieces lying beside the board, solid for the next throw. */
  resting: Map<string, Obstacle>;
}

export const PiecePhysicsContext = createContext<PiecePhysics | null>(null);

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
  /** Its next change of square was a special action or chaos, not a hand move: it flies. */
  flung?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onHover?: (hovering: boolean) => void;
}

const CAPTURED_SCALE = 0.62;
/** Pieces landing on the board (dropped in or flung) thud down and stay near where they land. */
const LANDING = { restitution: 0.02, friction: 1.2, angularDamping: 3 };

/** A recorded physics flight being played back, then (for pieces on the board) a glide upright. */
interface PhysicsMotion {
  purpose: 'toss' | 'drop' | 'fling';
  run: PieceRun | null;
  startedAt: number | null;
  delay: number;
  fromScale: number;
  toScale: number;
  /** After the flight: stand up on this spot. */
  settleTo: Vector3 | null;
  settle: { from: Vector3; fromQ: Quaternion; at: number; duration: number; hop: number } | null;
  sounded: number;
  /** Used if physics cannot run. */
  fallback: Motion;
}

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
export function PieceMesh({ piece, position, selected, captured = false, popIn = false, flung = false, onClick, onHover }: Props) {
  const group = useRef<Group>(null);
  const physics = useContext(PiecePhysicsContext);
  const phys = useRef<PhysicsMotion | null>(null);
  const shownQ = useRef(new Quaternion());
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

  /** Starts a physics flight; until it is computed the piece waits where it is. */
  const launch = (purpose: PhysicsMotion['purpose'], fallback: Motion, opts: Parameters<typeof simulatePiece>[0], settleTo: Vector3 | null, delay = 0) => {
    const m: PhysicsMotion = {
      purpose,
      run: null,
      startedAt: null,
      delay,
      fromScale: shownScale.current,
      toScale: fallback.toScale,
      settleTo,
      settle: null,
      sounded: -1,
      fallback,
    };
    phys.current = m;
    motion.current = null;
    simulatePiece(opts)
      .then((run) => {
        if (phys.current !== m) return;
        m.run = run;
        if (purpose === 'toss' && physics) physics.resting.set(piece.id, { type: piece.type, scale: opts.scale, pose: run.final });
      })
      .catch(() => {
        if (phys.current !== m) return;
        // No physics: fall back to the scripted motion.
        phys.current = null;
        motion.current = fallback;
      });
  };

  // A piece already lying beside the board when the scene opens is solid for later throws.
  useEffect(() => {
    if (captured && physics && !physics.resting.has(piece.id)) {
      physics.resting.set(piece.id, { type: piece.type, scale: CAPTURED_SCALE, pose: { position: new Vector3(...position), quaternion: new Quaternion() } });
    }
    return () => {
      physics?.resting.delete(piece.id);
    };
  }, []);

  // A piece created mid-game drops onto its square.
  useEffect(() => {
    if (!popIn || !physics || !motion.current) return;
    const to = new Vector3(...position);
    const start = to.clone().setY(2.4);
    const tilt = new Quaternion().setFromEuler(new Euler((Math.random() - 0.5) * 0.8, Math.random() * 6, (Math.random() - 0.5) * 0.8));
    shownAt.current.copy(start);
    shownQ.current.copy(tilt);
    shownScale.current = targetScale;
    launch(
      'drop',
      motion.current,
      {
        type: piece.type,
        scale: targetScale,
        start: { position: start, quaternion: tilt },
        velocity: new Vector3(0, -1, 0),
        spin: new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3),
        diceSide: physics.diceSide,
        maxSeconds: 2.5,
        bounce: LANDING,
      },
      to,
      0.1,
    );
  }, []);

  // A new destination: plan the trip from wherever the piece is now.
  useEffect(() => {
    const key = `${position[0]},${position[2]},${targetScale}`;
    if (key === lastTarget.current) return;
    lastTarget.current = key;
    const to = new Vector3(...position);
    const from = shownAt.current.clone();
    const scripted: Motion = { from, to, fromScale: shownScale.current, toScale: targetScale, startedAt: null, ...planMove(piece, from, to, captured) };
    if (!physics) {
      motion.current = scripted;
      return;
    }
    if (captured) {
      // Knocked off its square when the attacker lands, tumbling across the table to the side.
      const start = from.clone().setY(Math.max(from.y, 0) + 0.02);
      const velocity = ballistic(start, { x: to.x + (Math.random() - 0.5) * 0.6, z: to.z + (Math.random() - 0.5) * 0.6 }, TABLE_TOP_Y, 4.2 + Math.random() * 1.6);
      launch(
        'toss',
        scripted,
        {
          type: piece.type,
          scale: CAPTURED_SCALE,
          start: { position: start, quaternion: shownQ.current.clone() },
          velocity,
          spin: tumble(velocity, 7),
          obstacles: [...physics.resting.entries()].filter(([id]) => id !== piece.id).map(([, o]) => o),
          diceSide: physics.diceSide,
          maxSeconds: 4,
        },
        null,
        0.3,
      );
      return;
    }
    if (flung) {
      // Thrown by a special action: a real flight, a bounce, then it stands up on its square.
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      const start = from.clone().setY(Math.max(0, from.y) + 0.02);
      // Thrown high so it comes down steeply and does not skid far off its square.
      const velocity = ballistic(start, to, 0, 5 + dist * 0.7);
      launch(
        'fling',
        scripted,
        {
          type: piece.type,
          scale: targetScale,
          start: { position: start, quaternion: shownQ.current.clone() },
          velocity,
          spin: tumble(velocity, 1.5 + dist * 0.1),
          diceSide: physics.diceSide,
          maxSeconds: 2.5,
          bounce: LANDING,
        },
        to,
      );
      return;
    }
    phys.current = null;
    motion.current = scripted;
  }, [position[0], position[2], targetScale]);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const pm = phys.current;
    if (pm) {
      playPhysics(pm, clock.elapsedTime);
      g.position.copy(shownAt.current);
      g.quaternion.copy(shownQ.current);
      g.scale.setScalar(shownScale.current);
      return;
    }
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
    g.quaternion.copy(shownQ.current);
    // Selection lifts the piece gently (on top of any motion).
    const k = 1 - Math.exp(-dt * 14);
    g.userData.lift = (g.userData.lift ?? 0) + (lift - (g.userData.lift ?? 0)) * k;
    g.position.y += g.userData.lift;
    g.scale.setScalar(shownScale.current);
  });

  /** Plays a recorded flight, then (on the board) glides the piece upright onto its square. */
  function playPhysics(pm: PhysicsMotion, now: number) {
    const run = pm.run;
    if (!run) return; // still computing: stay put
    if (pm.startedAt === null) {
      pm.startedAt = now + pm.delay;
      if (pm.purpose === 'toss') playSfx('knock', { strength: 0.8, delay: pm.delay });
    }
    if (pm.settle) {
      const p = Math.min(1, (now - pm.settle.at) / pm.settle.duration);
      const e = easeInOut(p);
      shownAt.current.lerpVectors(pm.settle.from, pm.settleTo!, e);
      // Back onto its square with a little hop if it bounced away, standing up on the way.
      shownAt.current.y += Math.sin(Math.PI * p) * pm.settle.hop;
      shownQ.current.copy(pm.settle.fromQ).slerp(new Quaternion(), e);
      if (p >= 1) phys.current = null;
      return;
    }
    const t = now - pm.startedAt;
    if (t < 0) return;
    const last = run.steps - 1;
    const step = Math.min(last, Math.floor(t / run.dt));
    for (const hit of run.impacts) {
      if (hit.step <= pm.sounded || hit.step > step) continue;
      if (pm.purpose === 'toss') playSfx('land', { strength: Math.min(1, 0.3 + hit.strength) });
      else playSfx('move', { strength: Math.min(1, 0.4 + hit.strength) });
    }
    pm.sounded = step;
    const o = step * 7;
    shownAt.current.set(run.frames[o], run.frames[o + 1], run.frames[o + 2]);
    shownQ.current.set(run.frames[o + 3], run.frames[o + 4], run.frames[o + 5], run.frames[o + 6]);
    // A captured piece shrinks to its graveyard size as it is flicked away.
    const grow = Math.min(1, t / 0.25);
    shownScale.current = pm.fromScale + (pm.toScale - pm.fromScale) * grow;
    if (step >= last) {
      if (pm.settleTo) {
        const off = Math.hypot(shownAt.current.x - pm.settleTo.x, shownAt.current.z - pm.settleTo.z);
        pm.settle = { from: shownAt.current.clone(), fromQ: shownQ.current.clone(), at: now, duration: 0.3 + 0.15 * off, hop: off > 0.25 ? 0.2 + 0.25 * off : 0.05 };
      }
      else phys.current = null;
    }
  }

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
