import { distance, parseSquare, type Board, type Color, type Means, type PieceType, type Square } from '../engine';
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
 * A stand-in GM for development and tests. It only understands declarations that mention
 * squares, and like the real GM it wants someone to do it: the first square named is the
 * acting piece (the player's own), the last one what it acts on. Distance is in king steps.
 * - "a2 폰을 b1 나이트에 태운다" → the first boards the second
 * - "b1 나이트와 g8 나이트의 자리를 바꾼다" → swap (magic)
 * - "e6 폰이 e7 폰에 불을 붙인다" → 화상 for 3 turns, by touch (1 square); further away only with
 *   an arrow or a throw ("불화살을 쏜다"), otherwise refused as too far
 * - "e2 폰이 d4와 e4에 벽을 세운다" → 2-turn walls (up to 3); "… 구덩이를 판다" → a pit on the last
 * - "e2 폰이 d4 벽을 부순다" → clear it
 * - "f1 비숍이 g8 나이트를 기절시킨다"; "e2 폰이 e1 킹에 보호막" (or "e1 킹에 보호막" on itself)
 * - "d1 퀸이 d3에 나이트를 되살린다" / "… 소환한다" → revive / spawn one for the player
 * - "a2 폰을 퀸으로 바꾼다" (itself) or "d1 퀸이 a2 폰을 …으로 바꾼다" → transform
 * - "d1 퀸이 d7 폰을 저격한다" → remove the last square (a shot from the actor, or a blow next to it)
 * - "b1 나이트를 투석기로 e5까지" → the piece moves itself
 * Anything else, or nobody doing it, is ruled infeasible.
 *
 * It never makes up chaos events: those are always the real (API) GM's job.
 */
export class FakeGameMaster implements GameMaster {
  readonly name = '가짜 GM (개발용)';

  constructor(private readonly delayMs = 500) {}

  async rule({ action, state }: GmRequest): Promise<GmRulingJson> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return fakeRuling(action, state.turn, state.board);
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

/**
 * The fake GM's ruling for a declaration by `color`. With the board it checks that the acting
 * piece is really the player's; without it (tests) it takes the first square on trust.
 */
export function fakeRuling(action: string, color: Color = 'white', board?: Board): GmRulingJson {
  const base = fakeBaseRuling(action, color, board);
  // The fake GM keeps crits simple: a 20 does the same thing, a 1 stuns the acting piece for a turn.
  const actorSquare = base.feasible && base.actor ? base.actor : null;
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

const HINT = '예: "e6 폰이 e7 폰에 불을 붙인다", "d1 퀸이 불화살을 쏘아 d7 폰을 맞힌다", "b1 나이트를 투석기로 e5까지 날린다"';

function refuse(why: string): BaseRuling {
  return { interpretation: `${why} ${HINT}`, actor: '', means: 'touch', feasible: false, dc: 0, cost: 0, effects: [], narration: { success: '', failure: '' } };
}

const SHOOTING = /화살|쏘|쏜|쏴|던져|던진|던지|발사|투척|저격|석궁|활/;

function fakeBaseRuling(action: string, color: Color, board?: Board): BaseRuling {
  const names = [...action.toLowerCase().matchAll(/[a-h][1-8]/g)].map((m) => m[0]);
  const squares = names.map(parseSquare).filter((s): s is Square => s !== null);
  const mine = (i: number) => (board ? board[squares[i]]?.color === color : true);
  // The acting piece: the first square named, if it is the player's.
  const actor = squares.length && mine(0) ? names[0] : null;
  const first = names[0];
  const last = names[names.length - 1];
  const far = squares.length >= 2 ? distance(squares[0], squares[squares.length - 1]) : 0;
  const who = actor ? `${actor}의 기물이` : '';
  /** Someone else's piece is acted on: it needs an actor that is not the target itself. */
  const needsActor = (): BaseRuling | null => {
    if (!actor) return refuse(squares.length && !mine(0) ? `${first}에는 내 기물이 없습니다. 행동하는 내 기물의 칸을 먼저 써 주세요.` : '누가 하는지 정해 주세요: 행동하는 내 기물의 칸을 먼저 써 주세요.');
    if (squares.length < 2) return refuse('누가 무엇에 하는지 두 칸을 써 주세요.');
    return null;
  };
  /** Next to it, by hand; further, with a shot; `far` without a shooting word: refused. */
  const reach = (spell: boolean): { means: Means } | BaseRuling => {
    if (far <= 1) return { means: 'touch' };
    if (SHOOTING.test(action)) return { means: 'ranged' };
    if (spell) return { means: 'magic' };
    return refuse(`${first}에서 ${last}까지 ${far}칸: 손이 닿기엔 너무 멉니다. 불화살을 쏘거나 다가가는 행동으로 선언해 보세요.`);
  };
  const isRefusal = (r: { means: Means } | BaseRuling): r is BaseRuling => 'feasible' in r;

  if (squares.length >= 2 && /태워|태운|탑승|올라타/.test(action)) {
    const [rider, carrier] = names;
    if (!actor) return needsActor()!;
    return {
      interpretation: `${rider}의 기물이 ${carrier}의 기물에 올라탄다.`,
      actor,
      means: far <= 1 ? 'touch' : 'move',
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
    if (!actor) return needsActor()!;
    return {
      interpretation: `${a}의 기물이 주문을 외워 ${b}의 기물과 자리를 맞바꾼다.`,
      actor,
      means: 'magic',
      feasible: true,
      dc: 12,
      cost: 2,
      effects: [{ type: 'swap', a, b }],
      look: look({ beats: [beat(1)], fx: [fx('arcane', 'burst', a, { strength: 3, radius: 0.7 }), fx('arcane', 'burst', b, { strength: 3, radius: 0.7 })] }),
      narration: { success: `두 기물이 서로를 향해 날아올라 ${josa(a, '와/과')} ${b}의 자리가 뒤바뀌었다!`, failure: '두 기물이 엇갈리려다 서로 부딪혀 제자리로 튕겨 났다.' },
    };
  }

  if (/벽|구덩이|함정|구멍/.test(action) && /부숴|부순|부수|허물|허문|메운|메워|메우|없애|치운|치워/.test(action)) {
    const missing = needsActor();
    if (missing) return missing;
    const r = reach(false);
    if (isRefusal(r)) return r;
    return {
      interpretation: `${who} ${last}의 지형을 없앤다.`,
      actor: actor!,
      ...r,
      feasible: true,
      dc: 9,
      cost: 1,
      effects: [{ type: 'clearTerrain', at: last }],
      look: look({ fx: [fx('earth', 'burst', last, { strength: 3, radius: 0.8, withEffect: 1 }), fx('wind', 'burst', last, { strength: 2, withEffect: 1, delay: 0.2 })] }),
      narration: { success: `${last}의 지형이 와르르 무너져 평평해졌다!`, failure: '꿈쩍도 하지 않는다.' },
    };
  }

  if (/벽|장벽|바리케이드|성벽/.test(action)) {
    const missing = needsActor();
    if (missing) return missing;
    const at = [...new Set(names.slice(1))].slice(0, 3);
    return {
      interpretation: `${who} 주문으로 ${at.join(', ')}에 두 턴 동안 벽을 세운다.`,
      actor: actor!,
      means: 'magic',
      feasible: true,
      dc: 9 + at.length * 2,
      cost: at.length > 1 ? 2 : 1,
      effects: at.map((sq) => ({ type: 'terrain' as const, at: sq, kind: 'wall' as const, turns: 2 })),
      look: look({ shake: 1, fx: at.map((sq, i) => fx('earth', 'burst', sq, { strength: 3, radius: 0.7, withEffect: i + 1 })) }),
      narration: { success: `땅이 울리며 ${at.join(', ')}에 돌벽이 솟아올랐다!`, failure: '돌무더기가 조금 들썩이다 말았다.' },
    };
  }

  if (/구덩이|함정|구멍|싱크홀/.test(action)) {
    const missing = needsActor();
    if (missing) return missing;
    return {
      interpretation: `${who} 땅을 갈라 ${last}에 두 턴 동안 구덩이를 판다.`,
      actor: actor!,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: 12,
      cost: 2,
      effects: [{ type: 'terrain', at: last, kind: 'pit', turns: 2 }],
      look: look({ shake: 2, beats: [beat(1, { exit: 'sink' })], fx: [fx('earth', 'burst', last, { strength: 4, radius: 0.9, withEffect: 1 })] }),
      narration: { success: `${last}의 땅이 꺼지며 시커먼 구덩이가 입을 벌렸다!`, failure: '땅에 금이 갔지만 꺼지지는 않았다.' },
    };
  }

  if (/기절|스턴|마비/.test(action)) {
    const missing = needsActor();
    if (missing) return missing;
    const means: Means = far <= 1 ? 'touch' : SHOOTING.test(action) ? 'ranged' : 'magic';
    return {
      interpretation: `${who} ${last}의 기물을 한 턴 동안 기절시킨다.`,
      actor: actor!,
      means,
      feasible: true,
      dc: 12 + (far > 1 ? Math.min(4, far - 1) : 0),
      cost: 1,
      effects: [tag(last, '기절', 1)],
      look: look({
        shake: 1,
        fx: [...(far > 1 ? [fx('lightning', 'beam', first, { to: last, strength: 3, duration: 0.6 })] : []), fx('lightning', 'burst', last, { strength: 3, withEffect: 1 })],
        acts: [{ at: last, act: 'shiver', delay: 0.3 }],
      }),
      narration: { success: `${last}의 기물이 눈앞에 별을 보며 휘청거린다!`, failure: `${last}의 기물이 고개를 흔들며 정신을 차렸다.` },
    };
  }

  if (squares.length >= 1 && /보호막|방패|결계/.test(action)) {
    // On itself, or by another of the player's pieces.
    if (!actor) return needsActor()!;
    return {
      interpretation: `${who} ${last}의 기물에 한 번의 공격을 막는 보호막을 두른다.`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: 11 + (far > 1 ? 2 : 0),
      cost: 2,
      effects: [tag(last, '보호막', 0)],
      look: look({ fx: [fx('light', 'burst', last, { strength: 3, radius: 1, withEffect: 1 })] }),
      narration: { success: `푸른 결계가 ${last}의 기물을 감쌌다!`, failure: '결계가 형태를 이루지 못하고 흩어졌다.' },
    };
  }

  if (/불태|불붙|불을 붙|불을 질|화염|점화|화상|불화살/.test(action)) {
    const missing = needsActor();
    if (missing) return missing;
    const r = reach(false);
    if (isRefusal(r)) return r;
    const shot = r.means === 'ranged';
    return {
      interpretation: shot
        ? `${who} ${last}의 기물에 불화살을 쏜다(${far}칸). 세 턴 안에 자리를 옮기지 않으면 타서 없어진다.`
        : `${who} 바로 옆 ${last}의 기물에 불을 붙인다. 세 턴 안에 자리를 옮기지 않으면 타서 없어진다.`,
      actor: actor!,
      ...r,
      feasible: true,
      dc: shot ? Math.min(20, 11 + far) : 10,
      cost: 2,
      effects: [{ type: 'tag', at: last, tag: '화상', turns: 3, aura: 'fire', auraStrength: 2 }],
      look: look({
        fx: [...(shot ? [fx('fire', 'beam', first, { to: last, strength: 3, duration: 0.7 })] : []), fx('fire', 'burst', last, { strength: 3, radius: 0.8, withEffect: 1, delay: shot ? 0.5 : 0 })],
        acts: [{ at: last, act: 'shiver', delay: shot ? 0.8 : 0.4 }],
      }),
      narration: { success: `${last}의 기물에 불길이 옮겨붙었다! 어서 움직이지 않으면 재가 된다.`, failure: shot ? '불화살이 빗나가 땅에 꽂혔다.' : '불씨가 피식 꺼져 버렸다.' },
    };
  }

  const named = lastPieceWord(action);
  if (named && /되살|부활|살려|소생/.test(action)) {
    const missing = needsActor();
    if (missing) return missing;
    const strong = named === 'queen' || named === 'rook';
    return {
      interpretation: `${who} 잡혔던 ${color === 'white' ? '백' : '흑'} ${josa(PIECE_KO[named], '을/를')} ${last}에 되살린다.`,
      actor: actor!,
      means: 'magic',
      feasible: true,
      dc: strong ? 18 : named === 'pawn' ? 10 : 14,
      cost: strong ? 3 : 2,
      effects: [{ type: 'revive', at: last, color, piece: named }],
      look: look({ beats: [beat(1, { entrance: 'rise' })], fx: [fx('light', 'burst', last, { strength: 4, radius: 1, withEffect: 1 })] }),
      narration: { success: `빛기둥 속에서 쓰러졌던 ${josa(PIECE_KO[named], '이/가')} ${last}에 다시 일어섰다!`, failure: '영혼이 잠시 머물다 흩어졌다.' },
    };
  }

  if (named && SPAWN_WORDS.test(action)) {
    const missing = needsActor();
    if (missing) return missing;
    const strong = named === 'queen' || named === 'rook';
    return {
      interpretation: `${who} ${last}에 ${color === 'white' ? '백' : '흑'} ${josa(PIECE_KO[named], '을/를')} 불러낸다.`,
      actor: actor!,
      means: 'magic',
      feasible: true,
      dc: strong ? 18 : named === 'pawn' ? 9 : 13,
      cost: strong ? 3 : named === 'pawn' ? 1 : 2,
      effects: [{ type: 'spawn', at: last, color, piece: named }],
      look: look({
        shake: strong ? 1 : 0,
        beats: [beat(1, { entrance: 'rise' })],
        fx: [fx('light', 'burst', last, { strength: strong ? 5 : 3, radius: 1, withEffect: 1 })],
      }),
      narration: { success: `하늘이 갈라지며 ${last}에 ${josa(PIECE_KO[named], '이/가')} 내려앉았다!`, failure: '소환진이 반짝이다 꺼져 버렸다.' },
    };
  }

  if (squares.length >= 1 && named && TRANSFORM_WORDS.test(action)) {
    // On itself, or by another of the player's pieces.
    if (!actor) return needsActor()!;
    const strong = named === 'queen';
    return {
      interpretation: `${squares.length > 1 ? `${who} ` : ''}${last}의 기물을 ${josa(PIECE_KO[named], '으로/로')} 바꾼다.`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: strong ? 18 : 12,
      cost: strong ? 3 : 2,
      effects: [{ type: 'transform', at: last, into: named }],
      look: look({ fx: [fx('arcane', 'burst', last, { strength: 4, withEffect: 1 })] }),
      narration: { success: `빛에 휩싸인 ${last}의 기물이 ${josa(PIECE_KO[named], '으로/로')} 변했다!`, failure: '변신 주문이 엉켜 아무 일도 일어나지 않았다.' },
    };
  }

  if (REMOVE_WORDS.test(action)) {
    const missing = needsActor();
    if (missing) return missing;
    const shot = far > 1;
    return {
      interpretation: shot ? `${who} ${far}칸 떨어진 ${last}의 기물을 저격한다.` : `${who} 바로 옆 ${last}의 기물을 쓰러뜨린다.`,
      actor: actor!,
      means: shot ? 'ranged' : 'touch',
      feasible: true,
      dc: shot ? Math.min(20, 12 + far) : 13,
      cost: 2,
      effects: [{ type: 'remove', at: last }],
      look: look({
        shake: 2,
        beats: [beat(1, { wait: shot ? 0.4 : 0.1, exit: 'shatter' })],
        fx: [...(shot ? [fx('lightning', 'beam', first, { to: last, strength: 4, duration: 0.8 })] : []), fx('impact', 'burst', last, { strength: 4, withEffect: 1 })],
      }),
      narration: {
        success: `번쩍이는 일격! ${last}의 기물이 전장에서 사라졌다.`,
        failure: `공격이 빗나갔다. ${last}의 기물은 비웃듯 자리를 지킨다.`,
      },
    };
  }

  if (squares.length >= 2) {
    if (!actor) return needsActor()!;
    const [from, to] = squares;
    const d = distance(from, to);
    const dc = Math.min(20, 6 + d * 2);
    return {
      interpretation: `${names[0]}의 기물이 ${josa(names[1], '으로/로')} 비범한 방법으로 이동한다.`,
      actor,
      means: 'move',
      feasible: true,
      dc,
      cost: d > 3 ? 2 : 1,
      effects: [{ type: 'move', from: names[0], to: names[1] }],
      look: look({
        beats: [beat(1, { motion: d > 3 ? 'spin' : 'hop' })],
        fx: [fx('wind', 'trail', '', { withEffect: 1, strength: 3 }), fx('earth', 'burst', names[1], { withEffect: 1, delay: 0.9, strength: 2, radius: 0.6 })],
      }),
      narration: {
        success: `믿을 수 없는 기동! 기물이 ${names[0]}에서 ${josa(names[1], '으로/로')} 날아들었다.`,
        failure: `기물이 ${names[0]}에서 발을 헛디뎠다. 작전은 실패로 돌아갔다.`,
      },
    };
  }

  return refuse('가짜 GM은 칸 좌표가 들어간 행동만 이해합니다.');
}
