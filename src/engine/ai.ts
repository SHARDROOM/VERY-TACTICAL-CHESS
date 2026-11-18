import { canResist, clashMultiplier, clashWinChance } from './clash';
import { saverFor } from './guard';
import { legalTargets, movesFrom } from './moves';
import { planeOf, playersOf, promotesOn, rankOf, isAir, setBoardMap, isHex } from './squares';
import { BURN, CONFUSED, GUARD, HOSTAGE, LEVITATE, SHIELD, STUN, VANGUARD, type Board, type Color, type GameState, type Piece, type PieceType, type Square, type TerrainCell } from './types';
import { hasTag, withoutTag } from './tags';

/*
 * The AI players' chess (docs/SPEC.md, "AI 플레이어"): which normal move to make. A minimax search
 * with alpha-beta over this game's own moves (tags, terrain, the air, the hexagon), on a light copy
 * of the rules: a capture into a clash is weighed by its chances, a capture a guard or a hostage
 * takes for the target counts as such, a pawn reaching the far side becomes a queen. On the
 * hexagon every opponent is taken to play against this AI (paranoid search). Special actions,
 * chaos and the wanderers are left out.
 *
 * Four levels: 쉬움 (one move ahead, and slips now and then), 보통 (the reply too), 어려움 (three
 * moves ahead, the odd slip), 무아 (ever deeper until its time is up, captures followed to the
 * end, never a slip).
 */

export type AiLevel = 'easy' | 'normal' | 'hard' | 'master';
export const AI_LEVELS: readonly AiLevel[] = ['easy', 'normal', 'hard', 'master'];
export const AI_LEVEL_NAME: Record<AiLevel, string> = { easy: '쉬움', normal: '보통', hard: '어려움', master: '무아' };
/** How often an AI tries a special action: never, now and then, whenever it has AP. */
export type AiSpecials = 'off' | 'some' | 'often';
export const AI_SPECIALS: readonly AiSpecials[] = ['off', 'some', 'often'];
export const AI_SPECIALS_NAME: Record<AiSpecials, string> = { off: '끔', some: '가끔', often: '자주' };
/** An AI in a seat. */
export interface AiSeat {
  level: AiLevel;
  specials: AiSpecials;
}

/** A normal move the AI makes (`to` null: it ends its turn, e.g. stopping a run of moves). */
export interface AiMove {
  from: Square;
  to: Square | null;
}

const VALUE: Record<PieceType, number> = { pawn: 1, knight: 3.2, bishop: 3.3, rook: 5, queen: 9, king: 0 };
const KING_LOST = 100_000;

/** What a piece is worth to its side: its kind, what it took in (융합), and what its tags give it. */
function worth(p: Piece): number {
  let v = VALUE[p.type];
  for (const c of p.fuse?.crowns ?? []) v += VALUE[c.type] * 0.4;
  // What a tag does for the piece beyond what the search sees in a move or two: a stun or a
  // hold costs it its next turns, an extra way to move or a skill is worth having for longer.
  let lost = 0;
  for (const t of p.tags ?? []) {
    if (t.clash) v += (t.clash - 1) * 1.5;
    if (t.name === SHIELD) v += 0.6;
    if (t.name === STUN) lost = Math.max(lost, 0.15);
    if (t.name === HOSTAGE) lost = Math.max(lost, 0.3);
    if (t.name === CONFUSED) lost = Math.max(lost, 0.1);
    if (t.name === BURN) lost = Math.max(lost, 0.1);
    if (t.moveAs?.length) v += 0.4 * t.moveAs.length;
    if (t.moveTimes) v += 0.4 * (t.moveTimes - 1);
    if (t.skill) v += 0.15 * t.skill.bonus;
    if (t.mind) v += 0.1 * t.mind;
    if (t.name === LEVITATE || t.name === GUARD || t.name === VANGUARD) v += 0.2;
  }
  v -= VALUE[p.type] * lost;
  if (p.rider) v += worth(p.rider);
  return v;
}

/** Where on the board it stands, for its kind: knights and bishops like the centre, pawns like to advance. */
function placeBonus(p: Piece, sq: Square): number {
  if (isAir(sq) || p.type === 'king' || p.type === 'rook') return 0;
  const { x, y } = planeOf(sq);
  const off = isHex() ? Math.hypot(x, y) / 2 : Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5));
  let b = (p.type === 'knight' || p.type === 'bishop' ? 0.06 : 0.03) * (3.5 - Math.min(3.5, off));
  if (p.type === 'pawn' && !isHex()) b += 0.06 * (p.color === 'black' ? 6 - rankOf(sq) : rankOf(sq) - 1);
  return b;
}

