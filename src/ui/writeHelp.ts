import { TERRAIN_NAME, parseSquare, squareName, terrainAt, type GameState, type Square, SQUARE_PATTERN } from '../engine';
import { PIECE_NAME } from './messages';
import { josa } from './josa';

/*
 * 행동 쓰기 도움: with it on, tapping the board writes the declaration's squares for you, in the
 * order tapped: the player's own piece first tapped names who does it ("d2의 폰이 "), the rest
 * what it is done to ("d4의 룩에게 ", "e5에 ", "d4의 벽에 "). The player writes the rest.
 */

/** Squares named in a declaration, in order ("e4^" is the air above e4). */
function namedSquares(text: string): Square[] {
  return [...text.toLowerCase().matchAll(new RegExp(SQUARE_PATTERN(), 'g'))].map((m) => parseSquare(m[0])).filter((s): s is Square => s !== null);
}

/** The square named as who acts ("d2의 폰이"), if the declaration names one yet. */
function subjectSquare(text: string): Square | null {
  const m = text.toLowerCase().match(new RegExp(`(${SQUARE_PATTERN()})의 [가-힣]+(?:이|가)(?=\\s|$)`));
  return m ? parseSquare(m[1]) : null;
}

/**
 * The declaration with what tapping `sq` adds, or why nothing was added. Taps can come in any
 * order: the first of the side to move's own pieces tapped (while nobody acts yet) is who does it
 * ("d2의 폰이"); every other piece is what it is done to ("d7의 폰에게"), a square where ("e5에").
 */
export function tapToWrite(state: GameState, sq: Square, text: string): { text: string } | { warn: string } {
  const piece = state.board[sq];
  const name = squareName(sq);
  let phrase: string;
  if (piece && piece.color === state.turn && subjectSquare(text) === null) {
    phrase = `${name}의 ${josa(PIECE_NAME[piece.type], '이/가')}`;
  } else if (piece) {
    phrase = `${name}의 ${PIECE_NAME[piece.type]}에게`;
  } else {
    const ground = terrainAt(state.terrain, sq);
    phrase = ground ? `${name}의 ${TERRAIN_NAME[ground.kind]}에` : `${name}에`;
  }
  const before = text.length && !/\s$/.test(text) ? `${text} ` : text;
  const next = `${before}${phrase} `;
  if (next.length > state.rules.actionMaxLength) return { warn: `특수 행동은 ${state.rules.actionMaxLength}자까지 쓸 수 있습니다.` };
  return { text: next };
}

/** Who and what the declaration names, to ring them on the board (no one acting yet: actor -1). */
export function writtenMarks(text: string): { actor: Square; targets: Square[] } | null {
  const named = namedSquares(text);
  if (!named.length) return null;
  const actor = subjectSquare(text) ?? -1;
  return { actor, targets: [...new Set(named)].filter((t) => t !== actor) };
}
