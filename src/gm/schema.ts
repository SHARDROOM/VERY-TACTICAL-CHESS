import { z } from 'zod';
import { ELEMENTS, MEANS } from '../engine';
import { GmRulingStagingSchema, GmStagingSchema } from './staging';
import { GmPropSchema } from './props';

const square = (what: string) => z.string().describe(`${what}, 예: "e4" (공중의 칸은 "e4^")`);
const pieceType = z.enum(['queen', 'rook', 'bishop', 'knight', 'pawn']);

/**
 * JSON shape every GM must return, in two strengths:
 * - the generation schemas (GmRulingSchema, GmChaosSchema) give Claude's structured output
 *   every field, staging and tag auras included; GM_*_JSON_SCHEMA mirror them for other providers;
 * - the reply schemas (Gm*ReplySchema) read answers and let the purely visual parts (staging,
 *   auras) be missing or odd: cleanStaging deals with those instead of rejecting the ruling.
 * After this, parseGmRuling converts squares and the engine validates the rules.
 */
const auraField = z.string().describe(`태그가 남아 있는 동안 기물에 두를 원소 오라: none 또는 ${ELEMENTS.join(', ')}`);
const auraStrengthField = z.number().describe('오라 세기 1~3 (none이면 0)');

const clashField = z.number().describe('합 배율 1.2~2.0 (검술처럼 싸움 실력을 주는 태그). 없으면 0');
const propField = GmPropSchema.describe('조형물: 태그나 지형의 모습. 필요 없으면 preset "none"에 parts 빈 목록');
export const MOVE_AS_DESCRIPTION = '태그가 있는 동안 원래 움직임 대신 이 기물들처럼 움직인다(잡기와 체크 포함). 예: 폰이 룩처럼 → ["rook"], 원래 움직임도 남기려면 그 종류도 넣는다(나이트가 비숍처럼도 → ["knight", "bishop"]). 없으면 빈 목록';
export const MOVE_TIMES_DESCRIPTION = '태그가 있는 동안 한 턴에 일반 수를 연속으로 두는 횟수 2~3 (같은 기물로). 없으면 1';
const moveAsField = z.array(z.enum(['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'])).describe(MOVE_AS_DESCRIPTION);
const moveTimesField = z.number().int().describe(MOVE_TIMES_DESCRIPTION);
export const SKILL_DESCRIPTION = '특기: 이 태그를 가진 기물이 하는 특정 종류의 특수 행동에 주사위 보정을 준다(지휘의 깃발: 함께 전진 +2, 건축가: 지형 만들기 +2). 없으면 about ""에 bonus 0';
export const SKILL_ABOUT_DESCRIPTION = '어떤 행동에 보정을 주는지 짧게 (20자 이내), 예: "함께 전진하는 행동"';
export const SKILL_BONUS_DESCRIPTION = '보정 -3~+3 (0이 아닌 정수). 없으면 0';
export const MIND_DESCRIPTION = '정신력 -3~+3: 다른 편이 이 기물에 거는 정신 계열 행동(회유, 매혹, 공포, 설득, 세뇌)의 주사위에서 이만큼 뺀다(강철 의지 +2, 겁에 질림 -2). 없으면 0';
const skillField = z.object({ about: z.string().describe(SKILL_ABOUT_DESCRIPTION), bonus: z.number().int().describe(SKILL_BONUS_DESCRIPTION) }).describe(SKILL_DESCRIPTION);
const mindField = z.number().int().describe(MIND_DESCRIPTION);

function effectSchema<
  A extends z.ZodTypeAny,
  B extends z.ZodTypeAny,
  C extends z.ZodTypeAny,
  P extends z.ZodTypeAny,
  M extends z.ZodTypeAny,
  T extends z.ZodTypeAny,
  K extends z.ZodTypeAny,
  W extends z.ZodTypeAny,
