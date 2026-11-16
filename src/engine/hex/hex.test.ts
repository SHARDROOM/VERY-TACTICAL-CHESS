import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HEX_SQUARES, hexCenter, hexSquareAt, isDark, step, type Dir } from './geometry';
import { applyCommand, createInitialState, createStateFrom, legalTargets, movesFrom, parseSquare, setBoardMap, squareName, type Color, type GameState, type PieceType } from '../index';

const sq = (name: string) => {
  const s = parseSquare(name);
  if (s === null) throw new Error(name);
  return s;
};
const names = (list: number[]) => list.map(squareName).sort();
const hex = (placements: Record<string, { color: Color; type: PieceType }>, turn: Color = 'white', extra: Partial<GameState> = {}) =>
  createStateFrom(placements, turn, { map: 'hex3', ...extra });
const alone = (at: string, type: PieceType, color: Color = 'white') => hex({ [at]: { color, type } });
const movesOf = (s: GameState, at: string) => names(movesFrom(s.board, sq(at), s.terrain));
const ALL: Dir[] = [-1, 0, 1].flatMap((df) => [-1, 0, 1].map((dr) => ({ df, dr }))).filter((d) => d.df || d.dr);

describe('the three-player board', () => {
  beforeAll(() => setBoardMap('hex3'));
  afterAll(() => setBoardMap('classic'));

  it('names squares by the half they are on', () => {
    expect(squareName(sq('흑e4'))).toBe('흑e4');
    expect(sq('흑 e4')).toBe(sq('b-e4'));
    expect(squareName(sq('적a1^'))).toBe('적a1^');
  });

  it('a step and its way back meet again, everywhere, except through the centre', () => {
    for (let s = 0; s < HEX_SQUARES; s++) {
      for (const d of ALL) {
        const out = step(s, d);
        if (out.length !== 1) continue;
        const back = step(out[0].sq, { df: -out[0].dir.df, dr: -out[0].dir.dr });
        expect(back.map((b) => b.sq)).toContain(s);
      }
    }
  });

  it('only the diagonals through the centre split, into the other halves', () => {
    expect(names(step(sq('백d4'), { df: 1, dr: 1 }).map((s) => s.sq))).toEqual(['적d4', '흑d4']);
    let splits = 0;
    for (let s = 0; s < HEX_SQUARES; s++) for (const d of ALL) if (step(s, d).length > 1) splits++;
    expect(splits).toBe(6);
  });

  it('every square is found again from its own centre on the plane', () => {
    for (let s = 0; s < HEX_SQUARES; s++) expect(hexSquareAt(hexCenter(s).x, hexCenter(s).y)).toBe(s);
    expect(hexSquareAt(0, -9)).toBeNull();
  });

  it('a rook goes up a file and on down the half across: a–d into red, e–h into black', () => {
    expect(movesOf(alone('백d1', 'rook'), '백d1')).toEqual(expect.arrayContaining(['백d4', '적e4', '적e1']));
    expect(movesOf(alone('백f2', 'rook'), '백f2')).toEqual(expect.arrayContaining(['백f4', '흑c4', '흑c1']));
  });

  it('a bishop through the centre goes on from both other d4s, never onto the opposite e4', () => {
    const b2 = movesOf(alone('백b2', 'bishop'), '백b2');
    expect(b2).toEqual(expect.arrayContaining(['백c3', '백d4', '흑d4', '흑a1', '적d4', '적a1']));
    expect(b2).not.toContain('흑e4');
  });

  it('a bishop never leaves its colour and a knight always changes it, from anywhere', () => {
    for (let s = 0; s < HEX_SQUARES; s++) {
      for (const t of movesFrom(alone(squareName(s), 'bishop').board, s)) expect(isDark(t)).toBe(isDark(s));
      for (const t of movesFrom(alone(squareName(s), 'knight').board, s)) expect(isDark(t)).not.toBe(isDark(s));
    }
    expect(movesOf(alone('백b1', 'knight'), '백b1')).toEqual(['백a3', '백c3', '백d2']);
  });

  it('pawns: two from the start, on down the half across, promoting on another back rank', () => {
    expect(movesOf(alone('백a2', 'pawn'), '백a2')).toEqual(['백a3', '백a4']);
    expect(movesOf(alone('백a4', 'pawn'), '백a4')).toEqual(['적h4']);
    expect(movesOf(alone('적h3', 'pawn', 'red'), '적h3')).toEqual(['적h4']);
    expect(movesOf(alone('적h2', 'pawn'), '적h2')).toEqual(['적h1']);
    const s = alone('적h2', 'pawn');
    expect(applyCommand(s, { type: 'move', from: sq('적h2'), to: sq('적h1') })).toMatchObject({ ok: false, reason: 'promotionRequired' });
  });

  it('the start: three armies on their own halves; turns go white, black, red', () => {
    const s0 = createInitialState(undefined, 'hex3');
    for (const c of ['white', 'black', 'red'] as const) expect(s0.board.filter((p) => p?.color === c)).toHaveLength(16);
    expect(s0.board[sq('흑e1')]).toMatchObject({ type: 'king', color: 'black' });
    let s = s0;
    for (const [from, to, next] of [['백e2', '백e4', 'black'], ['흑e2', '흑e4', 'red'], ['적e2', '적e4', 'white']] as const) {
      const r = applyCommand(s, { type: 'move', from: sq(from), to: sq(to) });
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
      expect(s.turn).toBe(next);
    }
    // Castling on its own back rank.
    const c = hex({ '흑e1': { color: 'black', type: 'king' }, '흑h1': { color: 'black', type: 'rook' } }, 'black', {
      castling: { white: { kingSide: false, queenSide: false }, black: { kingSide: true, queenSide: false }, red: { kingSide: false, queenSide: false } },
    });
    expect(legalTargets(c, sq('흑e1')).find((t) => t.special?.kind === 'castle')?.to).toBe(sq('흑g1'));
  });

  it('a king is in check from either other player', () => {
    const s = hex({ '백e1': { color: 'white', type: 'king' }, '적d4': { color: 'red', type: 'bishop' }, '흑e1': { color: 'black', type: 'king' } }, 'red');
    const r = applyCommand(s, { type: 'move', from: sq('적d4'), to: sq('적c3') });
    if (!r.ok) throw new Error(r.reason);
    expect(r.events.filter((e) => e.type === 'check')).toEqual([]);
    // A rook on red's e-file looks straight down white's d-file... and on to nothing; up black's? no.
    const s2 = hex({ '백d1': { color: 'white', type: 'king' }, '적e2': { color: 'red', type: 'rook' }, '흑e1': { color: 'black', type: 'king' } }, 'red');
    const r2 = applyCommand(s2, { type: 'move', from: sq('적e2'), to: sq('적e3') });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.events).toContainEqual({ type: 'check', color: 'white' });
  });

  it('en passant on a half', () => {
    let s = hex({ '백e2': { color: 'white', type: 'pawn' }, '백d4': { color: 'black', type: 'pawn' }, '백a1': { color: 'white', type: 'king' }, '흑a1': { color: 'black', type: 'king' } });
    const r = applyCommand(s, { type: 'move', from: sq('백e2'), to: sq('백e4') });
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    expect(s.enPassant).toBe(sq('백e3'));
    expect(legalTargets(s, sq('백d4'))).toContainEqual({ to: sq('백e3'), special: { kind: 'enPassant' } });
    // (The black pawn on white's d4 heads down white's half, toward white's back rank.)
    const r2 = applyCommand(s, { type: 'move', from: sq('백d4'), to: sq('백e3') });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.state.board[sq('백e4')]).toBeNull();
  });
});

