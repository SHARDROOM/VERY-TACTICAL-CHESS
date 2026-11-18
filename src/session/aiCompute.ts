import { chooseMove, type AiLevel, type AiMove, type GameState } from '../engine';

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

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { resolve: (m: AiMove | null) => void; state: GameState; level: AiLevel; seed: number }>();

/** Thinks right here (tests, or no worker): the same answer, only the page waits. */
const here = (state: GameState, level: AiLevel, seed: number) => chooseMove(state, level, seededRandom(seed));

function theWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; move: AiMove | null }>) => {
      const w = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      w?.resolve(e.data.move);
    };
    // A worker that cannot run: think here from now on (and finish what was asked of it).
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const [id, w] of waiting) {
        waiting.delete(id);
        w.resolve(here(w.state, w.level, w.seed));
      }
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** The AI's normal move (see engine/ai.ts), thought out in a worker when there is one. */
export function chooseMoveAsync(state: GameState, level: AiLevel, seed: number): Promise<AiMove | null> {
  const w = theWorker();
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(here(state, level, seed)), 0));
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, { resolve, state, level, seed });
    w.postMessage({ id, state, level, seed });
  });
}
