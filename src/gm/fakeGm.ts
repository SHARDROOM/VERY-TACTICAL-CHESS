import { fileOf, parseSquare, rankOf, type Square } from '../engine';
import type { GameMaster, GmRequest, GmRulingJson } from './types';
import { josa } from '../ui/josa';

const REMOVE_WORDS = /제거|파괴|없애|날려\s*버|암살|처치|저격|죽이|부숴|부순/;

/**
 * A stand-in GM for development and tests. It only understands declarations
 * that mention squares:
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
  const names = [...action.toLowerCase().matchAll(/[a-h][1-8]/g)].map((m) => m[0]);
  const squares = names.map(parseSquare).filter((s): s is Square => s !== null);

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
    interpretation: '가짜 GM은 칸 좌표가 들어간 행동만 이해합니다. 예: "b1 나이트를 투석기로 e5까지 날린다", "d7 폰을 저격한다"',
    feasible: false,
    dc: 0,
    cost: 0,
    effects: [],
    narration: { success: '', failure: '' },
  };
}
