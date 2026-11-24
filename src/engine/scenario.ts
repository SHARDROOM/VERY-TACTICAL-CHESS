import { CONFUSED, SHIELD, VANGUARD, type Color, type Effect, type GameState, type PieceType, type Square } from './types';
import { playersOf, squareAt } from './squares';
import { BUILDING_INFO } from './terrain';

/*
 * 랜덤 시나리오 (사용자 요청): chosen in the waiting room, a game may start in an odd situation,
 * read out on a parchment before the first move: pieces missing or changed, pieces dazed or
 * armed, buildings or pits on the field. Every side gets the same (the squares picked at random
 * for each), so it stays fair. docs/SPEC.md, "랜덤 시나리오".
 */

export interface ScenarioCard {
  id: string;
  /** "제식 훈련" */
  title: string;
  /** What the parchment says. */
  text: string;
}

type Pick = <T>(list: readonly T[], n: number) => T[];

interface ScenarioDef extends ScenarioCard {
  /** The effects for one side (`pieces(type)`: its pieces of a kind, `rank(r)`: its empty squares on its r-th rank from home, 0 = the back rank). */
  effects: (side: { pieces: (...types: PieceType[]) => Square[]; empty: (r: number) => Square[]; pick: Pick }) => Effect[];
}

const sword = { preset: 'sword' as const, parts: [], attach: 'rightHand' as const, scale: 1 };
const building = (kind: 'church' | 'forge') => ({ kind, name: BUILDING_INFO[kind].name, about: BUILDING_INFO[kind].about, bonus: 2 });
const NOT_KING: PieceType[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'conscription',
    title: '저조한 징집률',
    text: '징집에 응한 젊은이가 적었습니다. 모든 진영이 폰 2개 없이 시작합니다.',
    effects: ({ pieces, pick }) => pick(pieces('pawn'), 2).map((at) => ({ type: 'remove', at })),
  },
  {
    id: 'walls',
    title: '굳건한 성벽',
    text: '성벽을 지키던 수비대가 합류했습니다. 모든 진영의 폰 2개가 룩으로 시작합니다.',
    effects: ({ pieces, pick }) => pick(pieces('pawn'), 2).map((at) => ({ type: 'transform', at, into: 'rook' })),
  },
  {
    id: 'light',
    title: '이상한 빛',
    text: '밤새 하늘에 이상한 빛이 떠 있었습니다. 모든 진영의 기물 2개가 혼란에 빠진 채 시작합니다(2턴).',
    effects: ({ pieces, pick }) => pick(pieces(...NOT_KING), 2).map((at) => ({ type: 'tag', at, tag: CONFUSED, turns: 2 })),
  },
  {
    id: 'drill',
    title: '제식 훈련',
    text: '혹독한 제식 훈련을 마쳤습니다. 모든 폰이 검을 들고 시작합니다(검술 ×1.3).',
    effects: ({ pieces }) => pieces('pawn').map((at) => ({ type: 'tag', at, tag: '검술', turns: 0, clash: 1.3, prop: sword })),
  },
  {
    id: 'affair',
    title: '불륜',
    text: '궁정에 소문이 돕니다. 모든 진영의 비숍 하나가 퀸이 되어 시작합니다.',
    effects: ({ pieces, pick }) => pick(pieces('bishop'), 1).map((at) => ({ type: 'transform', at, into: 'queen' })),
  },
  {
    id: 'generals',
    title: '대장군',
    text: '이름난 장군들이 군을 이끕니다. 모든 진영의 기물 3개가 행동대장으로 시작합니다(3턴).',
    effects: ({ pieces, pick }) => pick(pieces(...NOT_KING), 3).map((at) => ({ type: 'tag', at, tag: VANGUARD, turns: 3 })),
  },
  {
    id: 'blessing',
    title: '왕실의 축복',
    text: '사제가 왕실을 축복했습니다. 모든 진영의 퀸이 보호막을 두르고 시작합니다.',
    effects: ({ pieces }) => pieces('queen').map((at) => ({ type: 'tag', at, tag: SHIELD, turns: 0 })),
  },
  {
    id: 'cavalry',
    title: '기마 전통',
    text: '말을 타고 자란 기사들입니다. 모든 진영의 나이트가 한 턴에 두 번 연속 움직일 수 있습니다(3턴).',
    effects: ({ pieces }) => pieces('knight').map((at) => ({ type: 'tag', at, tag: '질주', turns: 3, moveTimes: 2 })),
  },
  {
    id: 'chapel',
    title: '성스러운 땅',
    text: '전장 곁에 교회가 서 있습니다. 모든 진영의 세 번째 줄에 교회가 있습니다(곁에서 되살리면 +2).',
    effects: ({ empty, pick }) => pick(empty(2), 1).map((at) => ({ type: 'terrain', at, kind: 'wall', turns: 0, building: building('church') })),
  },
  {
    id: 'forge',
    title: '대장간 마을',
    text: '대장장이들이 전장 곁에 자리 잡았습니다. 모든 진영의 세 번째 줄에 대장간이 있습니다(곁에서 무기를 만들면 +2).',
    effects: ({ empty, pick }) => pick(empty(2), 1).map((at) => ({ type: 'terrain', at, kind: 'wall', turns: 0, building: building('forge') })),
  },
  {
    id: 'shelling',
    title: '포격의 흔적',
    text: '밤새 포탄이 쏟아졌습니다. 모든 진영 앞에 구덩이 2개가 패어 있습니다(5턴).',
    effects: ({ empty, pick }) => pick([...empty(2), ...empty(3)], 2).map((at) => ({ type: 'terrain', at, kind: 'pit', turns: 5 })),
  },
];

/** `n` of `list` at random (fewer if it has fewer). */
export const picker = (random: () => number): Pick => (list, n) => {
  const rest = [...list];
  const out: (typeof list)[number][] = [];
  while (out.length < n && rest.length) out.push(rest.splice(Math.floor(random() * rest.length), 1)[0]);
  return out;
};

/** One scenario's effects for every side of this board (square helpers follow the board set now). */
export function scenarioEffects(def: ScenarioDef, state: GameState, random: () => number): Effect[] {
  const sides = playersOf(state.map);
  const pick = picker(random);
  return sides.flatMap((color: Color, half) => {
    const pieces = (...types: PieceType[]) => state.board.flatMap((p, sq) => (p && p.color === color && types.includes(p.type) && !p.rider ? [sq] : []));
    const empty = (r: number) => {
      const out: Square[] = [];
      for (let f = 0; f < 8; f++) {
        const sq = state.map === 'hex3' ? squareAt(f, r, half as 0 | 1 | 2) : squareAt(f, color === 'white' ? r : 7 - r);
        if (sq !== null && !state.board[sq] && !state.terrain?.some((c) => c.at === sq)) out.push(sq);
      }
      return out;
    };
    return def.effects({ pieces, empty, pick });
  });
}
