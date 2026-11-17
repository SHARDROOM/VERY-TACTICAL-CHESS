import { AIR, SQUARE_PATTERN, distance, parseSquare, type AttachPoint, type Board, type Color, type Means, type PieceType, type PropPreset, type Square } from '../engine';
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
const COLOR_KO: Record<Color, string> = { white: '백', black: '흑', red: '적', gray: '회색' };

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
 * - "e2 폰이 d4 구덩이에 다리를 놓는다" / "… d4 벽에 사다리를 건다" → a 2-turn bridge / ladder; "… 다리를 끊는다" → cut it
 * - "a2 폰이 룩처럼 이동한다" → for 2 turns it also moves like a rook (any kinds named before 처럼)
 * - "a2 폰이 연속으로 두 번 이동한다" → for 1 turn it moves twice in a row ("세 번": three times)
 * - "e2 폰이 영감을 얻어 검술에 눈을 뜬다" → 검술 ×1.5 with a sword in hand (창술: a spear)
 * - "f1 비숍이 g8 나이트를 기절시킨다"; "e2 폰이 e1 킹에 보호막" (or "e1 킹에 보호막" on itself)
 * - "d1 퀸이 d3에 나이트를 되살린다" / "… 소환한다" → revive / spawn one for the player
 * - "a2 폰을 퀸으로 바꾼다" (itself) or "d1 퀸이 a2 폰을 …으로 바꾼다" → transform
 * - "d1 퀸이 d7 폰을 저격한다" → remove the last square (a shot from the actor, or a blow next to it)
 * - "b1 나이트를 투석기로 e5까지" → the piece moves itself
 * - "e2 폰이 떠오른다" / "d1 퀸이 e2 폰을 공중부양시킨다" → 공중부양 for 2 turns; "d1 퀸이 e4 나이트를 떨어뜨린다" → its levitation ends
 * A square names the piece in the air above it when the ground there is empty.
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
type PropJson = { preset: 'none' | PropPreset; color: string; scale: number; attach: AttachPoint; parts: string };
/** A ready-made prop as the GM writes it ("none" for no prop). */
const look3d = (preset: 'none' | PropPreset = 'none', attach: AttachPoint = 'rightHand', color = ''): PropJson => ({ preset, color, scale: 1, attach, parts: '' });
const tag = (
  at: string,
  name: string,
  turns: number,
  extra: { aura?: string; auraStrength?: number; clash?: number; prop?: PropJson; moveAs?: PieceType[]; moveTimes?: number; skill?: { about: string; bonus: number }; mind?: number } = {},
) => ({
  type: 'tag' as const,
  at,
  tag: name,
  turns,
  aura: extra.aura ?? 'none',
  auraStrength: extra.auraStrength ?? 0,
  clash: extra.clash ?? 0,
  prop: extra.prop ?? look3d(),
  moveAs: extra.moveAs ?? [],
  moveTimes: extra.moveTimes ?? 1,
  skill: extra.skill ?? { about: '', bonus: 0 },
  mind: extra.mind ?? 0,
});

/** Mental actions (정신 계열): the target's will counts. */
const MENTAL = /회유|매혹|유혹|현혹|설득|세뇌|겁을|공포|위협해|꾀어/;

const MOVE_LIKE: [RegExp, PieceType][] = [[/퀸|여왕/, 'queen'], [/룩|성탑/, 'rook'], [/비숍|주교/, 'bishop'], [/나이트|기사/, 'knight'], [/킹/, 'king'], [/폰|병사/, 'pawn']];
const MOVE_KIND_KO: Record<PieceType, string> = { king: '킹', ...PIECE_KO };

/**
 * The fake GM's ruling for a declaration by `color`. With the board it checks that the acting
 * piece is really the player's; without it (tests) it takes the first square on trust.
 */
