/// <reference lib="webworker" />
import { chooseMove, type AiLevel, type GameState } from '../engine';
import { seededRandom } from './aiCompute';

/** Thinks the AI's moves away from the page, so the table keeps moving meanwhile. */
self.onmessage = (e: MessageEvent<{ id: number; state: GameState; level: AiLevel; seed: number }>) => {
  const { id, state, level, seed } = e.data;
  let move = null;
  try {
    move = chooseMove(state, level, seededRandom(seed));
  } catch {
    move = null;
  }
  (self as unknown as Worker).postMessage({ id, move });
};
