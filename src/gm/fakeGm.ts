import { fileOf, parseSquare, rankOf, type Color, type PieceType, type Square } from '../engine';
import type { GameMaster, GmRequest, GmRulingJson } from './types';
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
 * - two squares + a swapping word ("b1 나이트와 g8 나이트의 자리를 바꾼다") → swap them
 * - a square + a burning word ("g8 나이트에 불을 붙인다") → 화상 for 3 turns, with a fire aura
 * - squares + 벽 ("d4에 벽을 세운다") → a 2-turn wall on each (up to 3); + 구덩이 → a pit on the last
 * - a square + 벽/구덩이 + a breaking word ("d4 벽을 부순다") → clear it
 * - a square + a piece name + a reviving word ("c3에 나이트를 되살린다") → revive the player's piece
 * - one or more squares + a removal word ("d7 폰을 저격한다") → remove the last square
 * - a square + a piece name + a summoning word ("e4에 나이트를 소환한다") → spawn one for the player
 * - a square + a piece name + a changing word ("a2 폰을 퀸으로 바꾼다") → transform
 * - two or more squares ("b1 나이트를 투석기로 e5까지") → move first → second
 * Anything else is ruled infeasible.
 *
 * It never makes up chaos events: those are always the real (API) GM's job.
 */
export class FakeGameMaster implements GameMaster {
  readonly name = '가짜 GM (개발용)';

  constructor(private readonly delayMs = 500) {}

  async rule({ action, state }: GmRequest): Promise<GmRulingJson> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return fakeRuling(action, state.turn);
  }
}

type StagingJson = GmRulingJson['staging']['success'];
type FxJson = StagingJson['fx'][number];
type BeatJson = StagingJson['beats'][number];

const look = (p: Partial<StagingJson> = {}): StagingJson => ({ fx: [], shake: 0, beats: [], acts: [], ...p });
const fx = (element: string, shape: string, at: string, extra: Partial<FxJson> = {}): FxJson => ({
  element,
  shape,
  at,
  to: '',
  radius: 1,
  strength: 3,
  duration: 1.2,
  withEffect: 0,
  delay: 0,
  ...extra,
});
const beat = (effect: number, extra: Partial<BeatJson> = {}): BeatJson => ({
  effect,
  wait: 0,
  motion: 'default',
  speed: 'normal',
  entrance: 'default',
  exit: 'default',
  ...extra,
});
const tag = (at: string, name: string, turns: number) => ({ type: 'tag' as const, at, tag: name, turns, aura: 'none', auraStrength: 0 });

/** A bigger version of a success look, for a natural 20. */
function grander(s: StagingJson): StagingJson {
  return { ...s, shake: Math.min(3, s.shake + 1), fx: s.fx.map((f) => ({ ...f, strength: Math.min(5, f.strength + 1), radius: Math.min(3, f.radius + 0.5) })) };
}

export function fakeRuling(action: string, color: Color = 'white'): GmRulingJson {
  const base = fakeBaseRuling(action, color);
  // The fake GM keeps crits simple: a 20 does the same thing, a 1 stuns the acting piece for a turn.
  const actor = base.effects[0];
  const actorSquare = actor?.type === 'move' ? actor.from : actor?.type === 'board' ? actor.rider : null;
  const success = base.look ?? look();
  const { look: _look, ...rest } = base;
  void _look;
  return {
    ...rest,
    critSuccessEffects: [],
    critFailureEffects: actorSquare ? [tag(actorSquare, '기절', 1)] : [],
    narration: {
      ...base.narration,
      critSuccess: base.narration.success ? `완벽하다! ${base.narration.success}` : '',
      critFailure: actorSquare ? `대참사! 기물이 비틀거리다 정신을 잃었다.` : base.narration.failure,
    },
    staging: {
      success,
      critSuccess: grander(success),
      // A miss: the piece stumbles where it stands.
      failure: actorSquare ? look({ acts: [{ at: actorSquare, act: 'stagger', delay: 0 }], fx: [fx('wind', 'burst', actorSquare, { strength: 1, duration: 0.8 })] }) : look(),
      critFailure: actorSquare
        ? look({
            shake: 1,
            acts: [{ at: actorSquare, act: 'fall', delay: 0.2 }],
            fx: [fx('lightning', 'burst', actorSquare, { strength: 3, withEffect: 1 }), fx('impact', 'burst', actorSquare, { strength: 2, delay: 0.2 })],
          })
        : look(),
    },
  };
}

