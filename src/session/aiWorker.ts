/// <reference lib="webworker" />
import { think, type AiJob } from './aiCompute';

/** Thinks the AI's moves (and whether to roll) away from the page, so the table keeps moving meanwhile. */
self.onmessage = (e: MessageEvent<{ id: number; job: AiJob }>) => {
  const { id, job } = e.data;
  let result = null;
  try {
    result = think(job);
  } catch {
    result = job.kind === 'roll' ? false : null;
  }
  (self as unknown as Worker).postMessage({ id, result });
};
