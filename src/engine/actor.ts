import { MEANS, MEANS_NAME, type Board, type Color, type Effect, type Means, type Ruling, type Square } from './types';
import { fileOf, isAir, rankOf, squareName } from './squares';
import { isStunned } from './tags';
import { applyEffects, type EffectContext } from './effects';

/*
 * Every special action has a reason to work: one of the declarer's own pieces does it, by
 * some means, and a touch reaches only the squares next to it (docs/SPEC.md, "주체와 거리").
 * Whether an arrow or a spell is plausible at a distance is the GM's call (it sets the DC).
 */

/** Steps a king would need: e6 to e7 is 1, b1 to g8 is 7; the air above a square is 1 from it. */
export function distance(a: Square, b: Square): number {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)), isAir(a) === isAir(b) ? 0 : 1);
}

/** The squares an effect acts on, other than the actor's own (where it does things to others). */
export function targetsOf(e: Effect): Square[] {
  switch (e.type) {
    case 'move':
      return [e.from];
    case 'swap':
      return [e.a, e.b];
    case 'board':
      return [e.rider, e.carrier];
    case 'remove':
    case 'tag':
    case 'untag':
    case 'unboard':
    case 'transform':
    case 'spawn':
    case 'convert':
    case 'revive':
    case 'terrain':
    case 'clearTerrain':
    case 'cover':
    case 'clearCover':
      return [e.at];
  }
}

/** Where the piece with this id stands (or rides), or null if it is gone. */
function squareOf(board: Board, id: string): Square | null {
  const sq = board.findIndex((p) => p?.id === id || p?.rider?.id === id);
  return sq === -1 ? null : sq;
}

/**
 * Checks who acts and how far they reach, for a feasible ruling. Rulings made before the rule
 * (no `actor` at all) are left alone. Returns the problem, or null.
 */
export function checkActor(board: Board, ruling: Ruling, color: Color, ctx: EffectContext): string | null {
  if (ruling.actor === undefined) return null;
  if (ruling.actor === null) return '행동하는 내 기물(주체)이 없음: 누가 하는지 정해야 함';
  const at = ruling.actor;
  const piece = board[at];
  if (!piece || piece.color !== color) return `주체 칸 ${squareName(at)}에 ${color === 'white' ? '백' : '흑'} 기물이 없음`;
  if (isStunned(piece)) return `주체 ${squareName(at)}의 기물은 기절해서 행동할 수 없음`;
  const means: Means | undefined = ruling.means;
  if (!means || !MEANS.includes(means)) return '수단(means)이 올바르지 않음';
  if (means !== 'touch') return null;
  // A touch reaches 1 square from wherever the actor stands when it acts (it may step up first).
  for (const [label, list] of [['', ruling.effects], ['대성공 ', ruling.critSuccessEffects ?? []]] as const) {
    for (let i = 0; i < list.length; i++) {
      const before = i === 0 ? { ok: true as const, board } : applyEffects(board, list.slice(0, i), ctx);
      if (!before.ok) return null; // the effects themselves are checked (and reported) elsewhere
      const from = squareOf(before.board, piece.id);
      if (from === null) break;
      for (const t of targetsOf(list[i])) {
        const d = distance(from, t);
        if (t !== from && d > 1) return `${label}효과 ${i + 1}: ${MEANS_NAME.touch} 행동인데 ${squareName(t)}이(가) 주체에서 ${d}칸 떨어져 있음 (1칸 이내만)`;
      }
    }
  }
  return null;
}