type BaseRuling = Omit<GmRulingJson, 'critSuccessEffects' | 'critFailureEffects' | 'narration' | 'staging'> & {
  narration: { success: string; failure: string };
  look?: StagingJson;
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
      look: look({ beats: [beat(1, { motion: 'hop' })], fx: [fx('arcane', 'burst', carrier, { strength: 2, withEffect: 1, delay: 0.3 })] }),
      narration: { success: `${rider}의 기물이 ${josa(carrier, '으로/로')} 훌쩍 뛰어올라 등에 자리를 잡았다!`, failure: '올라타려다 미끄러져 엉덩방아를 찧었다.' },
    };
  }

  if (squares.length >= 2 && /맞바꾸|맞바꿔|맞바꾼|자리를?\s*(바꾸|바꿔|바꾼|교체|교환)|스왑|뒤바꾸|뒤바꿔|뒤바꾼/.test(action)) {
    const [a, b] = names;
    return {
      interpretation: `${a}의 기물과 ${b}의 기물이 자리를 맞바꾼다.`,
      feasible: true,
      dc: 12,
      cost: 2,
      effects: [{ type: 'swap', a, b }],
      look: look({ beats: [beat(1)], fx: [fx('arcane', 'burst', a, { strength: 3, radius: 0.7 }), fx('arcane', 'burst', b, { strength: 3, radius: 0.7 })] }),
      narration: { success: `두 기물이 서로를 향해 날아올라 ${josa(a, '와/과')} ${b}의 자리가 뒤바뀌었다!`, failure: '두 기물이 엇갈리려다 서로 부딪혀 제자리로 튕겨 났다.' },
    };
  }

  if (squares.length >= 1 && /벽|구덩이|함정|구멍/.test(action) && /부숴|부순|부수|허물|허문|메운|메워|메우|없애|치운|치워/.test(action)) {
    const at = names[names.length - 1];
    return {
      interpretation: `${at}의 지형을 없앤다.`,
      feasible: true,
      dc: 9,
      cost: 1,
      effects: [{ type: 'clearTerrain', at }],
      look: look({ fx: [fx('earth', 'burst', at, { strength: 3, radius: 0.8, withEffect: 1 }), fx('wind', 'burst', at, { strength: 2, withEffect: 1, delay: 0.2 })] }),
      narration: { success: `${at}의 지형이 와르르 무너져 평평해졌다!`, failure: '꿈쩍도 하지 않는다.' },
    };
  }

  if (squares.length >= 1 && /벽|장벽|바리케이드|성벽/.test(action)) {
    const at = [...new Set(names)].slice(0, 3);
    return {
      interpretation: `${at.join(', ')}에 두 턴 동안 벽을 세운다.`,
      feasible: true,
      dc: 9 + at.length * 2,
      cost: at.length > 1 ? 2 : 1,
      effects: at.map((sq) => ({ type: 'terrain' as const, at: sq, kind: 'wall', turns: 2 })),
      look: look({ shake: 1, fx: at.map((sq, i) => fx('earth', 'burst', sq, { strength: 3, radius: 0.7, withEffect: i + 1 })) }),
      narration: { success: `땅이 울리며 ${at.join(', ')}에 돌벽이 솟아올랐다!`, failure: '돌무더기가 조금 들썩이다 말았다.' },
    };
  }

  if (squares.length >= 1 && /구덩이|함정|구멍|싱크홀/.test(action)) {
    const at = names[names.length - 1];
    return {
      interpretation: `${at}에 두 턴 동안 구덩이를 판다.`,
      feasible: true,
      dc: 12,
      cost: 2,
      effects: [{ type: 'terrain', at, kind: 'pit', turns: 2 }],
      look: look({ shake: 2, beats: [beat(1, { exit: 'sink' })], fx: [fx('earth', 'burst', at, { strength: 4, radius: 0.9, withEffect: 1 })] }),
      narration: { success: `${at}의 땅이 꺼지며 시커먼 구덩이가 입을 벌렸다!`, failure: '땅에 금이 갔지만 꺼지지는 않았다.' },
    };
  }

  if (squares.length >= 1 && /기절|스턴|마비/.test(action)) {
    const at = names[names.length - 1];
    return {
      interpretation: `${at}의 기물을 한 턴 동안 기절시킨다.`,
      feasible: true,
      dc: 12,
      cost: 1,
      effects: [tag(at, '기절', 1)],
      look: look({ shake: 1, fx: [fx('lightning', 'burst', at, { strength: 3, withEffect: 1 })], acts: [{ at, act: 'shiver', delay: 0.3 }] }),
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
      effects: [tag(at, '보호막', 0)],
      look: look({ fx: [fx('light', 'burst', at, { strength: 3, radius: 1, withEffect: 1 })] }),
      narration: { success: `푸른 결계가 ${at}의 기물을 감쌌다!`, failure: '결계가 형태를 이루지 못하고 흩어졌다.' },
    };
  }

  if (squares.length >= 1 && /불태|불붙|불을 붙|불을 질|화염|점화|화상/.test(action)) {
    const at = names[names.length - 1];
    return {
      interpretation: `${at}의 기물에 불을 붙인다. 세 턴 안에 자리를 옮기지 않으면 타서 없어진다.`,
      feasible: true,
      dc: 12,
      cost: 2,
      effects: [{ type: 'tag', at, tag: '화상', turns: 3, aura: 'fire', auraStrength: 2 }],
      look: look({ fx: [fx('fire', 'burst', at, { strength: 3, radius: 0.8, withEffect: 1 })], acts: [{ at, act: 'shiver', delay: 0.4 }] }),
      narration: { success: `${at}의 기물에 불길이 옮겨붙었다! 어서 움직이지 않으면 재가 된다.`, failure: '불씨가 피식 꺼져 버렸다.' },
    };
  }

  const named = lastPieceWord(action);
  if (squares.length >= 1 && named && /되살|부활|살려|소생/.test(action)) {
    const at = names[names.length - 1];
    const strong = named === 'queen' || named === 'rook';
    return {
      interpretation: `잡혔던 ${color === 'white' ? '백' : '흑'} ${josa(PIECE_KO[named], '을/를')} ${at}에 되살린다.`,
      feasible: true,
      dc: strong ? 18 : named === 'pawn' ? 10 : 14,
      cost: strong ? 3 : 2,
      effects: [{ type: 'revive', at, color, piece: named }],
      look: look({ beats: [beat(1, { entrance: 'rise' })], fx: [fx('light', 'burst', at, { strength: 4, radius: 1, withEffect: 1 })] }),
      narration: { success: `빛기둥 속에서 쓰러졌던 ${josa(PIECE_KO[named], '이/가')} ${at}에 다시 일어섰다!`, failure: '영혼이 잠시 머물다 흩어졌다.' },
    };
  }
  if (squares.length >= 1 && named && SPAWN_WORDS.test(action)) {
    const at = names[names.length - 1];
    const strong = named === 'queen' || named === 'rook';
    return {
      interpretation: `${at}에 ${color === 'white' ? '백' : '흑'} ${josa(PIECE_KO[named], '을/를')} 새로 불러낸다.`,
      feasible: true,
      dc: strong ? 18 : named === 'pawn' ? 9 : 13,
      cost: strong ? 3 : named === 'pawn' ? 1 : 2,
      effects: [{ type: 'spawn', at, color, piece: named }],
      look: look({
        shake: strong ? 1 : 0,
        beats: [beat(1, { entrance: 'rise' })],
        fx: [fx('light', 'burst', at, { strength: strong ? 5 : 3, radius: 1, withEffect: 1 })],
      }),
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
      look: look({ fx: [fx('arcane', 'burst', at, { strength: 4, withEffect: 1 })] }),
      narration: { success: `빛에 휩싸인 ${at}의 기물이 ${josa(PIECE_KO[named], '으로/로')} 변했다!`, failure: '변신 주문이 엉켜 아무 일도 일어나지 않았다.' },
    };
  }

  if (squares.length >= 1 && REMOVE_WORDS.test(action)) {
    const at = names[names.length - 1];
    // The shot comes from the shooter's own back rank, straight down the file.
    const from = `${at[0]}${color === 'white' ? 1 : 8}`;
    return {
      interpretation: `${at}의 기물을 전장에서 제거하려 한다.`,
      feasible: true,
      dc: 14,
      cost: 2,
      effects: [{ type: 'remove', at }],
      look: look({
        shake: 2,
        beats: [beat(1, { wait: 0.4, exit: 'shatter' })],
        fx: [fx('lightning', 'beam', from, { to: at, strength: 4, duration: 0.8 }), fx('impact', 'burst', at, { strength: 4, withEffect: 1 })],
      }),
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
      look: look({
        beats: [beat(1, { motion: distance > 3 ? 'spin' : 'hop' })],
        fx: [fx('wind', 'trail', '', { withEffect: 1, strength: 3 }), fx('earth', 'burst', names[1], { withEffect: 1, delay: 0.9, strength: 2, radius: 0.6 })],
      }),
      narration: {
        success: `믿을 수 없는 기동! 기물이 ${names[0]}에서 ${josa(names[1], '으로/로')} 날아들었다.`,
        failure: `기물이 ${names[0]}에서 발을 헛디뎠다. 작전은 실패로 돌아갔다.`,
      },
    };
  }

  return {
    interpretation:
      '가짜 GM은 칸 좌표가 들어간 행동만 이해합니다. 예: "b1 나이트를 투석기로 e5까지 날린다", "d7 폰을 저격한다", "g8 나이트를 기절시킨다", "e1 킹에 보호막", "a2 폰을 b1 나이트에 태운다", "e4에 나이트를 소환한다", "a2 폰을 퀸으로 바꾼다", "b1과 g8의 자리를 바꾼다", "g8 나이트에 불을 붙인다", "c3에 나이트를 되살린다", "d4에 벽을 세운다", "e5에 구덩이를 판다"',
    feasible: false,
    dc: 0,
    cost: 0,
    effects: [],
    narration: { success: '', failure: '' },
  };
}
