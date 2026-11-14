import { applyCommand, fileOf, parseSquare, rankOf, squareName, type Color, type GameState, type PieceType, type Square } from '../engine';
import type { GameMaster, GmChaosJson, GmEffectJson, GmRequest, GmRulingJson } from './types';
import { josa } from '../ui/josa';

const REMOVE_WORDS = /제거|파괴|없애|날려\s*버|암살|처치|저격|죽이|부숴|부순/;
const SPAWN_WORDS = /소환|생성|만든|만들|불러|부른|증원|창조/;
const TRANSFORM_WORDS = /변신|변환|바꾼|바꿔|바꾸|진화|둔갑/;
const PIECE_WORDS: [RegExp, Exclude<PieceType, 'king'>][] = [
  [/퀸|여왕/, 'queen'],
  [/룩/, 'rook'],
  [/비숍|주교/, 'bishop'],
  [/나이트|기사/, 'knight'],
  [/폰|병사/, 'pawn'],
];
const PIECE_KO: Record<Exclude<PieceType, 'king'>, string> = { queen: '퀸', rook: '룩', bishop: '비숍', knight: '나이트', pawn: '폰' };

/** The piece type named last in the text ("a2 폰을 퀸으로" → queen). */
function lastPieceWord(text: string): Exclude<PieceType, 'king'> | null {
  let best: { at: number; type: Exclude<PieceType, 'king'> } | null = null;
  for (const [re, type] of PIECE_WORDS) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) if (!best || m.index! > best.at) best = { at: m.index!, type };
  }
  return best?.type ?? null;
}

/**
 * A stand-in GM for development and tests. It only understands declarations
 * that mention squares:
 * - two squares + a riding word ("a2 폰을 b1 나이트에 태운다") → first boards second
 * - a square + 기절 → 1-turn stun; a square + 보호막 → permanent shield
 * - one or more squares + a removal word ("d7 폰을 저격한다") → remove the last square
 * - a square + a piece name + a summoning word ("e4에 나이트를 소환한다") → spawn one for the player
 * - a square + a piece name + a changing word ("a2 폰을 퀸으로 바꾼다") → transform
 * - two or more squares ("b1 나이트를 투석기로 e5까지") → move first → second
 * Anything else is ruled infeasible.
 */
export class FakeGameMaster implements GameMaster {
  readonly name = '가짜 GM (개발용)';

  constructor(private readonly delayMs = 500) {}

  async rule({ action, state }: GmRequest): Promise<GmRulingJson> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return fakeRuling(action, state.turn);
  }

  async chaos({ state }: { state: GameState }): Promise<GmChaosJson> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return fakeChaos(state);
  }
}

const SIDE: Record<Color, string> = { white: '백', black: '흑' };

/**
 * A random chaos event that the engine accepts for this board: a spy, a sandstorm,
 * lightning, a supply drop or a blessing. Each idea is tried on the board first.
 */