>(aura: A, auraStrength: B, clash: C, prop: P, moveAs: M, moveTimes: T, skill: K, mind: W) {
  return z.discriminatedUnion('type', [
    z.object({ type: z.literal('move'), from: square('기물이 있는 칸'), to: square('도착 칸') }),
    z.object({ type: z.literal('remove'), at: square('제거할 기물이 있는 칸') }),
    z.object({
      type: z.literal('tag'),
      at: square('태그를 붙일 기물의 칸'),
      tag: z.string().describe('태그 이름. 핵심 태그: "기절", "보호막", "화상", "공중부양". 그 밖의 이름은 자유 태그 (합 배율이나 이동 능력을 줄 수 있음)'),
      turns: z.number().int().describe('지속 턴 수 (그 기물 주인의 턴 기준). 0이면 영구'),
      aura,
      auraStrength,
      clash,
      prop,
      moveAs,
      moveTimes,
      skill,
      mind,
    }),
    z.object({ type: z.literal('untag'), at: square('태그를 뗄 기물의 칸'), tag: z.string().describe('뗄 태그 이름') }),
    z.object({ type: z.literal('board'), rider: square('올라탈 기물의 칸'), carrier: square('태울 같은 편 기물의 칸') }),
    z.object({ type: z.literal('unboard'), at: square('누군가를 태운 기물의 칸'), to: square('내릴 빈 칸') }),
    z.object({ type: z.literal('transform'), at: square('변환할 기물의 칸'), into: pieceType.describe('새 기물 종류 (킹 불가)') }),
    z.object({
      type: z.literal('spawn'),
      at: square('기물을 만들 빈 칸'),
      color: z.enum(['white', 'black', 'red', 'gray']).describe('(red는 3인 맵에서만, gray는 혼돈의 떠돌이 인물만) 만들 기물의 편'),
      piece: pieceType.describe('만들 기물 종류 (킹 불가)'),
    }),
    z.object({
      type: z.literal('convert'),
      at: square('편을 바꿀 기물의 칸 (킹 불가)'),
      color: z.enum(['white', 'black', 'red', 'gray']).describe('(red는 3인 맵에서만, gray는 혼돈의 떠돌이 인물만) 새로 속할 편'),
    }),
    z.object({ type: z.literal('swap'), a: square('자리를 바꿀 기물 하나의 칸'), b: square('자리를 바꿀 다른 기물의 칸') }),
    z.object({
      type: z.literal('revive'),
      at: square('되살린 기물을 놓을 빈 칸'),
      color: z.enum(['white', 'black', 'red', 'gray']).describe('(red는 3인 맵에서만, gray는 혼돈의 떠돌이 인물만) 되살릴 잡힌 기물의 편'),
      piece: pieceType.describe('되살릴 잡힌 기물의 종류'),
    }),
    z.object({
      type: z.literal('terrain'),
      at: square('지형을 만들 칸 (벽은 빈 칸만, 구덩이는 그 칸의 기물을 삼킴)'),
      kind: z.enum(['wall', 'pit']).describe('wall(벽) 또는 pit(구덩이)'),
      turns: z.number().int().describe('지속 턴 수 (만든 쪽의 턴 기준). 0이면 영구'),
      prop,
    }),
    z.object({ type: z.literal('clearTerrain'), at: square('벽이나 구덩이를 없앨 칸') }),
    z.object({
      type: z.literal('cover'),
      at: square('구덩이(다리) 또는 벽(사다리)이 있는 칸'),
      kind: z.enum(['bridge', 'ladder']).describe('bridge(구덩이 위 다리: 지나가고 설 수 있음) 또는 ladder(벽의 사다리: 지나가기만)'),
      turns: z.number().int().describe('지속 턴 수 (만든 쪽의 턴 기준). 0이면 영구'),
      prop,
    }),
    z.object({ type: z.literal('clearCover'), at: square('다리를 끊거나 사다리를 치울 칸') }),
  ]);
}

const actorField = z.string().describe('행동하는 선언자 쪽 기물(주체)의 칸, 예: "e6". 주체가 없거나 불가능 판정이면 ""');
const meansField = z
  .enum(MEANS as [string, ...string[]])
  .describe('주체가 하는 방법: touch(근접, 1칸 이내만), ranged(쏘기·던지기), magic(주문), move(주체가 직접 이동)');

