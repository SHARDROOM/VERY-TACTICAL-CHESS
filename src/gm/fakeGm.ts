import { fileOf, parseSquare, rankOf, type Square } from '../engine';
import type { GameMaster, GmRequest, GmRulingJson } from './types';
import { josa } from '../ui/josa';

const REMOVE_WORDS = /제거|파괴|없애|날려\s*버|암살|처치|저격|죽이|부숴|부순/;

/**
 * A stand-in GM for development and tests. It only understands declarations
 * that mention squares:
 * - two squares + a riding word ("a2 폰을 b1 나이트에 태운다") → first boards second
 * - a square + 기절 → 1-turn stun; a square + 보호막 → permanent shield
 * - one or more squares + a removal word ("d7 폰을 저격한다") → remove the last square
 * - two or more squares ("b1 나이트를 투석기로 e5까지") → move first → second
 * Anything else is ruled infeasible.
 */
export class FakeGameMaster implements GameMaster {
  readonly name = '가짜 GM (개발용)';

  constructor(private readonly delayMs = 500) {}

  async rule({ action }: GmRequest): Promise<GmRulingJson> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return fakeRuling(action);
  }
}

export function fakeRuling(action: string): GmRulingJson {
  const base = fakeBaseRuling(action);
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

function fakeBaseRuling(action: string): BaseRuling {
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
      '가짜 GM은 칸 좌표가 들어간 행동만 이해합니다. 예: "b1 나이트를 투석기로 e5까지 날린다", "d7 폰을 저격한다", "g8 나이트를 기절시킨다", "e1 킹에 보호막", "a2 폰을 b1 나이트에 태운다"',
    feasible: false,
    dc: 0,
    cost: 0,
    effects: [],
    narration: { success: '', failure: '' },
  };
}
