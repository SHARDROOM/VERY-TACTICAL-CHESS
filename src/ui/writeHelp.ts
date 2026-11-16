import { TERRAIN_NAME, parseSquare, squareName, terrainAt, type GameState, type Square } from '../engine';
import { PIECE_NAME } from './messages';
import { josa } from './josa';

/*
 * 행동 쓰기 도움: with it on, tapping the board writes the declaration's squares for you. The
 * first tap (on one of your own pieces) names who does it ("d2의 폰이 "); every tap after that
 * names what it is done to ("d4의 룩에게 ", "e5에 ", "d4의 벽에 "). The player writes the rest.
 */

/** Squares named in a declaration, in order ("e4^" is the air above e4). */
function namedSquares(text: string): Square[] {
  return [...text.toLowerCase().matchAll(/[a-h][1-8]\^?/g)].map((m) => parseSquare(m[0])).filter((s): s is Square => s !== null);
}

/**
 * The declaration with what tapping `sq` adds, or why nothing was added. Before anyone is named
 * (the text has no square yet), only the side to move's own piece may be tapped.
 */
export function tapToWrite(state: GameState, sq: Square, text: string): { text: string } | { warn: string } {
  const piece = state.board[sq];
  const name = squareName(sq);
  let phrase: string;
  if (!namedSquares(text).length) {
    if (piece?.color !== state.turn) return { warn: '먼저 행동할 내 기물을 누르세요.' };
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

/** Who and what the declaration names, to ring them on the board: the first square, then the rest. */
export function writtenMarks(text: string): { actor: Square; targets: Square[] } | null {
  const [actor, ...targets] = namedSquares(text);
  return actor === undefined ? null : { actor, targets: [...new Set(targets)].filter((t) => t !== actor) };
}
