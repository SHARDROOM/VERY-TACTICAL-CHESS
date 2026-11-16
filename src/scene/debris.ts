import { Quaternion, Vector3 } from 'three';

/*
 * The chunks of shattered pieces lying about the table (docs/SPEC.md, "부서진 조각"): where each
 * one rests, and the recording it is playing, if any (its burst, a shove from a piece moving
 * past, a fling from the player's finger). Pieces moving through them push them about (the board
 * simulations take them as bodies, boardPhysics.ts), the player can drag them (ShardScatter), and
 * they fly back together when their piece is revived (ShardGather). Only a look, kept on this
 * screen: every screen that saw the same game keeps them alike, since the simulations agree.
 */

/** Simulation tracks for chunks are keyed by this and the chunk's key (pieces by their id). */
export const CHUNK = 'chunk:';

export interface Track {
  /** 7 numbers per step: world position, rotation quaternion. */
  frames: Float32Array;
  steps: number;
  dt: number;
  /** performance.now() ms of its first step. */
  start: number;
}

export interface Chunk {
  /** `${pieceId}#${index}` */
  key: string;
  pieceId: string;
  index: number;
  /** Hull points around its middle (for the physics). */
  hull: Float32Array;
  /** Where it rests (world), once whatever it is playing is over. */
  p: Vector3;
  q: Quaternion;
  track?: Track;
  /** Held by the player's finger: it is where the finger puts it. */
  held?: boolean;
}

const chunks = new Map<string, Chunk>();

export const chunkKey = (pieceId: string, index: number) => `${pieceId}#${index}`;

export function addChunk(c: Chunk): void {
  chunks.set(c.key, c);
}

export function getChunk(key: string): Chunk | undefined {
  return chunks.get(key);
}

/** The chunks of one piece, in order. */
export function chunksOf(pieceId: string): Chunk[] {
  return [...chunks.values()].filter((c) => c.pieceId === pieceId).sort((a, b) => a.index - b.index);
}

/** Every chunk gone (the table is cleared). */
export function clearChunks(): void {
  chunks.clear();
}

export function removeChunks(pieceId: string): void {
  for (const c of chunksOf(pieceId)) chunks.delete(c.key);
}

/** Every chunk, for a simulation (steady ones only: one being held or still flying stays out). */
export function restingChunks(): Chunk[] {
  const now = performance.now();
  return [...chunks.values()].filter((c) => !c.held && (!c.track || now >= trackEnd(c.track)));
}

const trackEnd = (t: Track) => t.start + t.steps * t.dt * 1000;

/** Plays a recording on a chunk; it rests where the recording ends. */
export function playChunk(c: Chunk, frames: Float32Array, steps: number, dt: number, start: number): void {
  c.track = { frames, steps, dt, start };
  const k = (steps - 1) * 7;
  c.p.set(frames[k], frames[k + 1], frames[k + 2]);
  c.q.set(frames[k + 3], frames[k + 4], frames[k + 5], frames[k + 6]);
}

/** The chunk tracks of a board simulation (keys starting with CHUNK), played from `start`. */
export function playChunkTracks(tracks: ReadonlyMap<string, Float32Array>, steps: number, dt: number, start: number): void {
  for (const [key, frames] of tracks) {
    if (!key.startsWith(CHUNK)) continue;
    const c = chunks.get(key.slice(CHUNK.length));
    if (c) playChunk(c, frames, steps, dt, start);
  }
}

/** Where a chunk is now (world): along what it is playing, else where it rests. */
export function chunkPose(c: Chunk, now: number, p: Vector3, q: Quaternion): void {
  const t = c.track;
  if (t && now < trackEnd(t)) {
    const step = Math.max(0, Math.min(t.steps - 1, Math.floor((now - t.start) / 1000 / t.dt)));
    const k = step * 7;
    p.set(t.frames[k], t.frames[k + 1], t.frames[k + 2]);
    q.set(t.frames[k + 3], t.frames[k + 4], t.frames[k + 5], t.frames[k + 6]);
    return;
  }
  if (t) c.track = undefined;
  p.copy(c.p);
  q.copy(c.q);
}

/** Whether a chunk's recording has not started yet (a burst waiting for its moment). */
export const chunkWaiting = (c: Chunk, now: number) => !!c.track && now < c.track.start;