export function fakeRuling(declared: string, color: Color = 'white', board?: Board): GmRulingJson {
  // Pieces given up ("e3 폰을 제물로 바쳐"): taken out of the declaration, then offered (희생).
  const offeredRe = new RegExp(`(${SQUARE_PATTERN().replace('\\^?', '')})\\s*(?:의\\s*)?[가-힣]{0,4}\\s*(?:을|를)?\\s*(?:제물로\\s*(?:바쳐|바치고|삼아)?|희생(?:해|하여|시켜)?)`, 'gi');
  const sacrifice = [...declared.matchAll(offeredRe)].map((m) => m[1].toLowerCase().replace(/\s/g, ''));
  const action = sacrifice.length ? declared.replace(offeredRe, ' ').replace(/\s+/g, ' ').trim() : declared;
  const base = fakeBaseRuling(action, color, board);
  // The fake GM keeps the backfire simple: snake eyes stun the acting piece for a turn.
  const actorSquare = base.feasible && base.actor ? base.actor : null;
  const success = base.look ?? look();
  const { look: _look, target: baseTarget, skills: baseSkills, mental: baseMental, ...rest } = base;
  void _look;
  // Like a real GM: the main piece acted on, a mental action, and the actor's skills that fit it.
  const names = [...action.toLowerCase().matchAll(new RegExp(SQUARE_PATTERN().replace('\\^?', ''), 'g'))].map((m) => m[0].replace(/\s/g, ''));
  const target = baseTarget ?? (names.length >= 2 ? names[names.length - 1] : '');
  const actorPiece = board && base.actor ? board[parseSquare(base.actor)!] : null;
  const skills =
    baseSkills ??
    (actorPiece ? [actorPiece, ...(actorPiece.rider ? [actorPiece.rider] : [])] : [])
      .flatMap((p) => p.tags ?? [])
      .filter((t) => t.skill && (action.includes(t.name) || t.skill.about.split(/\s+/).some((w) => w.length >= 2 && action.includes(w.replace(/하는|행동|만들기$/g, '')))))
      .map((t) => t.name);
  return {
    ...rest,
    target,
    skills,
    mental: baseMental ?? MENTAL.test(action),
    sacrifice: base.feasible ? sacrifice : [],
    critFailureEffects: actorSquare ? [tag(actorSquare, '기절', 1)] : [],
    narration: {
      ...base.narration,
      critFailure: actorSquare ? `대참사! 기물이 비틀거리다 정신을 잃었다.` : base.narration.failure,
    },
    staging: {
      success,
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

type BaseRuling = Omit<GmRulingJson, 'critFailureEffects' | 'narration' | 'staging' | 'target' | 'skills' | 'mental' | 'sacrifice'> & {
  narration: { success: string; failure: string };
  look?: StagingJson;
  target?: string;
  skills?: string[];
  mental?: boolean;
};

const HINT = '예: "e6 폰이 e7 폰에 불을 붙인다", "d1 퀸이 불화살을 쏘아 d7 폰을 맞힌다", "b1 나이트를 투석기로 e5까지 날린다"';

function refuse(why: string): BaseRuling {
  return { interpretation: `${why} ${HINT}`, actor: '', means: 'touch', feasible: false, dc: 0, cost: 0, effects: [], narration: { success: '', failure: '' } };
}

const SHOOTING = /화살|쏘|쏜|쏴|던져|던진|던지|발사|투척|저격|석궁|활/;

function fakeBaseRuling(action: string, color: Color, board?: Board): BaseRuling {
  // A square with nothing on the ground but something floating above it means the floating one.
  const up = (n: string) => {
    const s = parseSquare(n)!;
    return board && !board[s] && board[s + AIR] ? `${n}^` : n;
  };
  // Square names as this board writes them ("e4", or "흑e4" on the 3-player board), without a ^.
  const names = [...action.toLowerCase().matchAll(new RegExp(SQUARE_PATTERN().replace('\\^?', ''), 'g'))].map((m) => up(m[0].replace(/\s/g, '')));
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

  // A skill (특기) or a will (정신력) given to a piece: "e2 폰에게 건축가 특기를 준다", "d1 퀸이 e2 폰에게 강철 같은 정신력을 불어넣는다".
  const skillName = action.match(/([가-힣]{2,10})\s*(?:특기|직업)/)?.[1];
  if (squares.length >= 1 && (skillName || /정신력|의지/.test(action)) && /준다|주어|얻|부여|익힌|익혀|가르|불어넣/.test(action)) {
    if (!actor) return needsActor()!;
    const will = !skillName;
    const name = will ? '강철 의지' : skillName!;
    return {
      interpretation: will ? `${last}의 기물이 세 턴 동안 강철 같은 정신력(+2)을 얻는다.` : `${last}의 기물이 세 턴 동안 ${name} 특기를 얻어 ${name}다운 행동에 +2를 받는다.`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: 8,
      cost: 2,
      effects: [tag(last, name, 3, will ? { mind: 2, aura: 'light', auraStrength: 1 } : { skill: { about: `${name}다운 행동`, bonus: 2 } })],
      look: look({ fx: [fx('light', 'burst', last, { strength: 2, withEffect: 1 })], acts: [{ at: last, act: 'hop', delay: 0.1 }] }),
      narration: { success: will ? `${last}의 기물의 눈빛이 단단해졌다.` : `${last}의 기물이 ${name}의 요령을 깨쳤다!`, failure: '가르침이 귀에 들어오지 않았다.' },
    };
  }

  // Winning over an enemy piece (a mental action): it changes sides.
  if (squares.length >= 2 && MENTAL.test(action) && board && board[squares[squares.length - 1]] && board[squares[squares.length - 1]]!.color !== color) {
    if (!actor) return needsActor()!;
    const r = reach(true);
    if (isRefusal(r)) return r;
    const kingThere = board[squares[squares.length - 1]]!.type === 'king';
    if (kingThere) return refuse('킹은 회유할 수 없습니다.');
    return {
      interpretation: `${who} ${last}의 상대 기물을 꾀어 내 편으로 만든다.`,
      actor,
      means: r.means,
      target: last,
      mental: true,
      feasible: true,
      dc: 9,
      cost: 3,
      effects: [{ type: 'convert', at: last, color }],
      look: look({ fx: [fx('arcane', 'beam', actor, { to: last, strength: 2, withEffect: 0 })] }),
      narration: { success: `${last}의 기물이 마음을 돌렸다!`, failure: '상대 기물은 흔들리지 않았다.' },
    };
  }

  if (squares.length >= 2 && /태워|태운|탑승|올라타/.test(action)) {
    const [rider, carrier] = names;
    if (!actor) return needsActor()!;
    return {
      interpretation: `${rider}의 기물이 ${carrier}의 기물에 올라탄다.`,
      actor,
      means: far <= 1 ? 'touch' : 'move',
      feasible: true,
      dc: 6,
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
      dc: 8,
      cost: 2,
      effects: [{ type: 'swap', a, b }],
      look: look({ beats: [beat(1)], fx: [fx('arcane', 'burst', a, { strength: 3, radius: 0.7 }), fx('arcane', 'burst', b, { strength: 3, radius: 0.7 })] }),
      narration: { success: `두 기물이 서로를 향해 날아올라 ${josa(a, '와/과')} ${b}의 자리가 뒤바뀌었다!`, failure: '두 기물이 엇갈리려다 서로 부딪혀 제자리로 튕겨 났다.' },
    };
  }

  if (/사다리/.test(action) || (/다리/.test(action) && /놓|깔|건설|만든|만들|잇|이어|끊|걷어/.test(action))) {
    const missing = needsActor();
    if (missing) return missing;
    const ladder = /사다리/.test(action);
    const cut = /끊|부숴|부순|부수|치운|치워|걷어|없애/.test(action);
    if (cut) {
      return {
        interpretation: `${who} ${last}의 ${ladder ? '사다리를 치운다' : '다리를 끊는다'}.`,
        actor: actor!,
        means: far <= 1 ? 'touch' : 'ranged',
        feasible: true,
        dc: 8,
        cost: 1,
        effects: [{ type: 'clearCover', at: last }],
        look: look({ fx: [fx('wind', 'burst', last, { strength: 2, withEffect: 1 })] }),
        narration: { success: ladder ? `${last}의 사다리가 와르르 넘어갔다!` : `밧줄이 끊어지며 ${last}의 다리가 구덩이로 떨어졌다!`, failure: '꿈쩍도 하지 않는다.' },
      };
    }
    return {
      interpretation: `${who} ${last}${ladder ? '의 벽에 사다리를 건다' : '의 구덩이에 다리를 놓는다'}. 두 턴 동안 ${ladder ? '넘어갈 수 있다' : '건너고 설 수 있다'}.`,
      actor: actor!,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: 8,
      cost: 1,
      effects: [{ type: 'cover', at: last, kind: ladder ? 'ladder' : 'bridge', turns: 2, prop: look3d() }],
      look: look({ fx: [fx(ladder ? 'wind' : 'earth', 'burst', last, { strength: 2, withEffect: 1 })] }),
      narration: { success: ladder ? `${last}의 벽에 튼튼한 사다리가 걸렸다!` : `${last}의 구덩이 위로 널빤지 다리가 놓였다!`, failure: '널빤지가 미끄러져 떨어졌다.' },
    };
  }

  // The kinds named just before 처럼 ("룩처럼", "퀸과 나이트처럼"), not the piece doing it.
  const likeText = action.match(/((?:[가-힣]+(?:과|와|이나|,|·)\s*)*[가-힣]+)처럼/)?.[1] ?? '';
  const likeKinds = MOVE_LIKE.filter(([re]) => re.test(likeText)).map(([, k]) => k);
  if (squares.length >= 1 && likeKinds.length && /이동|움직|걷|뛴|뛰|달린|달려|날아/.test(action)) {
    // A piece that also moves like other kinds for a while (on itself, or lent by another).
    if (!actor) return needsActor()!;
    const kinds = likeKinds.map((k) => MOVE_KIND_KO[k]).join('·');
    const strong = likeKinds.includes('queen');
    // "처럼도": its own moves stay too (a lent move replaces the piece's own otherwise).
    const own = /처럼도/.test(action) && board ? board[parseSquare(last)!]?.type : undefined;
    const moveAs = own && !likeKinds.includes(own) ? [own, ...likeKinds] : likeKinds;
    return {
      interpretation: `${last}의 기물이 두 턴 동안 ${own ? '원래 움직임과 함께 ' : '원래 움직임 대신 '}${kinds}처럼 움직인다.`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: strong ? 9 : 8,
      cost: strong ? 3 : 2,
      effects: [tag(last, `${kinds}의 걸음`, 2, { moveAs, aura: 'wind', auraStrength: 1 })],
      look: look({ fx: [fx('wind', 'burst', last, { strength: 3, radius: 0.7, withEffect: 1 })], acts: [{ at: last, act: 'spin', delay: 0.2 }] }),
      narration: { success: `${last}의 기물이 ${kinds}의 걸음을 익혔다!`, failure: '발이 꼬여 제자리에서 비틀거렸다.' },
    };
  }

  if (squares.length >= 1 && /연속|두\s*번|세\s*번|[23]\s*번|한 번 더/.test(action) && /이동|움직|둔다|두기|전진|달린|달려/.test(action)) {
    // Several normal moves in a row this turn (and next).
    if (!actor) return needsActor()!;
    const times = /세\s*번|3\s*번/.test(action) ? 3 : 2;
    return {
      interpretation: `${last}의 기물이 이번 턴(과 다음 내 턴)에 일반 수를 ${times}번 연속으로 둔다.`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: times === 3 ? 10 : 9,
      cost: times === 3 ? 3 : 2,
      effects: [tag(last, '질주', 1, { moveTimes: times, aura: 'wind', auraStrength: 2 })],
      look: look({ fx: [fx('wind', 'burst', last, { strength: 3, radius: 0.8, withEffect: 1 })], acts: [{ at: last, act: 'hop', delay: 0.2 }] }),
      narration: { success: `${last}의 기물이 바람처럼 몸을 풀었다. 한 번에 ${times}걸음!`, failure: '숨이 차서 멈춰 섰다.' },
    };
  }

  if (/검술|검을 들|검을 쥐|칼을 들|칼을 쥐|창술|창을 들/.test(action) && squares.length >= 1) {
    // A piece takes up arms (itself, or armed by another): a clash multiplier and the weapon in hand.
    if (!actor) return needsActor()!;
    const spear = /창술|창을/.test(action);
    return {
      interpretation: `${last}의 기물이 ${spear ? '창술' : '검술'}에 눈을 떴다. 이제 잡히려 하면 합으로 맞선다(×1.5).`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: 9,
      cost: 3,
      effects: [tag(last, spear ? '창술' : '검술', 0, { clash: 1.5, prop: look3d(spear ? 'spear' : 'sword', 'rightHand') })],
      look: look({ fx: [fx('light', 'burst', last, { strength: 3, radius: 0.7, withEffect: 1 })], acts: [{ at: last, act: 'spin', delay: 0.3 }] }),
      narration: { success: `${last}의 기물이 ${spear ? '창' : '검'}을 쥐고 자세를 잡았다! 함부로 덤비면 베인다.`, failure: '휘두르던 막대기가 손에서 미끄러졌다.' },
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
      dc: 6,
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
      dc: Math.min(11, 6 + 2 * at.length),
      cost: at.length > 1 ? 2 : 1,
      effects: at.map((sq) => ({ type: 'terrain' as const, at: sq, kind: 'wall' as const, turns: 2, prop: look3d() })),
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
      dc: 8,
      cost: 2,
      effects: [{ type: 'terrain', at: last, kind: 'pit', turns: 2, prop: look3d() }],
      look: look({ shake: 2, beats: [beat(1, { exit: 'sink' })], fx: [fx('earth', 'burst', last, { strength: 4, radius: 0.9, withEffect: 1 })] }),
      narration: { success: `${last}의 땅이 꺼지며 시커먼 구덩이가 입을 벌렸다!`, failure: '땅에 금이 갔지만 꺼지지는 않았다.' },
    };
  }

  // 융합: "c3 나이트가 d4 비숍을 흡수한다" (the first square takes in the last).
  if (squares.length >= 2 && /흡수|융합|합쳐|합체/.test(action) && !/분리|떼어|벗/.test(action)) {
    if (!actor) return needsActor()!;
    const kind = board?.[squares[squares.length - 1]]?.type;
    const enemy = !!board && board[squares[squares.length - 1]]?.color !== color;
    const dc = (kind === 'queen' ? 10 : kind === 'rook' ? 9 : kind === 'pawn' ? 6 : 8) + (enemy ? 2 : 0);
    return {
      interpretation: `${actor}의 기물이 ${last}의 기물을 흡수해 하나로 융합한다.`,
      actor,
      means: 'touch',
      feasible: true,
      dc: Math.min(12, dc),
      cost: kind === 'pawn' ? 1 : kind === 'queen' || kind === 'rook' ? 3 : 2,
      effects: [{ type: 'fuse', body: actor, material: last }],
      look: look({ shake: 1, fx: [fx('arcane', 'burst', actor, { strength: 3, radius: 1, withEffect: 1 })] }),
      narration: { success: `${last}의 기물이 소용돌이치며 ${actor}의 기물과 하나가 되었다!`, failure: '두 기물이 부딪혔다가 튕겨 나갔다.' },
    };
  }
  // Splitting a fused piece: "c3 융합 기물이 관을 벗어 c4에 내려놓는다".
  if (squares.length >= 2 && /분리|떼어|벗/.test(action)) {
    if (!actor) return needsActor()!;
    return {
      interpretation: `${actor}의 융합한 기물이 맨 위 관을 떼어 ${last}에 내려놓는다.`,
      actor,
      means: 'touch',
      feasible: true,
      dc: 5,
      cost: 1,
      effects: [{ type: 'split', at: actor, to: last }],
      look: look({ fx: [fx('light', 'burst', last, { strength: 2, withEffect: 1 })] }),
      narration: { success: `관이 떨어져 나와 ${last}에 내려섰다.`, failure: '관이 단단히 붙어 떨어지지 않았다.' },
    };
  }

  // The four tags that change who moves or who falls: 혼란, 행동대장, 원호, 인질.
  const special = /혼란/.test(action) ? '혼란' : /행동대장|선봉/.test(action) ? '행동대장' : /원호|호위|대신 막/.test(action) ? '원호' : /인질/.test(action) ? '인질' : null;
  if (special && squares.length >= 1) {
    if (!actor) return needsActor()!;
    // 인질 and 혼란 are put on someone else's piece; 행동대장 and 원호 on one's own (the actor itself if no other square).
    const onEnemy = special === '인질' || special === '혼란';
    if (onEnemy && squares.length < 2) return refuse('누가 누구에게 하는지 두 칸을 써 주세요.');
    const at = onEnemy ? last : squares.length >= 2 ? last : actor;
    const turns = special === '행동대장' || special === '혼란' ? 2 : 3;
    return {
      interpretation:
        special === '혼란'
          ? `${who} ${at}의 기물을 ${turns}턴 동안 혼란에 빠뜨린다.`
          : special === '행동대장'
            ? `${at}의 기물이 ${turns}턴 동안 행동대장이 되어 턴 끝마다 스스로 나선다.`
            : special === '원호'
              ? `${at}의 기물이 ${turns}턴 동안 곁의 아군을 원호한다.`
              : `${who} 곁의 ${at} 기물을 ${turns}턴 동안 인질로 잡는다.`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: special === '인질' || special === '행동대장' ? 9 : 8,
      cost: 2,
      effects: [tag(at, special, turns, { aura: special === '혼란' ? 'arcane' : special === '행동대장' ? 'light' : 'none', auraStrength: special === '혼란' || special === '행동대장' ? 1 : 0 })],
      look: look({ fx: [fx(special === '혼란' ? 'arcane' : 'light', 'burst', at, { strength: 2, withEffect: 1 })], acts: [{ at, act: special === '혼란' ? 'shiver' : 'hop', delay: 0.2 }] }),
      narration: { success: `${at}의 기물에 ${special}의 기운이 깃들었다.`, failure: '아무 일도 일어나지 않았다.' },
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
      dc: 7 + (far > 2 ? 2 : 0),
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
      dc: 7 + (far > 1 ? 2 : 0),
      cost: 2,
      effects: [tag(last, '보호막', 0, { prop: look3d('shield', 'leftHand') })],
      look: look({ fx: [fx('light', 'burst', last, { strength: 3, radius: 1, withEffect: 1 })] }),
      narration: { success: `푸른 결계가 ${last}의 기물을 감쌌다!`, failure: '결계가 형태를 이루지 못하고 흩어졌다.' },
    };
  }

  if (squares.length >= 1 && /떨어뜨|추락시|끌어내리|부양을 (풀|해제|깨)/.test(action)) {
    if (!actor) return needsActor()!;
    if (!last.endsWith('^')) return refuse(`${last}에는 떠 있는 기물이 없습니다.`);
    return {
      interpretation: `${who} ${last}의 떠 있는 기물을 땅으로 떨어뜨린다.`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: 9,
      cost: 2,
      effects: [{ type: 'untag', at: last, tag: '공중부양' }],
      look: look({ fx: [fx('wind', 'burst', last, { strength: 3, radius: 0.8, withEffect: 1 })] }),
      narration: { success: `${last}의 기물이 힘을 잃고 곤두박질친다!`, failure: '떠 있는 기물은 꿈쩍도 하지 않았다.' },
    };
  }

  if (squares.length >= 1 && /공중부양|떠오|떠올|띄운|띄워|띄우|부양/.test(action)) {
    // On itself, or by another of the player's pieces (an enemy's is a harder spell: it may not land well).
    if (!actor) return needsActor()!;
    const target = last.replace('^', '');
    const enemy = board ? board[parseSquare(target)!]?.color !== color && !!board[parseSquare(target)!] : false;
    return {
      interpretation: `${who} ${target}의 기물을 두 턴 동안 공중에 띄운다. 공중에서는 공중의 기물만 상대하고, 끝나면 떨어진다.`,
      actor,
      means: far <= 1 ? 'touch' : 'magic',
      feasible: true,
      dc: enemy ? 9 : far > 1 ? 7 : 6,
      cost: enemy ? 2 : 1,
      effects: [tag(target, '공중부양', 2, { aura: 'wind', auraStrength: 1 })],
      look: look({ fx: [fx('wind', 'burst', target, { strength: 2, radius: 0.8, withEffect: 1 })] }),
      narration: { success: `${target}의 기물이 둥실 떠올랐다!`, failure: '기물이 잠깐 들썩이다 도로 내려앉았다.' },
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
      dc: shot ? Math.min(11, 7 + far) : 6,
      cost: 2,
      effects: [tag(last, '화상', 3, { aura: 'fire', auraStrength: 2 })],
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
      interpretation: `${who} 잡혔던 ${COLOR_KO[color]} ${josa(PIECE_KO[named], '을/를')} ${last}에 되살린다.`,
      actor: actor!,
      means: 'magic',
      feasible: true,
      dc: strong ? 10 : named === 'pawn' ? 6 : 9,
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
      interpretation: `${who} ${last}에 ${COLOR_KO[color]} ${josa(PIECE_KO[named], '을/를')} 불러낸다.`,
      actor: actor!,
      means: 'magic',
      feasible: true,
      dc: strong ? 10 : named === 'pawn' ? 6 : 8,
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
      dc: strong ? 10 : 8,
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
      dc: shot ? Math.min(11, 7 + far) : 9,
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
    const dc = Math.min(11, 4 + d);
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
