import { z } from 'zod';
import type { Color, GameState } from '../engine';
import { situationText } from './prompt';

/*
 * An AI player's special actions (docs/SPEC.md, "AI 플레이어"): the GM's LLM is asked, as that
 * player, for one declaration to try this turn; the declaration then goes to the GM for a ruling
 * like anyone's. The AI's chess engine adds what it sees (pieces in danger, free captures).
 */

/** How the AI words its declarations: going for the throat (어려움, 무아) or having fun (쉬움, 보통). */
export type PlayerStyle = 'sharp' | 'playful';

export interface ActRequest {
  state: GameState;
  /** The AI's side (it is that side's turn). */
  color: Color;
  style: PlayerStyle;
  /** What the engine sees, a line each. */
  hints: string[];
  /** The hardest DC it would roll for (null: it rolls whatever comes). */
  maxDc?: number | null;
}

export const GmPlayerSchema = z.object({ declaration: z.string().describe('이번 턴에 시도할 특수 행동 선언 한 문장 (한국어, 60자 이내, 주체 칸을 먼저)') });
export const GM_PLAYER_JSON_SCHEMA = {
  type: 'object',
  properties: { declaration: { type: 'string', description: '이번 턴에 시도할 특수 행동 선언 한 문장 (한국어, 60자 이내, 주체 칸을 먼저)' } },
  required: ['declaration'],
  additionalProperties: false,
} as const;

const COLOR: Record<Color, string> = { white: '백', black: '흑', red: '적', gray: '회색' };

export function buildPlayerSystemPrompt(): string {
  return `당신은 "아주 전략적인 체스"를 두는 AI 플레이어입니다. 이 게임은 체스에 TRPG를 더했습니다: 일반 수 말고도 AP를 써서 자유로운 "특수 행동"을 한국어 문장으로 선언하면, GM이 난이도(DC)와 효과를 정하고 주사위 2개로 판정합니다.

당신이 할 일: 이번 턴에 시도할 특수 행동 선언을 딱 한 문장 지어내세요. 판정은 다른 GM이 합니다.

선언 쓰는 법:
- 행동하는 내 기물(주체)의 칸을 맨 앞에 쓰세요. 예: "d4 나이트가 e6 폰에게 달려가 창으로 찌른다".
- 대상이 있으면 그 칸도 쓰세요. 근접 행동(찌르기, 붙잡기, 불 붙이기)은 대상이 1칸 안이어야 합니다. 멀면 쏘거나 던지거나 주문을 쓰세요.
- 킹은 어떤 행동으로도 잡거나 없앨 수 없습니다. 킹을 노리는 선언은 하지 마세요.
- 쓸 수 있는 행동의 예: 보호막 두르기, 기절시키기, 불화살로 맞히기, 돌진, 투석기로 날리기, 벽이나 구덩이 만들기, 회유해 편 바꾸기, 검술 같은 싸움 실력(합 배율) 얻기, 공중부양, 다른 기물처럼 움직이기, 원호·인질·행동대장·혼란 태그, 유해 위에서 되살리기, 이웃 기물 흡수(융합), 제물 바치기.
- 비싸고 어려운 행동은 실패하기 쉽습니다. 내 AP 안에서 해 볼 만한 것을 고르세요.
- 60자 이내 한국어 한 문장. 설명이나 다른 말은 쓰지 마세요.`;
}

/** The chance two dice reach `dc` (snake eyes never do), in percent. */
function chancePct(dc: number): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b !== 2 && a + b >= dc) n++;
  return Math.round((n / 36) * 100);
}

export function buildPlayerUserMessage({ state, color, style, hints, maxDc }: ActRequest): string {
  const ap = state.ap[color] ?? 0;
  const { costMin, costMax } = state.rules;
  const budget = [
    `- 보유 AP는 ${ap}입니다. 판정 비용이 ${ap} AP를 넘으면 시도할 수 없으니, 그 안에 들 행동만 고르세요.`,
    maxDc ? `- 성공 확률 ${chancePct(maxDc)}% 이상(DC ${maxDc} 이하)으로 판정될 만한 행동을 고르세요. 그보다 어려운 판정이 나오면 이 AI는 굴리지 않고 취소합니다.` : '',
    `- GM의 기준: 영향이 작고 그럴듯한 행동은 DC 4~6·AP ${costMin}, 폰이나 마이너 기물 제거·중요 기물 위협·먼 이동은 DC 7~9·AP ${Math.min(costMax, costMin + 1)}, 퀸·룩 제거 같은 결정적 행동은 DC 9~11·AP ${costMax}. 대상이 가까울수록(1~2칸), 효과가 짧을수록(1턴) 쉽고 쌉니다.`,
  ]
    .filter(Boolean)
    .join('\n');
  const aim =
    style === 'sharp'
      ? '판을 가장 크게 바꿀 수 있는, 그러면서도 그럴듯해서 성공할 만한 행동을 고르세요. 엔진이 본 위험을 막거나 기회를 살리는 쪽이 좋습니다.'
      : '재미있고 엉뚱한, 이야기가 있는 행동을 고르세요. 꼭 최선일 필요는 없습니다.';
  return `## 당신
- ${COLOR[color]} (보유 AP ${ap})

## 예산과 확률
${budget}

## 엔진이 본 것
${hints.map((h) => `- ${h}`).join('\n') || '- (특별한 것 없음)'}

${situationText(state)}
## 지금 할 일
${COLOR[color]}의 이번 턴 특수 행동 선언을 한 문장으로. ${aim}`;
}

/** The declaration from a reply, trimmed to fit (null if there is none). */
export function parsePlayerAction(raw: unknown, maxLength: number): string | null {
  const r = GmPlayerSchema.safeParse(raw);
  if (!r.success) return null;
  const text = r.data.declaration.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}