describe('surrender and exile on the hexagon', () => {
  beforeAll(() => setBoardMap('hex3'));
  afterAll(() => setBoardMap('classic'));
  const P = (color: Color, type: PieceType) => ({ color, type });
  const go = (s: GameState, cmd: Parameters<typeof applyCommand>[1]) => {
    const r = applyCommand(s, cmd);
    if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
    return r;
  };

  it('a king taken: its side surrenders, keeps the piece it picks under a hood, the rest turn', () => {
    const s0 = hex({
      '백e1': P('white', 'king'), '백d2': P('white', 'queen'),
      '흑e1': P('black', 'king'), '흑a1': P('black', 'rook'), '흑b1': P('black', 'knight'), '흑h2': P('black', 'pawn'),
      '적e1': P('red', 'king'),
    });
    // The white queen goes up white's d-file into red's e-file... a test position: put black's king in reach.
    const s1 = hex({ ...{}, '백e1': P('white', 'king'), '백e3': P('white', 'rook'), '흑e1': P('black', 'king'), '흑a1': P('black', 'rook'), '흑b1': P('black', 'knight'), '적e1': P('red', 'king') });
    void s0;
    // White's e-file runs on into black's d-file: put black's king there.
    const s2 = hex({ '백e1': P('white', 'king'), '백e3': P('white', 'rook'), '흑d2': P('black', 'king'), '흑a1': P('black', 'rook'), '흑b1': P('black', 'knight'), '적e1': P('red', 'king') });
    void s1;
    const r = go(s2, { type: 'move', from: sq('백e3'), to: sq('흑d2') });
    expect(r.events).toContainEqual({ type: 'surrendered', loser: 'black', to: 'white', keepsOne: true });
    expect(r.state.surrender).toEqual({ loser: 'black', to: 'white' });
    expect(r.state.status.kind).toBe('playing');
    // Nothing else happens until black picks.
    expect(applyCommand(r.state, { type: 'endTurn' })).toMatchObject({ ok: false, reason: 'surrenderPending' });
    expect(applyCommand(r.state, { type: 'exile', at: sq('백e1') })).toMatchObject({ ok: false, reason: 'notExiledPiece' });
    const e = go(r.state, { type: 'exile', at: sq('흑b1') });
    expect(e.state.board[sq('흑b1')]).toMatchObject({ color: 'black', type: 'knight', tags: [expect.objectContaining({ name: '누더기 후드', clash: 1 })] });
    expect(e.state.board[sq('흑a1')]).toMatchObject({ color: 'white', type: 'rook' });
    expect(e.state.surrender).toBeUndefined();
    // Black still takes its turns with its exile.
    expect(e.state.turn).toBe('black');
  });

  it('the hood makes a capture of the exile a clash', () => {
    const s = hex({ '백e1': P('white', 'king'), '백b3': P('white', 'rook'), '흑b1': P('black', 'knight'), '흑e1': P('black', 'king'), '적e1': P('red', 'king') });
    const b = [...s.board];
    b[sq('흑b1')] = { ...b[sq('흑b1')]!, tags: [{ name: '누더기 후드', turnsLeft: null, appliedOnTurn: 1, clash: 1 }] };
    // White's b-file runs into red's g-file... so take a square on white's own half instead.
    b[sq('백b1')] = b[sq('흑b1')];
    b[sq('흑b1')] = null;
    expect(applyCommand({ ...s, board: b }, { type: 'move', from: sq('백b3'), to: sq('백b1') })).toMatchObject({ ok: false, reason: 'clashRollsNeeded' });
  });

  it('an exile that takes a king is crowned, and its victim surrenders to it', () => {
    const hood = { name: '누더기 후드', turnsLeft: null, appliedOnTurn: 1, clash: 1 };
    const s = hex({ '흑d2': P('black', 'rook'), '백e1': P('white', 'king'), '백a2': P('white', 'pawn'), '적e1': P('red', 'king') }, 'black');
    const b = [...s.board];
    b[sq('흑d2')] = { ...b[sq('흑d2')]!, tags: [hood] };
    // Black's d-file runs into white's e-file: the exiled rook takes the white king.
    const r = go({ ...s, board: b }, { type: 'move', from: sq('흑d2'), to: sq('백e1') });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'crowned', color: 'black' }));
    expect(r.state.board[sq('백e1')]).toMatchObject({ type: 'king', color: 'black', tags: [] });
    expect(r.state.surrender).toEqual({ loser: 'white', to: 'black' });
    expect(r.state.status.kind).toBe('playing');
  });

  it('a king taken with nothing else of its side left: that side is out', () => {
    const s = hex({ '백e3': P('white', 'rook'), '백e1': P('white', 'king'), '흑d2': P('black', 'king'), '적e1': P('red', 'king') });
    const r = go(s, { type: 'move', from: sq('백e3'), to: sq('흑d2') });
    expect(r.events).toContainEqual({ type: 'surrendered', loser: 'black', to: 'white', keepsOne: false });
    expect(r.state.surrender).toBeUndefined();
    // Black has nothing left: red moves next.
    expect(r.state.turn).toBe('red');
  });

  it('the last king left wins', () => {
    const s = hex({ '백e3': P('white', 'rook'), '백e1': P('white', 'king'), '흑d2': P('black', 'king'), '흑a1': P('black', 'pawn') });
    const r = go(s, { type: 'move', from: sq('백e3'), to: sq('흑d2') });
    expect(r.state.status).toEqual({ kind: 'won', winner: 'white' });
    expect(r.events).toContainEqual({ type: 'kingCaptured', winner: 'white', loser: 'black' });
  });
});

