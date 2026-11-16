import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Euler, Quaternion, Vector3, type Group, type Mesh, type MeshPhysicalMaterial } from 'three';
import { BURN, CORE_TAGS, RIDE, SHIELD, STUN, hasTag, type Color, type Entrance, type Exit, type MotionStyle, type Piece, type PieceType } from '../engine';
import { PIECE_HEIGHT, pieceParts } from './pieceGeometry';
import { FoldingBadges, ShieldBubble, StunStars, type Chip } from './TagEffects';
import { playSfx } from '../audio/sfx';
import { ballistic, simulatePiece, tumble, type Obstacle, type PieceRun } from './piecePhysics';
import { TABLE_TOP_Y } from './WoodTable';
import { actPose, easeInOut, entrancePose, stylePose, swapPose, swerve, type PieceDirection, type Pose } from './pieceMotion';
import { AIR_Y, squareToWorld } from './coords';
import { finishMaterial, type Finish } from './pieceFinish';
import { AshPile, SHATTER_SECONDS, ShardPile, SmokeWisp } from './Remains';
import { PropOnPiece } from './PropMesh';

/** What the pieces share for physics: which side the dice are on, and where taken pieces lie. */
export interface PiecePhysics {
  diceSide: 1 | -1;
  /** Pieces lying beside the board, solid for the next throw. */
  resting: Map<string, Obstacle>;
  /** Every piece's 3D object by id, so effects can follow a piece as it moves. */
  objects: Map<string, Group>;
}

export const PiecePhysicsContext = createContext<PiecePhysics | null>(null);

const LOOK = {
  white: { body: '#efe5cf', accent: '#5a4632', sheen: 0.55 },
  black: { body: '#2e2b31', accent: '#b89a5e', sheen: 0.75 },
} as const;

/** Just the shape and material of a piece; `finish` marks how it left the board, if it did. */
function PieceModel({ type, color, facing, finish = 'normal' }: { type: PieceType; color: Color; facing: number; finish?: Finish }) {
  const look = LOOK[color];
  return (
    <group rotation={[0, facing, 0]}>
      {pieceParts(type).map((part, i) =>
        finish === 'normal' ? (
          <mesh key={i} geometry={part.geometry} position={part.position} rotation={part.rotation} castShadow receiveShadow>
            <meshPhysicalMaterial color={part.accent ? look.accent : look.body} roughness={0.32} clearcoat={look.sheen} clearcoatRoughness={0.25} />
          </mesh>
        ) : (
          <mesh
            key={`${finish}-${i}`}
            geometry={part.geometry}
            position={part.position}
            rotation={part.rotation}
            castShadow={finish !== 'ghost'}
            receiveShadow
            material={finishMaterial(finish, part.accent ? look.accent : look.body, part.position?.[1] ?? 0, PIECE_HEIGHT[type], look.sheen)}
          />
        ),
      )}
    </group>
  );
}

/** Exits played on the piece's own square before it goes to the side (the others are thrown there). */
const IN_PLACE_EXITS: readonly Exit[] = ['ash', 'shatter', 'vanish', 'sink'];
/** Seconds an exit on the square takes, including the moment it appears beside the board. */
export const EXIT_SECONDS: Partial<Record<Exit, number>> = { ash: 1.3, shatter: SHATTER_SECONDS, vanish: 1.0, sink: 1.1 };
/** Share of an in-place exit spent on the square (the rest: appearing beside the board). */
const ON_SQUARE = 0.72;
const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

/** Knights look toward the opponent, turned toward the board centre so players see their profile. */
function knightFacing(color: Color, x: number): number {
  const turn = 0.9;
  const inward = x < 0 ? 1 : -1;
  return color === 'white' ? Math.PI / 2 - inward * turn : -Math.PI / 2 + inward * turn;
}

const RIDER_SCALE = 0.62;

const short = (name: string) => (name.length > 6 ? `${name.slice(0, 5)}…` : name);

/**
 * The labels above a piece: every tag that runs out, with the turns it has left (a burning
 * piece's last turn in red), and free tags that never do, by name.
 */
