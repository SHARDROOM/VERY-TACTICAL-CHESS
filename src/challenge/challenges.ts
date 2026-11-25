import { createStateFrom, parseSquare, type Color, type GameState, type PieceType, type TerrainCell } from '../engine';

/*
 * 도전 판 (사용자 요청): three set boards with a goal and a few turns to reach it. The player's
 * own GM rules the special actions (whatever GM is chosen); the engine decides whether the goal
 * is met. Black is played by an easy AI that tries no special actions. No stars: done or not.
 * docs/SPEC.md, "도전 판".
 */

export interface Challenge {
  id: 'knight' | 'walls' | 'altar';
  title: string;
  /** The goal, as the list and the game's badge say it. */
  goal: string;
  /** A hint for how it might be done (special actions are the way). */
  hint: string;
  /** White's turns to do it in. */
  turns: number;
  /** The board it starts from (white to move). */
  start: () => GameState;
  /** Whether the goal is met in this state. */
  met: (state: GameState) => boolean;
}

type Spec = Record<string, { color: Color; type: PieceType }>;
const w = (type: PieceType) => ({ color: 'white' as const, type });
const b = (type: PieceType) => ({ color: 'black' as const, type });

function board(spec: Spec, ap: number, extra: Partial<GameState> = {}): GameState {
  const s = createStateFrom(spec, 'white', extra);
  return { ...s, ap: { ...s.ap, white: ap, black: 2 } };
}

const cell = (name: string, kind: 'wall' | 'pit'): TerrainCell => ({ at: parseSquare(name)!, kind, turnsLeft: null, owner: 'black', appliedOnTurn: 0 });
const has = (s: GameState, color: Color, type: PieceType) => s.board.some((p) => p?.color === color && p.type === type);

export const CHALLENGES: Challenge[] = [
  {
    id: 'knight',
    title: '기사의 돌격',
    goal: '3턴 안에 흑 퀸을 잡으세요.',
    hint: '나이트 둘과 AP 3. 퀸은 도망칩니다: 돌진, 연속 이동, 기절 같은 특수 행동으로 길을 여세요.',
    turns: 3,
    start: () =>
      board(
        {
          e1: w('king'), b1: w('knight'), g1: w('knight'), d2: w('pawn'), e2: w('pawn'), f2: w('pawn'),
          e8: b('king'), d6: b('queen'), c7: b('pawn'), e7: b('pawn'), f7: b('pawn'), g7: b('pawn'), b7: b('pawn'),
        },
        3,
      ),
    met: (s) => !has(s, 'black', 'queen'),
  },
  {
    id: 'walls',
    title: '성벽 넘기',
    goal: '5턴 안에 흑 킹을 잡으세요. 5번째 줄은 벽과 구덩이로 막혀 있습니다.',
    hint: '벽에는 사다리를, 구덩이에는 다리를 놓거나, 벽을 부수거나, 나이트처럼 뛰어넘는 능력을 얻으세요.',
    turns: 5,
    start: () =>
      board(
        {
          e1: w('king'), d1: w('queen'), a1: w('rook'), h1: w('rook'), c2: w('pawn'), d2: w('pawn'), e2: w('pawn'), f2: w('pawn'),
          e8: b('king'), d7: b('pawn'), e7: b('pawn'), f7: b('pawn'),
        },
        4,
        { terrain: [cell('a5', 'pit'), ...['b5', 'c5', 'd5', 'e5', 'f5', 'g5'].map((n) => cell(n, 'wall')), cell('h5', 'pit')] },
      ),
    met: (s) => s.status.kind === 'won' && s.status.winner === 'white',
  },
  {
    id: 'altar',
    title: '피의 제단',
    goal: '5턴 안에 검술 ×2 룩을 쓰러뜨리세요.',
    hint: '배율 태그가 있는 룩은 단번에 죽지 않고 합으로 싸웁니다. 곁의 폰을 제물로 바쳐 배율을 키운 뒤 맞서세요.',
    turns: 5,
    start: () => {
      const s = board(
        {
          e1: w('king'), c3: w('knight'), b2: w('pawn'), c2: w('pawn'), d2: w('pawn'), b3: w('pawn'), d3: w('pawn'),
          h8: b('king'), d5: b('rook'), g7: b('pawn'), h7: b('pawn'),
        },
        5,
      );
      const at = parseSquare('d5')!;
      const bd = [...s.board];
      bd[at] = { ...bd[at]!, tags: [{ name: '검술', turnsLeft: null, appliedOnTurn: 0, clash: 2, prop: { preset: 'sword', parts: [], attach: 'rightHand', scale: 1.2 } }] };
      return { ...s, board: bd };
    },
    met: (s) => !has(s, 'black', 'rook'),
  },
];

/** White's turns used so far (white moves on odd turn numbers). */
export const whiteTurnsUsed = (s: GameState) => Math.floor(s.turnNumber / 2);

/** How it stands: done, failed (the turns ran out, white lost, or a draw), or still going. */
export function challengeOutcome(c: Challenge, s: GameState): 'won' | 'lost' | null {
  if (c.met(s)) return 'won';
  if (s.status.kind !== 'playing') return 'lost';
  if (s.turn === 'white' && whiteTurnsUsed(s) >= c.turns) return 'lost';
  return null;
}

/** White's turns left (this one included while it is white's). */
export const turnsLeft = (c: Challenge, s: GameState) => Math.max(0, c.turns - whiteTurnsUsed(s));