describe('move text on the hexagon', () => {
  beforeAll(() => setBoardMap('hex3'));
  afterAll(() => setBoardMap('classic'));
  it('reads squares with their halves', async () => {
    const { parseMoveText } = await import('../notation');
    expect(parseMoveText('백e2 백e4')).toEqual({ from: sq('백e2'), to: sq('백e4') });
    expect(parseMoveText('백e2백e4')).toEqual({ from: sq('백e2'), to: sq('백e4') });
    expect(parseMoveText('흑d2d4')).toEqual({ from: sq('흑d2'), to: sq('흑d4') });
    expect(parseMoveText('백d1-적e1')).toEqual({ from: sq('백d1'), to: sq('적e1') });
    expect(parseMoveText('적b2 적b1 퀸')).toEqual({ from: sq('적b2'), to: sq('적b1'), promotion: 'queen' });
    expect(parseMoveText('e2e4')).toBeNull();
  });
});

describe('the GM on the hexagon', () => {
  beforeAll(() => setBoardMap('hex3'));
  afterAll(() => setBoardMap('classic'));
  it('sees three sides, the halves drawn as their owners see them, and squares named with their half', async () => {
    const { buildSystemPrompt, buildUserMessage } = await import('../../gm/prompt');
    const { DEFAULT_RULES } = await import('../config');
    const s = createInitialState({ ...DEFAULT_RULES, map: 'hex3' }, 'hex3');
    const sys = buildSystemPrompt(s.rules);
    expect(sys).toContain('## 3인 육각 판');
    expect(buildSystemPrompt(DEFAULT_RULES)).not.toContain('3인 육각 판');
    const m = buildUserMessage('흑e2의 폰이 백e2의 폰을 노린다', s);
    expect(m).toContain('- 상대: 흑');
    expect(m).toContain('- 상대: 적');
    expect(m).toContain('- 적: 룩 적a1');
    expect(m).toContain('(흑의 반쪽 판)');
    expect(m).toContain('1 br bn bb bq bk bb bn br');
    expect(m).toContain('흑e2(흑 폰)');
  });
});