export function fakeChaos(state: GameState, random: () => number = Math.random): GmChaosJson {
  const pick = <T,>(xs: T[]): T | undefined => xs[Math.floor(random() * xs.length)];
  const squaresWhere = (f: (sq: Square) => boolean) => Array.from({ length: 64 }, (_, i) => i).filter(f);
  const pieceAt = (sq: Square) => state.board[sq];
  const nonKing = (color?: Color) => squaresWhere((sq) => !!pieceAt(sq) && pieceAt(sq)!.type !== 'king' && (!color || pieceAt(sq)!.color === color));
  const empty = squaresWhere((sq) => !pieceAt(sq) && rankOf(sq) > 0 && rankOf(sq) < 7);
  const name = (sq: Square) => squareName(sq);
  const KO: Record<PieceType, string> = { king: '킹', queen: '퀸', rook: '룩', bishop: '비숍', knight: '나이트', pawn: '폰' };

  const ideas: (() => GmChaosJson | null)[] = [
    () => {
      const color = pick<Color>(['white', 'black'])!;
      const sq = pick(squaresWhere((s) => pieceAt(s)?.color === color && pieceAt(s)?.type === 'pawn'));
      if (sq === undefined) return null;
      const other: Color = color === 'white' ? 'black' : 'white';
      return {
        title: '스파이 발각',
        narration: `${SIDE[color]}의 ${name(sq)} 폰은 사실 ${SIDE[other]}의 스파이였습니다! 가면을 벗어 던지고 편을 바꿉니다.`,
        effects: [{ type: 'convert', at: name(sq), color: other }],
      };
    },
    () => {
      const from = pick(nonKing().filter((s) => pieceAt(s)!.type !== 'queen'));
      const to = pick(empty);
      if (from === undefined || to === undefined) return null;
      const p = pieceAt(from)!;
      return {
        title: '모래바람',
        narration: `거센 모래바람이 ${SIDE[p.color]}의 ${KO[p.type]}을(를) ${name(from)}에서 ${name(to)}까지 날려 보냈습니다!`,
        effects: [{ type: 'move', from: name(from), to: name(to) }],
      };
    },
    () => {
      const at = pick(nonKing());
      if (at === undefined) return null;
      const p = pieceAt(at)!;
      return {
        title: '마른하늘에 벼락',
        narration: `맑은 하늘에서 벼락이 떨어져 ${name(at)}의 ${SIDE[p.color]} ${KO[p.type]}이(가) 정신을 잃었습니다.`,
        effects: [{ type: 'tag', at: name(at), tag: '기절', turns: 1 }],
      };
    },
    () => {
      const w = pick(empty.filter((s) => rankOf(s) <= 3));
      const b = pick(empty.filter((s) => rankOf(s) >= 4));
      if (w === undefined || b === undefined) return null;
      return {
        title: '보급품 투하',
        narration: `하늘에서 보급 상자가 떨어지더니, 양쪽 진영에 새 병사가 한 명씩 나타났습니다.`,
        effects: [
          { type: 'spawn', at: name(w), color: 'white', piece: 'pawn' },
          { type: 'spawn', at: name(b), color: 'black', piece: 'pawn' },
        ],
      };
    },
    () => {
      const w = pick(nonKing('white'));
      const b = pick(nonKing('black'));
      if (w === undefined || b === undefined) return null;
      return {
        title: '수호 정령의 축복',
        narration: `떠돌던 수호 정령이 ${name(w)}의 백 기물과 ${name(b)}의 흑 기물에 축복을 내렸습니다.`,
        effects: [
          { type: 'tag', at: name(w), tag: '보호막', turns: 0 },
          { type: 'tag', at: name(b), tag: '보호막', turns: 0 },
        ],
      };
    },
  ];

  // Try ideas in a random order until the engine accepts one.
  const order = ideas.map((idea) => ({ idea, key: random() })).sort((a, b) => a.key - b.key);
  for (const { idea } of order) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const event = idea();
      if (!event) break;
      const effects = event.effects.map(toEngineEffect);
      if (applyCommand(state, { type: 'chaos', chaos: { ...event, effects } }).ok) return event;
    }
  }
  return { title: '고요', narration: '바람 한 점 없이 고요합니다. 폭풍 전의 고요일까요?', effects: [] };
}

function toEngineEffect(e: GmEffectJson): never {
  const out: Record<string, unknown> = { ...e };
  for (const key of ['from', 'to', 'at', 'rider', 'carrier'] as const) {
    if (typeof out[key] === 'string') out[key] = parseSquare(out[key] as string);
  }
  return out as never;
}

export function fakeRuling(action: string, color: Color = 'white'): GmRulingJson {
  const base = fakeBaseRuling(action, color);
  // The fake GM keeps crits simple: a 20 does the same thing, a 1 stuns the acting piece for a turn.
  const actor = base.effects[0];
  const actorSquare = actor?.type === 'move' ? actor.from : actor?.type === 'board' ? actor.rider : null;
  return {
    ...base,
    critSuccessEffects: [],
    critFailureEffects: actorSquare ? [{ type: 'tag', at: actorSquare, tag: '기절', turns: 1 }] : [],
    narration: {
      ...base.narration,
      critSuccess: base.narration.success ? `완벽하다! ${base.narration.success}` : '',
      critFailure: actorSquare ? `대참사! 기물이 비틀거리다 정신을 잃었다.` : base.narration.failure,
    },
  };
}

type BaseRuling = Omit<GmRulingJson, 'critSuccessEffects' | 'critFailureEffects' | 'narration'> & {
  narration: { success: string; failure: string };
};

