import type { PromotionType, Square } from './types';
import { isHex, parseSquare } from './squares';

const PROMOTION_WORDS: Record<string, PromotionType> = {
  q: 'queen', r: 'rook', b: 'bishop', n: 'knight',
  퀸: 'queen', 룩: 'rook', 비숍: 'bishop', 나이트: 'knight',
};

/**
 * Parses coordinate moves such as "e2e4", "e2-e4", "e2 e4", with an optional
 * promotion suffix: "e7e8q", "e7e8=Q", "e7e8 퀸". In the air: "e4^e5^", or just "e4^e5"
 * (a piece in the air stays there).
 */
export function parseMoveText(text: string): { from: Square; to: Square; promotion?: PromotionType } | null {
  if (isHex()) return parseHexMove(text);
  const m = /^\s*([a-h][1-8]\^?)\s*[-\s]?\s*([a-h][1-8])(\^?)\s*(?:=?\s*([qrbn]|퀸|룩|비숍|나이트))?\s*$/i.exec(text);
  if (!m) return null;
  const from = parseSquare(m[1]);
  const up = m[1].endsWith('^') || m[3] === '^';
  const to = parseSquare(m[2] + (up ? '^' : ''));
  if (from === null || to === null) return null;
  const promotion = m[4] ? PROMOTION_WORDS[m[4].toLowerCase()] : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

/**
 * The hexagon: "백e2 백e4", "백e2-백e4" or "백e2백e4" (each square named with its half, see
 * squareName), or the second on the same half as the first: "백e2e4". Promotion as above.
 */
function parseHexMove(text: string): { from: Square; to: Square; promotion?: PromotionType } | null {
  const m = /^\s*((?:[백흑적]|[wbr]-?)\s?[a-h][1-4]\^?)\s*[-\s]?\s*((?:[백흑적]|[wbr]-?)?\s?[a-h][1-4])(\^?)\s*(?:=?\s*([qrbn]|퀸|룩|비숍|나이트))?\s*$/i.exec(text);
  if (!m) return null;
  const from = parseSquare(m[1]);
  const up = m[1].endsWith('^') || m[3] === '^';
  // The second square without a half is on the first one's.
  const second = /^[a-h]/i.test(m[2].trim()) ? m[1].trim().replace(/[a-h][1-4]\^?$/i, '') + m[2].trim() : m[2];
  const to = parseSquare(second + (up ? '^' : ''));
  if (from === null || to === null) return null;
  const promotion = m[4] ? PROMOTION_WORDS[m[4].toLowerCase()] : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}