/** The board as `me` sees it: its pieces against the others' (each opponent's share on the hexagon). */
export function evaluate(board: Board, me: Color): number {
  const sides = playersOf();
  const opponents = Math.max(1, sides.length - 1);
  let score = 0;
  const kings = new Set<Color>();
  board.forEach((p, sq) => {
    if (!p || p.color === 'gray') return;
    if (p.type === 'king') kings.add(p.color);
    const v = worth(p) + placeBonus(p, sq);
    score += p.color === me ? v : -v / opponents;
  });
  if (!kings.has(me)) return -KING_LOST;
  for (const c of sides) if (c !== me && !kings.has(c) && board.some((p) => p?.color === c)) score += 40;
  return score;
}

/** Who moves after `turn` on `board`: the next in turn order that still has pieces. */
function nextTurn(board: Board, turn: Color): Color {
  const all = playersOf();
  const i = all.indexOf(turn);
  for (let k = 1; k <= all.length; k++) {
    const c = all[(i + k) % all.length];
    if (board.some((p) => p?.color === c)) return c;
  }
  return all[(i + 1) % all.length];
}

interface Ctx {
  me: Color;
  terrain: readonly TerrainCell[] | undefined;
  deadline: number;
  quiet: number;
  nodes: number;
}

class OutOfTime extends Error {}

/** One way a move can turn out: the board after it and how likely (a clash can go either way). */
interface Outcome {
  board: Board;
  p: number;
}

/** The board after `from` → `to` (light rules), as one or two outcomes. */
function play(board: Board, from: Square, to: Square): Outcome[] {
  const piece = board[from]!;
  const victim = board[to];
  const moveTo = (b: (Piece | null)[]) => {
    b[to] = piece.type === 'pawn' && !isAir(to) && promotesOn(piece.color, to) ? { ...piece, type: 'queen' } : piece;
    b[from] = null;
    return b;
  };
  if (!victim) return [{ board: moveTo([...board]), p: 1 }];
  // A guard or a hostage goes down in its place; the attacker stays (or fights the guard).
  const saver = saverFor(board, to);
  if (saver) {
    const s = board[saver.at]!;
    const lost = [...board];
    lost[saver.at] = null;
    if (!canResist(s)) return [{ board: lost, p: 1 }];
    const p = clashWinChance(clashMultiplier(piece), clashMultiplier(s));
    const won = [...board];
    if (hasTag(s, SHIELD)) won[saver.at] = withoutTag(s, SHIELD);
    else won[saver.at] = null;
    const fell = [...board];
    fell[from] = null;
    return [
      { board: won, p },
      { board: fell, p: 1 - p },
    ];
  }
  if (!canResist(victim)) return [{ board: moveTo([...board]), p: 1 }];
  const p = clashWinChance(clashMultiplier(piece), clashMultiplier(victim));
  let won: (Piece | null)[];
  if (hasTag(victim, SHIELD)) {
    won = [...board];
    won[to] = withoutTag(victim, SHIELD);
  } else won = moveTo([...board]);
  const fell = [...board];
  fell[from] = null;
  return [
    { board: won, p },
    { board: fell, p: 1 - p },
  ];
}

/** Every move of `turn`'s pieces on `board`, captures (the most valuable first) before the rest. */
function movesOf(board: Board, turn: Color, terrain: Ctx['terrain'], capturesOnly = false): [Square, Square][] {
  const caps: [Square, Square, number][] = [];
  const quiet: [Square, Square][] = [];
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (p?.color !== turn) continue;
    for (const to of movesFrom(board, sq, terrain)) {
      const v = board[to];
      if (v) caps.push([sq, to, (v.type === 'king' ? 1000 : worth(v)) * 10 - VALUE[p.type]]);
      else if (!capturesOnly) quiet.push([sq, to]);
    }
  }
  caps.sort((a, b) => b[2] - a[2]);
  return [...caps.map(([a, b]) => [a, b] as [Square, Square]), ...quiet];
}

const kingGone = (board: Board, c: Color) => !board.some((p) => p?.type === 'king' && p.color === c);

