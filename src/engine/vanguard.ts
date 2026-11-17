import { canResist, clashMultiplier, clashWinChance } from './clash';
import { isInCheck, movesFrom } from './moves';
import { planeOf, playersOf } from './squares';
import { hasTag } from './tags';
import { CONFUSED, VANGUARD, type Board, type Color, type GameState, type PieceType, type Square } from './types';

/*
 * Pieces that move of their own accord at the end of their owner's turn (docs/SPEC.md, "혼란과
 * 행동대장"): a 혼란 piece staggers to a random free square it could move to; a 행동대장 piece makes
 * the best move it sees, looking at the reply. The runner of the game picks (randomly, or with
 * vanguardChoice) and sends an 'impulse' command; the engine checks it against impulseTargets.
 */

export type ImpulseKind = 'confused' | 'vanguard';

/** What drives the piece on `from` at its turn's end, if anything (혼란 wins over 행동대장). */
export function impulseOf(board: Board, from: Square): ImpulseKind | null {
  const p = board[from];
  if (!p) return null;
  if (hasTag(p, CONFUSED)) return 'confused';
  if (hasTag(p, VANGUARD)) return 'vanguard';
  return null;
}

/** A king never walks into an attack of its own accord. */
function kingSafeAfter(board: Board, from: Square, to: Square, terrain: GameState['terrain']): boolean {
  const piece = board[from]!;
  if (piece.type !== 'king') return true;
  const b = [...board];
  b[to] = piece;
  b[from] = null;
  return !isInCheck(b, piece.color, terrain);
}

/**
 * Where the piece on `from` may go of its own accord: 혼란, only free squares; 행동대장, also
 * captures, but never of a king (a turn's end gives no one a chance to answer).
 */
export function impulseTargets(state: GameState, from: Square, kind: ImpulseKind): Square[] {
  const { board, terrain } = state;
  const piece = board[from];
  if (!piece) return [];
  return movesFrom(board, from, terrain).filter((to) => {
    const there = board[to];
    if (kind === 'confused' ? !!there : there?.type === 'king' || there?.color === piece.color) return false;
    return kingSafeAfter(board, from, to, terrain);
  });
}

const VALUE: Record<PieceType, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

/** Material for `me` against everyone else (kings count only as being in danger). */
function material(board: Board, me: Color): number {
  let sum = 0;
  for (const p of board) if (p && p.color !== 'gray') sum += p.color === me ? VALUE[p.type] : -VALUE[p.type] / Math.max(1, playersOf().length - 1);
  return sum;
}

/** The most `by` can win with one capture on `board` (what it takes, as material). */
function bestCapture(board: Board, by: Color, terrain: GameState['terrain']): number {
  let best = 0;
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (p?.color !== by) continue;
    for (const to of movesFrom(board, sq, terrain)) {
      const there = board[to];
      if (!there || there.color === by) continue;
      // Taking a king ends it: as bad as it gets.
      const worth = there.type === 'king' ? 50 : VALUE[there.type];
      if (worth > best) best = worth;
    }
  }
  return best;
}

/** How the board looks for `me` after the reply: material, minus the worst capture an opponent can make, a little for the centre. */
function judge(board: Board, me: Color, at: Square | null, terrain: GameState['terrain']): number {
  const others = playersOf().filter((c) => c !== me && board.some((p) => p?.color === c));
  const threat = Math.max(0, ...others.map((c) => bestCapture(board, c, terrain)));
  const exposed = isInCheck(board, me, terrain) ? 30 : 0;
  let centre = 0;
  if (at !== null) {
    const { x, y } = planeOf(at);
    // The classic board's centre is (3.5, 3.5); the hexagon's plane is centred on 0.
    centre = -0.04 * (playersOf().length > 2 ? Math.hypot(x, y) : Math.hypot(x - 3.5, y - 3.5));
  }
  return material(board, me) - threat - exposed + centre;
}

/**
 * The 행동대장's choice: the move whose result is best for its side after the opponents' best
 * capture in reply (a capture into a clash counted by its chances), or null to hold its ground
 * when no move beats standing still.
 */
export function vanguardChoice(state: GameState, from: Square): Square | null {
  const { board, terrain } = state;
  const piece = board[from];
  if (!piece) return null;
  const me = piece.color;
  let best: { to: Square | null; score: number } = { to: null, score: judge(board, me, from, terrain) + 0.01 };
  for (const to of impulseTargets(state, from, 'vanguard')) {
    const victim = board[to];
    const after = [...board];
    after[to] = piece;
    after[from] = null;
    let score = judge(after, me, to, terrain);
    if (victim && canResist(victim)) {
      // A clash: lost, our piece falls instead and theirs stays.
      const lost = [...board];
      lost[from] = null;
      const p = clashWinChance(clashMultiplier(piece), clashMultiplier(victim));
      score = p * score + (1 - p) * judge(lost, me, null, terrain);
    }
    if (score > best.score) best = { to, score };
  }
  return best.to;
}
