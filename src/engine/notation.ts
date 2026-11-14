import type { PromotionType, Square } from './types';
import { parseSquare } from './squares';

const PROMOTION_WORDS: Record<string, PromotionType> = {
  q: 'queen', r: 'rook', b: 'bishop', n: 'knight',
  퀸: 'queen', 룩: 'rook', 비숍: 'bishop', 나이트: 'knight',
};

/**
 * Parses coordinate moves such as "e2e4", "e2-e4", "e2 e4", with an optional
 * promotion suffix: "e7e8q", "e7e8=Q", "e7e8 퀸".
 */
export function parseMoveText(text: string): { from: Square; to: Square; promotion?: PromotionType } | null {
  const m = /^\s*([a-h][1-8])\s*[-\s]?\s*([a-h][1-8])\s*(?:=?\s*([qrbn]|퀸|룩|비숍|나이트))?\s*$/i.exec(text);
  if (!m) return null;
  const from = parseSquare(m[1]);
  const to = parseSquare(m[2]);
  if (from === null || to === null) return null;
  const promotion = m[3] ? PROMOTION_WORDS[m[3].toLowerCase()] : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}