/** The value of `board` for ctx.me with `turn` to move, `depth` plies ahead (then captures only). */
function search(board: Board, turn: Color, depth: number, alpha: number, beta: number, ctx: Ctx, ply: number): number {
  if ((++ctx.nodes & 255) === 0 && performance.now() > ctx.deadline) throw new OutOfTime();
  if (kingGone(board, ctx.me)) return -KING_LOST + ply;
  if (!isHex()) for (const c of playersOf()) if (c !== ctx.me && kingGone(board, c)) return KING_LOST - ply;
  const maximizing = turn === ctx.me;
  const quiescing = depth <= 0;
  let best: number;
  if (quiescing) {
    // Standing still is an option: only captures are looked at, and not too far.
    best = evaluate(board, ctx.me);
    if (depth <= -ctx.quiet) return best;
    if (maximizing) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (alpha >= beta) return best;
  } else best = maximizing ? -Infinity : Infinity;
  const moves = movesOf(board, turn, ctx.terrain, quiescing);
  if (!moves.length) return quiescing ? best : evaluate(board, ctx.me);
  const next = (b: Board) => nextTurn(b, turn);
  for (const [from, to] of moves) {
    let v = 0;
    const outcomes = play(board, from, to);
    // A clash can go either way: each outcome is searched in full (bounds do not hold for a mix).
    for (const o of outcomes) v += o.p * search(o.board, next(o.board), depth - 1, outcomes.length > 1 ? -Infinity : alpha, outcomes.length > 1 ? Infinity : beta, ctx, ply + 1);
    if (maximizing) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

/** How each level thinks: plies, captures followed after that, time, and how often it slips. */
const LEVEL: Record<AiLevel, { depth: number; quiet: number; ms: number; deepen: boolean; noise: number; slip: number }> = {
  easy: { depth: 1, quiet: 0, ms: 600, deepen: false, noise: 1.2, slip: 0.25 },
  normal: { depth: 2, quiet: 1, ms: 1200, deepen: false, noise: 0.15, slip: 0 },
  hard: { depth: 3, quiet: 2, ms: 2500, deepen: true, noise: 0.05, slip: 0.05 },
  master: { depth: 12, quiet: 4, ms: 4000, deepen: true, noise: 0, slip: 0 },
};

/**
 * The AI's normal move for the player to move in `state`, at `level`. `random` (0..1) decides its
 * slips and ties, so the runner can make it repeatable. Null: it has no move at all.
 */
export function chooseMove(state: GameState, level: AiLevel, random: () => number = Math.random, now: () => number = () => performance.now()): AiMove | null {
  setBoardMap(state.map);
  const me = state.turn;
  const cfg = LEVEL[level];
  const { board, terrain } = state;
  // Its moves as the rules allow them right now (a run of moves: that piece only, or stop).
  const roots: AiMove[] = [];
  for (let sq = 0; sq < board.length; sq++) {
    if (board[sq]?.color !== me || (state.chain && sq !== state.chain.at)) continue;
    for (const t of legalTargets(state, sq)) {
      // After a special action this turn, kings are off limits.
      if (state.usedApThisTurn && board[t.to]?.type === 'king') continue;
      roots.push({ from: sq, to: t.to });
    }
  }
  if (state.chain) roots.push({ from: state.chain.at, to: null });
  if (!roots.length) return null;
  const ctx: Ctx = { me, terrain, deadline: now() + cfg.ms, quiet: cfg.quiet, nodes: 0 };
  const after = (m: AiMove) => (m.to === null ? [{ board, p: 1 }] : play(board, m.from, m.to));
  // Captures first, so a deadline mid-way has already looked at them.
  const ordered = [...roots].sort((a, b) => (b.to !== null && board[b.to] ? 1 : 0) - (a.to !== null && board[a.to] ? 1 : 0));
  let scores = new Map<AiMove, number>(ordered.map((m) => [m, 0]));
  let done = false;
  for (let depth = cfg.deepen ? 1 : cfg.depth; depth <= cfg.depth; depth++) {
    const round = new Map<AiMove, number>();
    try {
      let alpha = -Infinity;
      for (const m of ordered) {
        let v = 0;
        const outcomes = after(m);
        for (const o of outcomes) v += o.p * search(o.board, nextTurn(o.board, me), depth - 1, outcomes.length > 1 ? -Infinity : alpha - 1e-6, Infinity, ctx, 1);
        round.set(m, v);
        alpha = Math.max(alpha, v);
      }
    } catch (e) {
      if (!(e instanceof OutOfTime)) throw e;
      // The deeper round did not finish: keep what the last whole round found (or this one's, if none did).
      if (!done) for (const [m, v] of round) scores.set(m, v);
      break;
    }
    scores = round;
    done = true;
    // Best first next time round.
    ordered.sort((a, b) => (round.get(b) ?? 0) - (round.get(a) ?? 0));
    if (now() > ctx.deadline) break;
  }
  const ranked = [...scores].map(([m, v]) => ({ m, v: v + (cfg.noise ? (random() - 0.5) * 2 * cfg.noise : 0) })).sort((a, b) => b.v - a.v);
  // A slip: one of the next best instead (never one that throws a king away).
  if (cfg.slip && ranked.length > 1 && random() < cfg.slip) {
    const near = ranked.slice(1, 4).filter((r) => r.v > -KING_LOST / 2);
    if (near.length) return near[Math.floor(random() * near.length) % near.length].m;
  }
  return ranked[0].m;
}

/** A surrendering AI keeps its strongest piece (3인 육각 맵: the one that goes into exile). */
export function aiExile(state: GameState, loser: Color): Square | null {
  let best: { sq: Square; v: number } | null = null;
  state.board.forEach((p, sq) => {
    if (p?.color === loser && p.type !== 'king') {
      const v = worth(p);
      if (!best || v > best.v) best = { sq, v };
    }
  });
  return (best as { sq: Square; v: number } | null)?.sq ?? null;
}

// ---- special actions ---------------------------------------------------------------

import { isAttacked } from './moves';
import { applyEffects } from './effects';
import { modifierTotal, pendingModifiers } from './modifiers';
import { distance, squareName } from './squares';

const KIND_KO: Record<PieceType, string> = { king: '킹', queen: '퀸', rook: '룩', bishop: '비숍', knight: '나이트', pawn: '폰' };

/**
 * What the engine sees for `me`, in a few lines for the LLM that makes up the AI's declarations:
 * its pieces under attack and not covered (위험), and others' it attacks that are not (기회).
 */
export function aiHints(state: GameState, me: Color): string[] {
  setBoardMap(state.map);
  const { board, terrain } = state;
  const danger: string[] = [];
  const chance: string[] = [];
  board.forEach((p, sq) => {
    if (!p || p.type === 'king' || p.color === 'gray') return;
    const others = playersOf().filter((c) => c !== p.color);
    const hit = others.some((c) => isAttacked(board, sq, c, terrain));
    if (!hit) return;
    const covered = isAttacked(board.map((x, i) => (i === sq ? null : x)), sq, p.color, terrain);
    if (p.color === me && !covered) danger.push(`${squareName(sq)} ${KIND_KO[p.type]}`);
    else if (p.color !== me && !covered && isAttacked(board, sq, me, terrain)) chance.push(`${squareName(sq)} ${KIND_KO[p.type]}`);
  });
  const out: string[] = [];
  if (danger.length) out.push(`위험(공격받는데 지켜 주는 기물이 없음): ${danger.slice(0, 4).join(', ')}`);
  if (chance.length) out.push(`기회(공짜로 잡을 수 있음): ${chance.slice(0, 4).join(', ')}`);
  const near = targetsFor(board, me, 3);
  if (near.length) out.push(`노릴 만한 표적(값지고 가까운 순): ${near.join(', ')}`);
  out.push(`판세(엔진 점수, +면 유리): ${evaluate(board, me).toFixed(1)}`);
  return out;
}

/** The chance that two dice plus `bonus` reach `dc` (snake eyes never do), and of snake eyes. */
function odds(dc: number, bonus: number): { win: number; fumble: number } {
  let wins = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b !== 2 && a + b + bonus >= dc) wins++;
  return { win: wins / 36, fumble: 1 / 36 };
}

/**
 * What one AP is worth on the board, roughly (a pawn is 1). AP is good for nothing but special
 * actions (and second tries), so it is cheap: a 2-AP action that wins a pawn more often than not pays.
 */
const AP_WORTH = 0.25;

/** The odds an AI of `level` wants before it rolls (보통 only; the others go by value). */
export const AI_NORMAL_MIN_CHANCE = 0.4;

/** The hardest DC worth declaring for at `level` (what the AI asks the GM's model to aim under). */
export function aiMaxDc(level: AiLevel): number | null {
  return level === 'easy' ? null : level === 'normal' ? 8 : 9;
}

/**
 * How `boards` look to `me` with `me` to move: its best move and the replies, captures followed
 * (2 plies, then 1, then a glance if time runs out: the same depth for all, so they compare).
 */
function lookAhead(boards: Board[], me: Color, terrains: (readonly TerrainCell[] | undefined)[], ms: number, now: () => number): number[] {
  const deadline = now() + ms;
  for (const depth of [2, 1]) {
    try {
      return boards.map((b, i) => search(b, me, depth, -Infinity, Infinity, { me, terrain: terrains[i], deadline, quiet: 2, nodes: 0 }, 0));
    } catch (e) {
      if (!(e instanceof OutOfTime)) throw e;
    }
  }
  return boards.map((b) => evaluate(b, me));
}

/**
 * Whether the AI rolls for its pending ruling (or a second try): 쉬움 always; 보통 when it
 * succeeds at least 40% of the time; 어려움 and 무아 when the expected change of the game is worth
 * the AP. The change is looked at as play goes on (its move after the action and the replies), so
 * a stun that stops an attacker or a shield on a piece that cannot get away count, not only pieces
 * taken; a backfire on snake eyes counts against it.
 */
export function aiShouldRoll(state: GameState, level: AiLevel, now: () => number = () => performance.now()): boolean {
  setBoardMap(state.map);
  const pending = state.pending;
  if (!pending || !pending.ruling.feasible) return false;
  const cost = pending.retry ? state.rules.rerollCost : pending.ruling.cost;
  if (cost > state.ap[pending.color] || (pending.retry && state.rules.rerollCost <= 0)) return false;
  const bonus = modifierTotal(pendingModifiers(state.board, pending, state.remains));
  const { win, fumble } = odds(pending.ruling.dc, bonus);
  if (level === 'easy') return true;
  if (level === 'normal') return win >= AI_NORMAL_MIN_CHANCE;
  const me = pending.color;
  // A sacrifice is made whatever the dice say (once): the effects happen without those pieces.
  const start = [...state.board];
  if (!pending.offered) for (const at of pending.ruling.sacrifice ?? []) start[at] = null;
  const ctx = {
    turnNumber: state.turnNumber,
    nextSpawnId: state.nextSpawnId,
    color: me,
    terrain: state.terrain ?? [],
    captured: state.captured ?? [],
    remains: state.remains ?? [],
    clash: { mode: 'check' as const },
    ...(pending.ruling.actor != null && { actor: pending.ruling.actor }),
  };
  const tryOut = (effects: Parameters<typeof applyEffects>[1]) => {
    const r = effects.length ? applyEffects(start, effects, ctx) : null;
    return r?.ok ? { board: r.board, terrain: r.terrain } : { board: start, terrain: state.terrain };
  };
  const won = tryOut(pending.ruling.effects);
  const backfire = tryOut(pending.ruling.critFailureEffects ?? []);
  const [base, stay, success, fumbled] = lookAhead(
    [state.board, start, won.board, backfire.board],
    me,
    [state.terrain, state.terrain, won.terrain, backfire.terrain],
    level === 'master' ? 900 : 500,
    now,
  );
  const expected = win * success + fumble * fumbled + (1 - win - fumble) * stay;
  // With AP to spare, spending some costs less.
  const apWorth = state.ap[me] - cost >= 2 ? AP_WORTH / 2 : AP_WORTH;
  return expected - base > cost * apWorth;
}

/**
 * The others' pieces worth going for, nearest of its own first: "d8 퀸 (f6 나이트에서 2칸)" (at
 * most `count`). A near target makes an easy ruling.
 */
function targetsFor(board: Board, me: Color, count: number): string[] {
  const mine: Square[] = [];
  board.forEach((p, sq) => p?.color === me && mine.push(sq));
  const list: { line: string; score: number }[] = [];
  board.forEach((p, sq) => {
    if (!p || p.color === me || p.color === 'gray' || p.type === 'king' || !mine.length) return;
    const from = mine.reduce((a, b) => (distance(a, sq) <= distance(b, sq) ? a : b));
    const d = distance(from, sq);
    list.push({ line: `${squareName(sq)} ${KIND_KO[p.type]} (${squareName(from)} ${KIND_KO[board[from]!.type]}에서 ${d}칸)`, score: worth(p) - d * 1.2 });
  });
  return list
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((t) => t.line);
}
