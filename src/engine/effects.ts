import type { Board, Effect, GameEvent, Piece, Ruling, Square } from './types';
import type { RuleConfig } from './config';
import { squareName } from './squares';

export type EffectResult =
  | { ok: true; board: Board; events: GameEvent[]; touched: Square[] }
  | { ok: false; detail: string };

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const onBoard = (sq: unknown): sq is Square => isInt(sq) && sq >= 0 && sq < 64;

/**
 * Applies effects in order. Fails (without partial changes) if any effect is
 * impossible on the board as it stands at that point, or would remove a king:
 * a king can only ever be taken by a normal chess move.
 */
export function applyEffects(start: Board, effects: readonly Effect[]): EffectResult {
  const board: (Piece | null)[] = [...start];
  const events: GameEvent[] = [];
  const touched: Square[] = [];

  for (const [i, e] of effects.entries()) {
    const where = `효과 ${i + 1}`;
    switch (e.type) {
      case 'move': {
        if (!onBoard(e.from) || !onBoard(e.to)) return { ok: false, detail: `${where}: 보드 밖의 칸` };
        const piece = board[e.from];
        if (!piece) return { ok: false, detail: `${where}: ${squareName(e.from)}에 기물이 없음` };
        if (e.from === e.to) return { ok: false, detail: `${where}: 같은 칸으로 이동` };
        const occupant = board[e.to];
        if (occupant?.color === piece.color) {
          return { ok: false, detail: `${where}: ${squareName(e.to)}에 같은 편 기물이 있음` };
        }
        if (occupant?.type === 'king') return { ok: false, detail: `${where}: 특수 행동으로는 킹을 잡을 수 없음` };
        board[e.to] = piece;
        board[e.from] = null;
        touched.push(e.from, e.to);
        events.push({ type: 'moved', pieceId: piece.id, from: e.from, to: e.to, captured: occupant });
        break;
      }
      case 'remove': {
        if (!onBoard(e.at)) return { ok: false, detail: `${where}: 보드 밖의 칸` };
        const piece = board[e.at];
        if (!piece) return { ok: false, detail: `${where}: ${squareName(e.at)}에 기물이 없음` };
        if (piece.type === 'king') return { ok: false, detail: `${where}: 특수 행동으로는 킹을 제거할 수 없음` };
        board[e.at] = null;
        touched.push(e.at);
        events.push({ type: 'removed', piece, at: e.at });
        break;
      }
      default:
        return { ok: false, detail: `${where}: 알 수 없는 효과 종류` };
    }
  }
  return { ok: true, board, events, touched };
}

/** Checks a ruling against the rules and dry-runs its effects. Returns a problem description, or null if valid. */
export function validateRuling(board: Board, ruling: Ruling, rules: RuleConfig): string | null {
  if (typeof ruling.interpretation !== 'string' || !Array.isArray(ruling.effects)) return '판정 형식이 올바르지 않음';
  if (!ruling.feasible) return null;
  if (!isInt(ruling.dc) || ruling.dc < rules.dcMin || ruling.dc > rules.dcMax) {
    return `DC ${ruling.dc}이(가) 허용 범위(${rules.dcMin}~${rules.dcMax})를 벗어남`;
  }
  if (!isInt(ruling.cost) || ruling.cost < rules.costMin || ruling.cost > rules.costMax) {
    return `AP 비용 ${ruling.cost}이(가) 허용 범위(${rules.costMin}~${rules.costMax})를 벗어남`;
  }
  if (ruling.effects.length > rules.maxEffects) return `효과가 너무 많음 (최대 ${rules.maxEffects}개)`;
  const dry = applyEffects(board, ruling.effects);
  return dry.ok ? null : dry.detail;
}
