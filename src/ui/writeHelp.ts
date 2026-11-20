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

/** A run of the declaration: free text, or a square written by tapping (who acts, or what it is done to). */
type Part =
  | { kind: 'text'; text: string }
  | { kind: 'phrase'; sq: Square; label: string; role: 'actor' | 'piece' | 'ground' };

/** "d2의 폰이", "d7의 폰에게", "b1의 나이트와", "e5에", "d4의 벽에": a square, maybe what is on it, a particle. */
const PHRASE = () => new RegExp(`(${SQUARE_PATTERN()})(?:의 ([가-힣]+))?(이|가|에게|에|과|와)(?=\\s|$)`, 'gi');
const PIECE_NAMES = new Set(Object.values(PIECE_NAME));

/** The declaration cut into what tapping wrote and what the player typed between. */
function parts(text: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(PHRASE())) {
    const sq = parseSquare(m[1]);
    if (sq === null) continue;
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    const [, name, thing, particle] = m;
    const role = particle === '이' || particle === '가' ? 'actor' : particle === '에게' || (thing && PIECE_NAMES.has(thing) && particle !== '에') ? 'piece' : 'ground';
    out.push({ kind: 'phrase', sq, label: thing ? `${name}의 ${thing}` : name, role });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/**
 * The declaration written back. What is acted on in a row (only spaces between) is joined by 와/과,
 * the last of the row taking its own particle: "b1의 나이트와 g8의 나이트에게", "d4와 e5에".
 */
function render(list: Part[]): string {
  const isTarget = (p: Part | undefined) => p?.kind === 'phrase' && p.role !== 'actor';
  const words = list.map((p, i) => {
    if (p.kind === 'text') return p.text;
    if (p.role === 'actor') return josa(p.label, '이/가');
    // The next part that is not just spaces: another thing acted on joins this one.
    let j = i + 1;
    while (list[j]?.kind === 'text' && !(list[j] as { text: string }).text.trim()) j++;
    if (isTarget(list[j])) return josa(p.label, '와/과');
    return `${p.label}${p.role === 'piece' ? '에게' : '에'}`;
  });
  return words.join('').replace(/ {2,}/g, ' ').replace(/^ +/, '');
}

/**
 * The declaration with what tapping `sq` adds, or why nothing was added. Taps can come in any
 * order: the first of the side to move's own pieces tapped (while nobody acts yet) is who does it
 * ("d2의 폰이"); every other piece is what it is done to ("d7의 폰에게"), a square where ("e5에").
 * Tapping a square already written takes it out again (사용자 요청); several things acted on in a
 * row are joined by 와/과.
 */
export function tapToWrite(state: GameState, sq: Square, text: string): { text: string } | { warn: string } {
  const list = parts(text);
  const at = list.findIndex((p) => p.kind === 'phrase' && p.sq === sq);
  if (at >= 0) {
    list.splice(at, 1);
    return { text: render(list) };
  }
  const piece = state.board[sq];
  const name = squareName(sq);
  const someoneActs = list.some((p) => p.kind === 'phrase' && p.role === 'actor') || subjectSquare(text) !== null;
  let phrase: Part;
  if (piece && piece.color === state.turn && !someoneActs) phrase = { kind: 'phrase', sq, label: `${name}의 ${PIECE_NAME[piece.type]}`, role: 'actor' };
  else if (piece) phrase = { kind: 'phrase', sq, label: `${name}의 ${PIECE_NAME[piece.type]}`, role: 'piece' };
  else {
    const ground = terrainAt(state.terrain, sq);
    phrase = { kind: 'phrase', sq, label: ground ? `${name}의 ${TERRAIN_NAME[ground.kind]}` : name, role: 'ground' };
  }
  if (text.length && !/\s$/.test(text)) list.push({ kind: 'text', text: ' ' });
  list.push(phrase, { kind: 'text', text: ' ' });
  const next = render(list);
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
