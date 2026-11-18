import { aiShouldRoll, chooseMove, type AiLevel, type AiMove, type GameState } from '../engine';

/** A repeatable 0..1 sequence from a seed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the AI thinks about away from the page: its move, or whether to roll for its ruling. */
export type AiJob = { kind: 'move'; state: GameState; level: AiLevel; seed: number } | { kind: 'roll'; state: GameState; level: AiLevel };

/** Thinks it through right here (tests, or no worker): the same answer, only the page waits. */
export function think(job: AiJob): AiMove | boolean | null {
  return job.kind === 'move' ? chooseMove(job.state, job.level, seededRandom(job.seed)) : aiShouldRoll(job.state, job.level);
}

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { resolve: (r: AiMove | boolean | null) => void; job: AiJob }>();

function theWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: AiMove | boolean | null }>) => {
      const w = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      w?.resolve(e.data.result);
    };
    // A worker that cannot run: think here from now on (and finish what was asked of it).
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const [id, w] of waiting) {
        waiting.delete(id);
        w.resolve(think(w.job));
      }
    };
  } catch {
    worker = null;
  }
  return worker;
}

function run(job: AiJob): Promise<AiMove | boolean | null> {
  const w = theWorker();
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(think(job)), 0));
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, { resolve, job });
    w.postMessage({ id, job });
  });
}

/** The AI's normal move (see engine/ai.ts), thought out in a worker when there is one. */
export function chooseMoveAsync(state: GameState, level: AiLevel, seed: number): Promise<AiMove | null> {
  return run({ kind: 'move', state, level, seed }) as Promise<AiMove | null>;
}

/** Whether the AI rolls for its pending ruling (it looks ahead a little, so in the worker too). */
export function shouldRollAsync(state: GameState, level: AiLevel): Promise<boolean> {
  return run({ kind: 'roll', state, level }) as Promise<boolean>;
}