export function tagChips(piece: Piece): Chip[] {
  return (piece.tags ?? []).flatMap((t): Chip[] => {
    if (t.name === RIDE) return [];
    // A clash multiplier shows with the name: "검술 ×1.5".
    const name = t.clash ? `${short(t.name)} ×${t.clash}` : short(t.name);
    if (t.turnsLeft === null) return CORE_TAGS.includes(t.name) && !t.clash ? [] : [{ text: name, tone: 'free' }];
    const tone = t.name === STUN ? 'stun' : t.name === SHIELD ? 'shield' : t.name === BURN ? (t.turnsLeft <= 1 ? 'burnLast' : 'burn') : 'free';
    return [{ text: `${name} ${t.turnsLeft}`, tone }];
  });
}

/** Tag visuals for one piece whose top is at `top`. */
function TagDecorations({ piece, top }: { piece: Piece; top: number }) {
  const chips = tagChips(piece);
  const stunned = hasTag(piece, STUN);
  return (
    <>
      {hasTag(piece, SHIELD) && <ShieldBubble height={top} />}
      {stunned && <StunStars y={top + 0.12} />}
      {chips.length > 0 && <FoldingBadges chips={chips} y={top + (stunned ? 0.36 : 0.2)} />}
      {(piece.tags ?? []).map((t) => t.prop && <PropOnPiece key={t.name} prop={t.prop} color={piece.color} height={top} />)}
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
  /** What it does in the show being played (special actions and chaos); hand moves have none. */
  direction?: PieceDirection;
  /** Beside the board: how it left (as the GM staged it). */
  exit?: Exit;
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
  kind: 'move' | 'captured' | 'pop' | 'styled' | 'entrance' | 'exit' | 'swap' | 'revive' | 'settle';
  /** For 'settle': the tilt it starts from (it stands up on the way). */
  fromQ?: Quaternion;
  /** For 'styled' trips, 'entrance's, 'exit's and 'revive's. */
  style?: MotionStyle | Entrance | Exit;
  /** Trading squares: swerve to this side of the line so the two pieces pass each other. */
  side?: 1 | -1;
  /** What comes right after (a piece thrown into a pit falls in once it gets there). */
  next?: () => void;
}

/** A glow over the piece's surface (morphs, side changes, materializing). */
interface Glow {
  color: string;
  peak: number;
  start: number;
  duration: number;
  /** Stays at its peak for most of the time instead of swelling and fading. */
  hold?: boolean;
  flicker?: boolean;
}

/** A short flourish on top of everything else (morph squash, side-change swirl). */
interface Flourish {
  kind: 'morph' | 'swirl';
  start: number;
  duration: number;
}

const UP = new Vector3(0, 1, 0);
const TMP_AXIS = new Vector3();
const TMP_Q = new Quaternion();
const TMP_Q2 = new Quaternion();
const TMP_E = new Euler();

/** A pose's turn and lean as a rotation; `dirX/dirZ` is the direction of travel. */
function poseRotation(pose: Pose, dirX: number, dirZ: number, out: Quaternion): Quaternion {
  out.setFromAxisAngle(UP, pose.yaw);
  if (pose.lean) {
    // Lean toward the direction of travel: turn about the horizontal axis across it.
    TMP_AXIS.set(dirZ, 0, -dirX);
    if (TMP_AXIS.lengthSq() > 1e-8) out.premultiply(TMP_Q2.setFromAxisAngle(TMP_AXIS.normalize(), pose.lean));
  }
  if (pose.roll) {
    // Tip sideways: turn about the direction of travel itself.
    TMP_AXIS.set(dirX, 0, dirZ);
    if (TMP_AXIS.lengthSq() < 1e-8) TMP_AXIS.set(0, 0, 1);
    out.premultiply(TMP_Q2.setFromAxisAngle(TMP_AXIS.normalize(), pose.roll));
  }
  return out;
}

/** How a piece travels between two points: knight jumps hop, slides glide with a small lift. */
function planMove(from: Vector3, to: Vector3, captured: boolean): Omit<Motion, 'from' | 'to' | 'fromScale' | 'toScale' | 'startedAt'> {
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  if (captured) {
    // Knocked off when the attacker lands, then carried to the side.
    return { delay: 0.3, duration: 0.75, arc: 1.4, kind: 'captured' };
  }
  // A knight's jump (by a knight, or anything lent its moves): an L, hopped over whatever is between.
  const [ax, az] = [Math.round(Math.abs(to.x - from.x)), Math.round(Math.abs(to.z - from.z))];
  if ((ax === 1 && az === 2) || (ax === 2 && az === 1)) return { delay: 0, duration: 0.42, arc: 0.85, kind: 'move' };
  // Long special-action flights arc higher.
  const arc = dist > 3.2 ? Math.min(1.8, 0.3 * dist) : 0.16 + 0.05 * dist;
  return { delay: 0, duration: Math.min(0.85, 0.26 + 0.07 * dist), arc, kind: 'move' };
}

/**
 * One chess piece with whatever rides on it and its tag effects. All piece
 * visuals live here and in pieceGeometry, so they can later be swapped for
 * model files without touching the rest of the scene.
 */
export function PieceMesh({ piece, position, selected, captured = false, popIn = false, direction, exit, onClick, onHover }: Props) {
  const group = useRef<Group>(null);
  const riderRef = useRef<Group>(null);
  /** Which of this show's trips comes next. */
  const tripIndex = useRef(0);
  const glow = useRef<Glow | null>(null);
  const glowOn = useRef(false);
  const flourish = useRef<Flourish | null>(null);
  const riderHop = useRef<{ from: Vector3; start: number } | null>(null);
  const shownSquash = useRef(1);
  const travel = useRef({ x: 0, z: 0 });
  const prev = useRef({ type: piece.type, color: piece.color, rider: piece.rider?.id ?? null });
  const wasCaptured = useRef(captured);
  /** An exit being played (the remains show once it is over). */
  const [exiting, setExiting] = useState<{ kind: Exit; start: number; offset: [number, number, number] } | null>(null);
  const exitingRef = useRef(exiting);
  exitingRef.current = exiting;
  const bobPhase = useRef(Math.random() * 6);
  /** The recording this piece last played (so it settles back once only). */
  const puppetDone = useRef<unknown>(null);
  /** The recording it is playing now (if another takes its place first, it still settles back). */
  const puppetOn = useRef<unknown>(null);
  /** The next plan is the slow walk back after a recording, not an ordinary trip. */
  const settleNext = useRef(false);
  const planRef = useRef<() => void>(() => {});
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
  const lastTarget = useRef(`${position[0]},${position[1]},${position[2]},${targetScale}`);

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

  /** Burns down, shatters, vanishes or sinks on the spot `from`, then turns up beside the board at `to`. */
  const beginExit = (exit: Exit, from: Vector3, to: Vector3, delay: number) => {
    phys.current = null;
    motion.current = { from, to, fromScale: shownScale.current, toScale: CAPTURED_SCALE, delay, duration: EXIT_SECONDS[exit]!, arc: 0, startedAt: null, kind: 'exit', style: exit };
    setExiting({ kind: exit, start: performance.now() + delay * 1000, offset: [to.x - from.x, to.y - from.y, to.z - from.z] });
    const onSquare = EXIT_SECONDS[exit]! * ON_SQUARE * 1000;
    if (exit === 'ash') glow.current = { color: '#ff6a1f', peak: 1.6, start: performance.now() + delay * 1000, duration: onSquare, hold: true, flicker: true };
    if (exit === 'vanish') glow.current = { color: '#bfe3ff', peak: 1.4, start: performance.now() + delay * 1000, duration: onSquare };
    physics?.resting.set(piece.id, { type: piece.type, scale: CAPTURED_SCALE, pose: { position: to.clone(), quaternion: new Quaternion() } });
  };

  // Effects (trails, auras) find the piece by id, on the board or on its way off it.
  useEffect(() => {
    const g = group.current;
    if (!physics || !g) return;
    physics.objects.set(piece.id, g);
    return () => {
      if (physics.objects.get(piece.id) === g) physics.objects.delete(piece.id);
    };
  }, []);
  // ...and a rider by its own id, where it sits on top.
  const riderId = piece.rider?.id;
  useEffect(() => {
    const r = riderRef.current;
    if (!physics || !r || !riderId) return;
    physics.objects.set(riderId, r);
    return () => {
      if (physics.objects.get(riderId) === r) physics.objects.delete(riderId);
    };
  }, [riderId]);

  // A piece already lying beside the board when the scene opens is solid for later throws.
  useEffect(() => {
    if (captured && physics && !physics.resting.has(piece.id)) {
      physics.resting.set(piece.id, { type: piece.type, scale: CAPTURED_SCALE, pose: { position: new Vector3(...position), quaternion: new Quaternion() } });
    }
    return () => {
      physics?.resting.delete(piece.id);
    };
  }, []);

  // A rider jumping off a carrier starts on top of it, small, then makes its trip down.
  useEffect(() => {
    if (direction?.appearFrom === undefined || captured) return;
    const [x, , z] = squareToWorld(direction.appearFrom);
    shownAt.current.set(x, 0.85, z);
    shownScale.current = RIDER_SCALE;
    motion.current = null;
    lastTarget.current = '';
  }, []);

  // A piece created by a show appears the way the GM chose: risen from the board or out of light.
  useEffect(() => {
    const style = direction?.entrance?.style;
    if (!popIn || !motion.current || (style !== 'rise' && style !== 'materialize')) return;
    const at = new Vector3(...position);
    motion.current = { from: at, to: at, fromScale: targetScale, toScale: targetScale, delay: 0, duration: direction!.entrance!.duration, arc: 0, startedAt: null, kind: 'entrance', style };
    shownScale.current = style === 'materialize' ? 0.001 : targetScale;
    if (style === 'materialize') glow.current = { color: '#fff1c9', peak: 1.4, start: performance.now(), duration: direction!.entrance!.duration * 1000 };
    if (style === 'rise') shownAt.current.set(at.x, at.y - PIECE_HEIGHT[piece.type] - 0.05, at.z);
  }, []);

  // A piece created mid-game drops onto its square.
  useEffect(() => {
    if (!popIn || !physics || !motion.current || motion.current.kind === 'entrance') return;
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

  // A new show: its trips start from the first.
  useEffect(() => {
    tripIndex.current = 0;
  }, [direction]);

  // Changes the show asked for: a new shape, a new side, a rider hopping on.
  useEffect(() => {
    const was = prev.current;
    prev.current = { type: piece.type, color: piece.color, rider: piece.rider?.id ?? null };
    if (!direction || captured) return;
    const now = performance.now();
    if (direction.morph && was.type !== piece.type) {
      flourish.current = { kind: 'morph', start: now, duration: 600 };
      glow.current = { color: '#ffe3a3', peak: 1.6, start: now, duration: 700 };
    }
    if (direction.swirl && was.color !== piece.color) {
      flourish.current = { kind: 'swirl', start: now, duration: 750 };
      glow.current = { color: '#b48bff', peak: 1.2, start: now, duration: 800 };
    }
    if (direction.boardFrom !== undefined && piece.rider && was.rider !== piece.rider.id) {
      const [fx, , fz] = squareToWorld(direction.boardFrom);
      riderHop.current = { from: new Vector3(fx - position[0], 0, fz - position[2]), start: now };
    }
  }, [piece.type, piece.color, piece.rider?.id]);

  // A new destination: plan the trip from wherever the piece is now (once a recording it is
  // playing is over: the end of the recording plans it then).
  useEffect(() => {
    const pup = direction?.puppet;
    if (pup && puppetDone.current !== pup && performance.now() < pup.start + pup.steps * pup.dt * 1000) return;
    planRef.current();
  }, [position[0], position[1], position[2], targetScale]);

  planRef.current = () => {
    const key = `${position[0]},${position[1]},${position[2]},${targetScale}`;
    if (key === lastTarget.current) return;
    lastTarget.current = key;
    const to = new Vector3(...position);
    const from = shownAt.current.clone();
    const revived = wasCaptured.current && !captured;
    wasCaptured.current = captured;
    const trip = !captured ? direction?.motions[tripIndex.current] : undefined;
    if (trip) tripIndex.current++;
    travel.current = { x: to.x - from.x, z: to.z - from.z };
    const scripted: Motion = { from, to, fromScale: shownScale.current, toScale: targetScale, startedAt: null, ...planMove(from, to, captured) };
    if (revived) {
      // Back from beside the board: it leaves its remains and comes back as the GM chose.
      physics?.resting.delete(piece.id);
      phys.current = null;
      setExiting(null);
      const style = direction?.revive?.style ?? 'default';
      const duration = Math.max(0.4, direction?.revive?.duration ?? 1.3);
      motion.current = { ...scripted, delay: 0, duration, arc: 2, kind: 'revive', style };
      glow.current = { color: '#fff1c9', peak: 1.5, start: performance.now(), duration: duration * 1000 };
      return;
    }
    if (settleNext.current) {
      settleNext.current = false;
      if (!captured) {
        // After a romp or a duel: back to its square slowly, standing up on the way.
        const d = from.distanceTo(to);
        phys.current = null;
        motion.current = { ...scripted, delay: 0, duration: 0.7 + 0.12 * Math.min(d, 4), arc: Math.min(0.45, 0.1 + 0.08 * d), kind: 'settle', fromQ: shownQ.current.clone() };
        return;
      }
      // Taken: it goes off from wherever it lies (below).
    }
    // Rising into the air (공중부양), or moving about up there: floated, not flung.
    if (!captured && (to.y > 0.5 || from.y > 0.5) && !(trip && trip.style !== 'default' && trip.style !== 'fly')) {
      phys.current = null;
      const rise = Math.hypot(to.x - from.x, to.z - from.z) < 0.01;
      motion.current = rise ? { ...scripted, delay: trip ? 0 : 0.1, duration: 1.4, arc: 0, kind: 'settle', fromQ: shownQ.current.clone() } : scripted;
      return;
    }
    if (trip && trip.style !== 'default' && trip.style !== 'fly') {
      // A styled trip from the show, timed to its place in the show.
      phys.current = null;
      motion.current = { ...scripted, delay: 0, duration: Math.max(0.2, trip.duration), arc: 0, kind: 'styled', style: trip.style, side: trip.side };
      return;
    }
    if (trip?.side) {
      // A plain swap: up and over, passing the other piece (scripted: two flights would meet).
      phys.current = null;
      motion.current = { ...scripted, delay: 0, duration: Math.max(0.3, trip.duration), arc: 0, kind: 'swap', side: trip.side };
      return;
    }
    if (!physics) {
      motion.current = scripted;
      return;
    }
    const pit = captured ? direction?.fallInto : undefined;
    if (pit) {
      // Thrown into a pit: it flies there, then drops in, and turns up beside the board.
      const [px, , pz] = squareToWorld(pit.at);
      const edge = new Vector3(px, 0, pz);
      const dist = Math.hypot(px - from.x, pz - from.z);
      const sink: Exit = exit && IN_PLACE_EXITS.includes(exit) ? exit : 'sink';
      phys.current = null;
      travel.current = { x: px - from.x, z: pz - from.z };
      motion.current = {
        from,
        to: edge,
        fromScale: shownScale.current,
        toScale: shownScale.current,
        delay: 0,
        duration: Math.max(0.3, pit.duration),
        arc: 0.3 + 0.09 * dist,
        startedAt: null,
        kind: 'move',
        next: () => beginExit(sink, edge, to, 0),
      };
      return;
    }
    if (captured && exit && IN_PLACE_EXITS.includes(exit)) {
      // Burnt to ash, shattered, vanished or sunk on its square; then it shows up beside the board.
      beginExit(exit, from, to, direction?.exitDelay ?? 0);
      return;
    }
    if (captured) {
      const delay = direction?.exitDelay ?? 0.3;
      if (exit === 'burn') {
        // Thrown off in flames; it keeps burning a while beside the board, then is left scorched.
        glow.current = { color: '#ff5a14', peak: 1.4, start: performance.now() + delay * 1000, duration: 4200, hold: true, flicker: true };
        setExiting({ kind: 'burn', start: performance.now() + delay * 1000, offset: [0, 0, 0] });
      }
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
        delay,
      );
      return;
    }
    if (trip) {
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
  };

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const now = performance.now();
    const height = PIECE_HEIGHT[piece.type];
    let squash = 1;
    // A recording (a duel, a romp) drives the piece; when it is over it eases back where it belongs.
    const pup = direction?.puppet;
    // Cut short (the next recording started without it): it eases back from where it was left.
    if (puppetOn.current && puppetOn.current !== pup && puppetDone.current !== puppetOn.current) {
      puppetDone.current = puppetOn.current;
      puppetOn.current = null;
      settleNext.current = true;
      lastTarget.current = '';
      planRef.current();
    }
    if (pup && puppetDone.current !== pup) {
      puppetOn.current = pup;
      const t = (now - pup.start) / 1000;
      if (t >= 0) {
        const o = Math.max(0, Math.min(pup.steps - 1, Math.floor(t / pup.dt))) * 7;
        const f = pup.frames;
        shownAt.current.set(f[o], f[o + 1], f[o + 2]);
        shownQ.current.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]);
        phys.current = null;
        motion.current = null;
        if (t > pup.steps * pup.dt) {
          puppetDone.current = pup;
          settleNext.current = true;
          lastTarget.current = '';
          planRef.current();
        } else {
          g.position.copy(shownAt.current);
          g.quaternion.copy(shownQ.current);
          g.scale.setScalar(shownScale.current);
          return;
        }
      }
    }
    const pm = phys.current;
    if (pm) playPhysics(pm, clock.elapsedTime);
    const m = pm ? null : motion.current;
    if (m) {
      if (m.startedAt === null) {
        m.startedAt = clock.elapsedTime + m.delay;
        if (m.kind === 'captured') playSfx('knock', { strength: 0.8, delay: m.delay });
      }
      const p = Math.min(1, Math.max(0, (clock.elapsedTime - m.startedAt) / m.duration));
      if (m.kind === 'exit') {
        const style = m.style as Exit;
        const onSquare = style === 'shatter' ? 1 : ON_SQUARE;
        if (p < onSquare) {
          // On its square: burning down, fading upward, or sinking into the board.
          const q = p / onSquare;
          shownAt.current.copy(m.from);
          shownScale.current = m.fromScale;
          if (style === 'ash') squash = Math.max(0.04, 1 - 0.96 * q * q);
          else if (style === 'vanish') {
            shownAt.current.y += 0.35 * (1 - (1 - q) ** 3);
            shownScale.current = m.fromScale * Math.max(0.0001, 1 - q * q * q);
          } else if (style === 'sink') {
            shownAt.current.y -= (height + 0.1) * q * q;
            shownQ.current.setFromAxisAngle(TMP_AXIS.set(1, 0, 0.4).normalize(), 0.12 * Math.sin(q * 14) * (1 - q));
          }
        } else {
          // Then it turns up beside the board.
          const q = (p - onSquare) / (1 - onSquare);
          shownAt.current.copy(m.to);
          shownQ.current.identity();
          shownScale.current = m.toScale * Math.max(0.0001, easeOutBack(q));
        }
        if (p >= 1 && exitingRef.current) setExiting(null);
      } else if (m.kind === 'styled' || m.kind === 'entrance' || m.kind === 'swap') {
        const len = Math.hypot(travel.current.x, travel.current.z) || 1;
        const ps =
          m.kind === 'swap'
            ? swapPose(m.from, m.to, p, m.side ?? 1)
            : m.kind === 'styled'
              ? stylePose(m.style as MotionStyle, m.from, m.to, p, height)
              : entrancePose(m.style as Entrance, m.to, p, height);
        if (m.kind === 'styled' && m.side) {
          // Trading squares: swerve off the line so the two pieces pass each other.
          const off = swerve(p) * m.side;
          ps.x -= (travel.current.z / len) * off;
          ps.z += (travel.current.x / len) * off;
        }
        shownAt.current.set(ps.x, ps.y, ps.z);
        poseRotation(ps, travel.current.x / len, travel.current.z / len, shownQ.current);
        shownScale.current = (m.fromScale + (m.toScale - m.fromScale) * easeInOut(p)) * ps.scale;
        squash = ps.squashY;
      } else if (m.kind === 'revive') {
        const style = m.style as Entrance;
        if (style === 'rise' || style === 'materialize') {
          // Fades from beside the board, then rises out of its square or forms out of light.
          const away = 0.22;
          if (p < away) {
            shownAt.current.copy(m.from);
            shownAt.current.y += 0.25 * (p / away);
            shownScale.current = m.fromScale * Math.max(0.0001, 1 - p / away);
          } else {
            const ps = entrancePose(style, m.to, (p - away) / (1 - away), height);
            shownAt.current.set(ps.x, ps.y, ps.z);
            poseRotation(ps, 0, 1, shownQ.current);
            shownScale.current = m.toScale * ps.scale;
            squash = ps.squashY;
          }
        } else {
          // Flies back from beside the board in a high arc, turning, and grows to full size.
          const e = easeInOut(p);
          shownAt.current.lerpVectors(m.from, m.to, e);
          shownAt.current.y += Math.sin(Math.PI * p) * m.arc;
          shownQ.current.setFromAxisAngle(UP, e * Math.PI * 2);
          shownScale.current = m.fromScale + (m.toScale - m.fromScale) * e;
        }
      } else if (m.kind === 'settle') {
        // Easing back and standing up as it goes.
        const e = easeInOut(p);
        shownAt.current.lerpVectors(m.from, m.to, e);
        shownAt.current.y = m.from.y * (1 - e) + m.to.y * e + Math.sin(Math.PI * p) * m.arc;
        shownQ.current.copy(m.fromQ ?? shownQ.current).slerp(new Quaternion(), e);
        shownScale.current = m.fromScale + (m.toScale - m.fromScale) * e;
      } else {
        const e = m.kind === 'pop' ? 1 - (1 - p) ** 3 : easeInOut(p);
        shownAt.current.lerpVectors(m.from, m.to, e);
        shownAt.current.y += Math.sin(Math.PI * p) * m.arc;
        shownScale.current = m.fromScale + (m.toScale - m.fromScale) * e;
      }
      if (p >= 1) {
        motion.current = null;
        shownAt.current.copy(m.to);
        shownScale.current = m.toScale;
        if (m.kind !== 'move' && m.kind !== 'captured' && m.kind !== 'pop') shownQ.current.identity();
        if (m.kind === 'move' || m.kind === 'styled' || m.kind === 'swap' || m.kind === 'revive' || m.kind === 'settle') playSfx('move', { strength: Math.min(1, 0.45 + 0.1 * m.from.distanceTo(m.to)) });
        else if (m.kind === 'captured') playSfx('land', { strength: 0.6 });
        m.next?.();
      }
    }
    g.position.copy(shownAt.current);
    g.quaternion.copy(shownQ.current);
    // Floating (공중부양): never quite steady, it bobs, sways and slowly turns (more the higher it is).
    if (!captured && position[1] > 0.5) {
      const k = Math.max(0, Math.min(1, shownAt.current.y / AIR_Y));
      const w = now / 1000 + bobPhase.current;
      g.position.y += k * 0.05 * Math.sin(w * 1.7);
      g.quaternion.multiply(TMP_Q.setFromEuler(TMP_E.set(k * 0.1 * Math.sin(w * 1.3), k * w * 0.45, k * 0.1 * Math.sin(w * 1.05 + 1))));
    }
    // A ghost beside the board floats, slowly rising and falling.
    if (captured && exit === 'vanish' && !exiting && !m && !pm) g.position.y += 0.2 + 0.05 * Math.sin(now / 650 + bobPhase.current);

    // Acting in place, on top of wherever the piece stands.
    for (const act of direction?.acts ?? []) {
      const q = (now - act.start) / (act.duration * 1000);
      if (q < 0 || q > 1) continue;
      const ps = actPose(act.kind, q, now / 1000);
      g.position.x += ps.x;
      g.position.y += ps.y;
      g.position.z += ps.z;
      g.quaternion.premultiply(poseRotation(ps, 0, 1, TMP_Q));
      squash *= ps.squashY;
    }
    const f = flourish.current;
    if (f) {
      const q = Math.min(1, (now - f.start) / f.duration);
      if (f.kind === 'morph') {
        // Squashed down, then stretched up into the new shape.
        squash *= 1 - 0.55 * Math.sin(Math.PI * Math.min(1, q * 1.6)) + 0.12 * Math.sin(Math.PI * Math.max(0, q * 1.6 - 0.6));
        g.position.y += 0.12 * Math.sin(Math.PI * q);
      } else {
        // Swirling round as the colours change.
        g.quaternion.premultiply(TMP_Q.setFromAxisAngle(UP, easeInOut(q) * Math.PI * 4));
        g.position.y += 0.18 * Math.sin(Math.PI * q);
      }
      if (q >= 1) flourish.current = null;
    }

    if (!pm) {
      // Selection lifts the piece gently (on top of any motion).
      const k = 1 - Math.exp(-dt * 14);
      g.userData.lift = (g.userData.lift ?? 0) + (lift - (g.userData.lift ?? 0)) * k;
      g.position.y += g.userData.lift;
    }
    shownSquash.current = squash;
    g.scale.set(shownScale.current, shownScale.current * squash, shownScale.current);

    // A glow over the surface while it changes.
    const gl = glow.current;
    const gq = gl ? (now - gl.start) / gl.duration : 0;
    let level = !gl || gq < 0 ? 0 : gl.hold ? gl.peak * Math.min(1, gq * 8) * (gq < 0.6 ? 1 : Math.max(0, 1 - (gq - 0.6) / 0.4)) : gl.peak * Math.sin(Math.PI * Math.min(1, gq));
    if (gl?.flicker) level *= 0.7 + 0.3 * Math.sin(now * 0.031 + Math.sin(now * 0.017) * 3);
    if (gl && gq >= 1) {
      glow.current = null;
      // A burnt piece has burnt out: now it is left scorched.
      if (exitingRef.current?.kind === 'burn') setExiting(null);
    }
    if (level > 0.01 || glowOn.current) {
      g.traverse((o) => {
        const mat = (o as Mesh).material as MeshPhysicalMaterial | undefined;
        // Shared finish materials (ghosts, soot, mud) never glow: they belong to many pieces.
        if (mat && 'emissive' in mat && mat.emissive && !mat.userData.vtcFinish) {
          if (gl) mat.emissive.set(gl.color);
          mat.emissiveIntensity = level > 0.01 ? level : 0;
        }
      });
      glowOn.current = level > 0.01;
    }

    // A rider hopping on from its square.
    const hop = riderHop.current;
    const r = riderRef.current;
    if (hop && r) {
      const q = Math.min(1, (now - hop.start) / 600);
      const e = easeInOut(q);
      const base = PIECE_HEIGHT[piece.type] - 0.06;
      r.position.set(hop.from.x * (1 - e), hop.from.y + (base - hop.from.y) * e + Math.sin(Math.PI * q) * 0.7, hop.from.z * (1 - e));
      r.scale.setScalar(1 + (RIDER_SCALE - 1) * e);
      if (q >= 1) {
        riderHop.current = null;
        r.position.set(0, base, 0);
        r.scale.setScalar(RIDER_SCALE);
        playSfx('move', { strength: 0.6 });
      }
    }
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

  // What stands beside the board after a staged exit; while the exit plays, the piece itself.
  const remains = captured && exit && !exiting ? exit : null;
  const body =
    exiting?.kind === 'shatter' ? (
      <ShardPile type={piece.type} color={piece.color} id={piece.id} flight={{ offset: exiting.offset, start: exiting.start, scale: CAPTURED_SCALE }} />
    ) : remains === 'ash' ? (
      <AshPile type={piece.type} color={piece.color} id={piece.id} />
    ) : remains === 'shatter' ? (
      <ShardPile type={piece.type} color={piece.color} id={piece.id} />
    ) : (
      <PieceModel
        type={piece.type}
        color={piece.color}
        facing={facing(piece)}
        finish={remains === 'burn' ? 'scorched' : remains === 'sink' ? 'mud' : remains === 'vanish' ? 'ghost' : 'normal'}
      />
    );

  return (
    <>
    {remains === 'burn' && <SmokeWisp follow={group} height={height} />}
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
      {body}
      {!captured && <TagDecorations piece={piece} top={height} />}
      {rider && (
        <group ref={riderRef} position={[0, riderBase, 0]} scale={RIDER_SCALE}>
          <PieceModel type={rider.type} color={rider.color} facing={facing(rider)} />
          <TagDecorations piece={{ ...rider, tags: rider.tags?.filter((t) => t.name !== RIDE) }} top={PIECE_HEIGHT[rider.type]} />
        </group>
      )}
    </group>
    </>
  );
}