function fakeBaseRuling(action: string, color: Color): BaseRuling {
  const names = [...action.toLowerCase().matchAll(/[a-h][1-8]/g)].map((m) => m[0]);
  const squares = names.map(parseSquare).filter((s): s is Square => s !== null);

  if (squares.length >= 2 && /태워|태운|탑승|올라타/.test(action)) {
    const [rider, carrier] = names;
    return {
      interpretation: `${rider}의 기물이 ${carrier}의 기물에 올라탄다.`,
      feasible: true,
      dc: 8,
      cost: 1,
      effects: [{ type: 'board', rider, carrier }],
      narration: { success: `${rider}의 기물이 ${josa(carrier, '으로/로')} 훌쩍 뛰어올라 등에 자리를 잡았다!`, failure: '올라타려다 미끄러져 엉덩방아를 찧었다.' },
    };
  }

  if (squares.length >= 1 && /기절|스턴|마비/.test(action)) {
    const at = names[names.length - 1];
    return {
      interpretation: `${at}의 기물을 한 턴 동안 기절시킨다.`,
      feasible: true,
      dc: 12,
      cost: 1,
      effects: [{ type: 'tag', at, tag: '기절', turns: 1 }],
      narration: { success: `${at}의 기물이 눈앞에 별을 보며 휘청거린다!`, failure: `${at}의 기물이 고개를 흔들며 정신을 차렸다.` },
    };
  }

  if (squares.length >= 1 && /보호막|방패|결계/.test(action)) {
    const at = names[names.length - 1];
    return {
      interpretation: `${at}의 기물에 한 번의 공격을 막는 보호막을 두른다.`,
      feasible: true,
      dc: 11,
      cost: 2,
      effects: [{ type: 'tag', at, tag: '보호막', turns: 0 }],
      narration: { success: `푸른 결계가 ${at}의 기물을 감쌌다!`, failure: '결계가 형태를 이루지 못하고 흩어졌다.' },
    };
  }

  const named = lastPieceWord(action);
  if (squares.length >= 1 && named && SPAWN_WORDS.test(action)) {
    const at = names[names.length - 1];
    const strong = named === 'queen' || named === 'rook';
    return {
      interpretation: `${at}에 ${color === 'white' ? '백' : '흑'} ${josa(PIECE_KO[named], '을/를')} 새로 불러낸다.`,
      feasible: true,
      dc: strong ? 18 : named === 'pawn' ? 9 : 13,
      cost: strong ? 3 : named === 'pawn' ? 1 : 2,
      effects: [{ type: 'spawn', at, color, piece: named }],
      narration: { success: `하늘이 갈라지며 ${at}에 ${josa(PIECE_KO[named], '이/가')} 내려앉았다!`, failure: '소환진이 반짝이다 꺼져 버렸다.' },
    };
  }

  if (squares.length >= 1 && named && TRANSFORM_WORDS.test(action)) {
    const at = names[0];
    const strong = named === 'queen';
    return {
      interpretation: `${at}의 기물을 ${josa(PIECE_KO[named], '으로/로')} 바꾼다.`,
      feasible: true,
      dc: strong ? 18 : 12,
      cost: strong ? 3 : 2,
      effects: [{ type: 'transform', at, into: named }],
      narration: { success: `빛에 휩싸인 ${at}의 기물이 ${josa(PIECE_KO[named], '으로/로')} 변했다!`, failure: '변신 주문이 엉켜 아무 일도 일어나지 않았다.' },
    };
  }

  if (squares.length >= 1 && REMOVE_WORDS.test(action)) {
    const at = names[names.length - 1];
    return {
      interpretation: `${at}의 기물을 전장에서 제거하려 한다.`,
      feasible: true,
      dc: 14,
      cost: 2,
      effects: [{ type: 'remove', at }],
      narration: {
        success: `번쩍이는 일격! ${at}의 기물이 전장에서 사라졌다.`,
        failure: `공격이 빗나갔다. ${at}의 기물은 비웃듯 자리를 지킨다.`,
      },
    };
  }

  if (squares.length >= 2) {
    const [from, to] = squares;
    const distance = Math.max(Math.abs(fileOf(from) - fileOf(to)), Math.abs(rankOf(from) - rankOf(to)));
    const dc = Math.min(20, 6 + distance * 2);
    return {
      interpretation: `${names[0]}의 기물을 ${josa(names[1], '으로/로')} 비범한 방법으로 이동시킨다.`,
      feasible: true,
      dc,
      cost: distance > 3 ? 2 : 1,
      effects: [{ type: 'move', from: names[0], to: names[1] }],
      narration: {
        success: `믿을 수 없는 기동! 기물이 ${names[0]}에서 ${josa(names[1], '으로/로')} 날아들었다.`,
        failure: `기물이 ${names[0]}에서 발을 헛디뎠다. 작전은 실패로 돌아갔다.`,
      },
    };
  }

  return {
    interpretation:
      '가짜 GM은 칸 좌표가 들어간 행동만 이해합니다. 예: "b1 나이트를 투석기로 e5까지 날린다", "d7 폰을 저격한다", "g8 나이트를 기절시킨다", "e1 킹에 보호막", "a2 폰을 b1 나이트에 태운다", "e4에 나이트를 소환한다", "a2 폰을 퀸으로 바꾼다"',
    feasible: false,
    dc: 0,
    cost: 0,
    effects: [],
    narration: { success: '', failure: '' },
  };
}
