import { Quaternion, Vector3 } from 'three';
import type { Obstacle } from './piecePhysics';
import type { Pose, ToyOp } from '../session/toy';
import { d6Corners } from '../dice3d/d6';

/*
 * The table's toys between the scene and the session (docs/SPEC.md, "만지작거리기"): what this
 * screen does to a taken piece or a chunk goes out to the other screens, and what they do comes
 * in to the thing it was done to. Also where the dice lie, so thrown things can hit them.
 */

/** What is done to one thing on the table (a look is not: it goes to onGaze). */
type ItemOp = Exclude<ToyOp, { op: 'gaze' | 'write' | 'toss' }>;
type Handler = (op: ItemOp) => void;
const handlers = new Map<string, Handler>();
let send: ((op: ToyOp) => void) | null = null;
const lastHold = new Map<string, number>();
/** Carrying is told a dozen times a second at most (the other screens smooth it out). */
const HOLD_EVERY_MS = 80;

/** Where this screen's toys go (the session); null: nowhere. */
export function setToySender(fn: ((op: ToyOp) => void) | null): void {
  send = fn;
}

/** Tells the other screens what this one did. */
export function tellToy(op: ToyOp): void {
  const now = performance.now();
  if (op.op === 'hold') {
    if (now - (lastHold.get(op.id) ?? 0) < HOLD_EVERY_MS) return;
    lastHold.set(op.id, now);
  } else lastHold.delete(op.id);
  send?.(op);
}

/** Listens for what other screens do to `id` (a taken piece's id, or CHUNK and a chunk's key). */
export function onToy(id: string, handler: Handler): () => void {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

/** Something another screen did. */
export function receiveToy(op: ToyOp): void {
  if (op.op === 'gaze') {
    for (const fn of gazeListeners) fn(op);
    return;
  }
  if (op.op === 'write' || op.op === 'toss') {
    for (const fn of paperListeners) fn(op);
    return;
  }
  handlers.get(op.id)?.(op);
}

// ---- where the others look (상대 시선) --------------------------------------------

type GazeOp = Extract<ToyOp, { op: 'gaze' }>;
const gazeListeners = new Set<(op: GazeOp) => void>();
let lastGaze = { at: 0, text: '' };
/** A look is told a few times a second at most, and only when it moved. */
const GAZE_EVERY_MS = 200;

/** Tells the others where this screen's camera is and what it looks at. */
export function tellGaze(side: GazeOp['id'], from: [number, number, number], at: [number, number, number]): void {
  const now = performance.now();
  const r = (v: number) => Math.round(v * 20) / 20;
  const op: GazeOp = { op: 'gaze', id: side, from: [r(from[0]), r(from[1]), r(from[2])], at: [r(at[0]), r(at[1]), r(at[2])] };
  const text = JSON.stringify(op);
  if (now - lastGaze.at < GAZE_EVERY_MS || text === lastGaze.text) return;
  lastGaze = { at: now, text };
  send?.(op);
}

// ---- the papers players write on (쓰는 종이) -----------------------------------------

type PaperOp = Extract<ToyOp, { op: 'write' | 'toss' }>;
const paperListeners = new Set<(op: PaperOp) => void>();
let lastWrite = { at: 0, text: '', timer: 0 as ReturnType<typeof setTimeout> | 0 };
/** What is being written goes out a few times a second at most (the last of it always does). */
const WRITE_EVERY_MS = 150;

/** Tells the others what this player is writing now ('' puts the paper away). */
export function tellWrite(side: PaperOp['id'], text: string): void {
  if (text === lastWrite.text) return;
  if (lastWrite.timer) clearTimeout(lastWrite.timer);
  const go = () => {
    lastWrite = { at: performance.now(), text, timer: 0 };
    send?.({ op: 'write', id: side, text });
  };
  const wait = WRITE_EVERY_MS - (performance.now() - lastWrite.at);
  if (wait <= 0) go();
  else lastWrite.timer = setTimeout(go, wait);
}

/** The player sent what was written: the paper is tossed aside, here and on the others' screens. */
export function tellToss(side: PaperOp['id'], text: string): void {
  if (lastWrite.timer) clearTimeout(lastWrite.timer);
  lastWrite = { at: performance.now(), text: '', timer: 0 };
  const op: PaperOp = { op: 'toss', id: side, text, dir: Math.random() < 0.5 ? -1 : 1, seed: newSeed() };
  send?.(op);
  for (const fn of paperListeners) fn(op);
}

export function onPaper(fn: (op: PaperOp) => void): () => void {
  paperListeners.add(fn);
  return () => void paperListeners.delete(fn);
}

/** Listens for where the others look. */
export function onGaze(fn: (op: GazeOp) => void): () => void {
  gazeListeners.add(fn);
  return () => void gazeListeners.delete(fn);
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
export const poseOf = (p: Vector3, q: Quaternion): Pose => [round(p.x), round(p.y), round(p.z), round(q.x), round(q.y), round(q.z), round(q.w)];
export function readPose(pose: Pose, p: Vector3, q: Quaternion): void {
  p.set(pose[0], pose[1], pose[2]);
  q.set(pose[3], pose[4], pose[5], pose[6]).normalize();
}

/** A fresh seed for a throw (sent along, so every screen spins it alike). */
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// ---- the dice ----------------------------------------------------------------------

const dice = new Map<string, { p: Vector3; q: Quaternion; half: number }>();
const hulls = new Map<number, Float32Array>();

/** Where a die (a cube, its faces `half` from its centre) lies now (world), or that it is put away (null). */
export function setDie(key: string, at: { p: Vector3; q: Quaternion; half: number } | null): void {
  if (!at) dice.delete(key);
  else {
    const d = dice.get(key);
    if (d) {
      d.p.copy(at.p);
      d.q.copy(at.q);
      d.half = at.half;
    } else dice.set(key, { p: at.p.clone(), q: at.q.clone(), half: at.half });
  }
}

/** The dice as obstacles. */
export function diceObstacles(): { hull: Float32Array; p: Vector3; q: Quaternion }[] {
  return [...dice.values()].map((d) => {
    let hull = hulls.get(d.half);
    if (!hull) {
      hull = Float32Array.from(d6Corners(d.half).flatMap((v) => [v.x, v.y, v.z]));
      hulls.set(d.half, hull);
    }
    return { hull, p: d.p.clone(), q: d.q.clone() };
  });
}

// ---- taken pieces lying about, for the board simulations ---------------------------

/** Simulation tracks for taken pieces are keyed by this and the piece's id. */
export const TAKEN = 'taken:';

let takenSource: (() => (Obstacle & { id: string })[]) | null = null;
/** Where the taken pieces lie (BoardScene tells). */
export function setTakenSource(fn: (() => (Obstacle & { id: string })[]) | null): void {
  takenSource = fn;
}
export const takenNow = () => takenSource?.() ?? [];

type TrackHandler = (frames: Float32Array, steps: number, dt: number, start: number) => void;
const pushers = new Map<string, TrackHandler>();
/** A taken piece listens for being pushed about by a piece moving past (a board simulation). */
export function onPushed(id: string, handler: TrackHandler): () => void {
  pushers.set(id, handler);
  return () => {
    if (pushers.get(id) === handler) pushers.delete(id);
  };
}
/** The taken-piece tracks of a board simulation, played from `start`. */
export function playTakenTracks(tracks: ReadonlyMap<string, Float32Array>, steps: number, dt: number, start: number): void {
  for (const [key, frames] of tracks) if (key.startsWith(TAKEN)) pushers.get(key.slice(TAKEN.length))?.(frames, steps, dt, start);
}

