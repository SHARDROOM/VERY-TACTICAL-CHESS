import type { Square } from './types';
import { parseSquare } from './squares';

/** Parses coordinate moves such as "e2e4", "e2-e4", "e2 e4". */
export function parseMoveText(text: string): { from: Square; to: Square } | null {
  const m = /^\s*([a-h][1-8])\s*[-\s]?\s*([a-h][1-8])\s*$/i.exec(text);
  if (!m) return null;
  const from = parseSquare(m[1]);
  const to = parseSquare(m[2]);
  return from === null || to === null ? null : { from, to };
}