const targetField = z.string().describe('행동의 주된 대상 기물의 칸(회유할 기물, 공격할 기물 등). 대상이 없거나 칸만 대상이면 ""');
export const SKILLS_DESCRIPTION = '이번 행동에 해당하는 주체(와 그 위에 탄 기물)의 특기 태그 이름 목록. 보정은 시스템이 태그에서 더한다. 없으면 빈 목록';
const skillsField = z.array(z.string()).describe(SKILLS_DESCRIPTION);
export const MENTAL_DESCRIPTION = '회유, 매혹, 공포, 설득, 세뇌처럼 마음을 움직이는 정신 계열 행동이면 true (대상의 정신력이 보정이 된다)';
const mentalField = z.boolean().describe(MENTAL_DESCRIPTION);
export const SACRIFICE_DESCRIPTION = '희생: 선언에서 바치는 선언자 쪽 기물들의 칸(주체에서 1칸 이내, 킹과 주체 불가). 주사위를 굴리는 순간 성공과 상관없이 사라지고, 시스템이 기물 점수만큼 보정을 더한다. 없으면 빈 목록';
const sacrificeField = z.array(z.string()).describe(SACRIFICE_DESCRIPTION);

/** `lenient`: reading a reply, where a missing actor or means is left for the engine to refuse (and the GM to retry). */
function rulingSchema<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(effect: E, staging: S, lenient = false) {
  return z.object({
    interpretation: z.string().describe('플레이어의 선언을 GM이 어떻게 이해했는지 한 문장으로'),
    actor: lenient ? actorField.optional() : actorField,
    means: lenient ? z.string().optional() : meansField,
    target: lenient ? targetField.optional() : targetField,
    skills: lenient ? skillsField.optional() : skillsField,
    mental: lenient ? mentalField.optional() : mentalField,
    sacrifice: lenient ? sacrificeField.optional() : sacrificeField,
    feasible: z.boolean().describe('시도 자체가 가능한 행동인가. 행동이 아니거나 규칙을 바꾸려는 요청이면 false'),
    dc: z.number().int().describe('난이도. 주사위 2개의 합이 이 값 이상이면 성공. 불가능하면 0'),
    cost: z.number().int().describe('시도할 때 드는 AP. 불가능하면 0'),
    effects: z.array(effect).describe('성공했을 때 순서대로 적용할 효과'),
    critFailureEffects: z.array(effect).describe('주사위 합 2(1·1, 대실패)일 때 적용할 역효과. 비우면 아무 일도 없음'),
    narration: z.object({
      success: z.string().describe('성공했을 때의 서술 (한국어, 1~2문장)'),
      failure: z.string().describe('실패했을 때의 서술 (한국어, 1~2문장)'),
      critFailure: z.string().describe('대실패(1)일 때의 서술 (한국어, 1~2문장)'),
    }),
    staging,
  });
}

function chaosSchema<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(effect: E, staging: S) {
  return z.object({
    title: z.string().describe('사건의 짧은 제목 (한국어, 15자 이내)'),
    narration: z.string().describe('무슨 일이 일어났는지 해설 (한국어, 1~2문장)'),
    effects: z.array(effect).describe('순서대로 적용할 효과 (1~3개)'),
    staging,
  });
}

export const GmEffectSchema = effectSchema(auraField, auraStrengthField, clashField, propField, moveAsField, moveTimesField, skillField, mindField);
// Reading a reply, odd move fields are cleaned up (parse.ts) rather than refused.
export const GmEffectReplySchema = effectSchema(
  auraField.optional(),
  auraStrengthField.optional(),
  clashField.optional(),
  z.unknown().optional(),
  z.unknown().optional(),
  z.unknown().optional(),
  z.unknown().optional(),
  z.unknown().optional(),
);

export const GmRulingSchema = rulingSchema(
  GmEffectSchema,
  GmRulingStagingSchema.describe('결과 셋 각각이 화면에서 어떻게 보일지 (보기용 연출, 규칙에는 영향 없음)'),
);
/** A chaos event (the 혼돈 rule): something odd happens at the start of a turn. */
export const GmChaosSchema = chaosSchema(GmEffectSchema, GmStagingSchema.describe('사건이 화면에서 어떻게 보일지 (보기용 연출)'));
export const GmRulingReplySchema = rulingSchema(GmEffectReplySchema, z.unknown().optional(), true);
export const GmChaosReplySchema = chaosSchema(GmEffectReplySchema, z.unknown().optional());
