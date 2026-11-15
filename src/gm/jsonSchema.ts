import { ELEMENTS, MEANS } from '../engine';
import { GM_RULING_STAGING_JSON_SCHEMA, GM_STAGING_JSON_SCHEMA } from './staging';
import { GM_PROP_JSON_SCHEMA } from './props';

const prop = { ...GM_PROP_JSON_SCHEMA, description: '조형물: 태그나 지형의 모습. 필요 없으면 preset "none"에 parts 빈 목록' };

/**
 * Hand-written JSON Schema for the GM ruling, for providers whose structured
 * output takes plain JSON Schema (OpenAI strict mode, Gemini responseJsonSchema).
 * Kept to the conservative common subset: every property required,
 * additionalProperties false, anyOf (not oneOf), enum (not const), no numeric bounds.
 * Mirrors GmRulingSchema (zod), which still validates every reply.
 */
const sq = (description: string) => ({ type: 'string', description });
const PIECES = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

function effect(type: string, properties: Record<string, object>) {
  return {
    type: 'object',
    properties: { type: { type: 'string', enum: [type] }, ...properties },
    required: ['type', ...Object.keys(properties)],
    additionalProperties: false,
  };
}

export const GM_EFFECT_JSON_SCHEMAS = [
  effect('move', { from: sq('기물이 있는 칸, 예: "b1"'), to: sq('도착 칸, 예: "e5"') }),
  effect('remove', { at: sq('제거할 기물이 있는 칸, 예: "d7"') }),
  effect('tag', {
    at: sq('태그를 붙일 기물의 칸'),
    tag: { type: 'string', description: '태그 이름. 핵심 태그: "기절", "보호막", "화상". 그 밖의 이름은 서사용 자유 태그' },
    turns: { type: 'integer', description: '지속 턴 수 (그 기물 주인의 턴 기준). 0이면 영구' },
    aura: { type: 'string', enum: ['none', ...ELEMENTS], description: '태그가 남아 있는 동안 기물에 두를 원소 오라' },
    auraStrength: { type: 'number', description: '오라 세기 1~3 (none이면 0)' },
    clash: { type: 'number', description: '합 배율 1.2~2.0 (검술처럼 싸움 실력을 주는 태그). 없으면 0' },
    prop,
  }),
  effect('untag', { at: sq('태그를 뗄 기물의 칸'), tag: { type: 'string', description: '뗄 태그 이름' } }),
  effect('board', { rider: sq('올라탈 기물의 칸'), carrier: sq('태울 같은 편 기물의 칸') }),
  effect('unboard', { at: sq('누군가를 태운 기물의 칸'), to: sq('내릴 빈 칸') }),
  effect('transform', { at: sq('변환할 기물의 칸'), into: { type: 'string', enum: PIECES, description: '새 기물 종류 (킹 불가)' } }),
  effect('spawn', {
    at: sq('기물을 만들 빈 칸'),
    color: { type: 'string', enum: ['white', 'black'], description: '만들 기물의 편' },
    piece: { type: 'string', enum: PIECES, description: '만들 기물 종류 (킹 불가)' },
  }),
  effect('convert', {
    at: sq('편을 바꿀 기물의 칸 (킹 불가)'),
    color: { type: 'string', enum: ['white', 'black'], description: '새로 속할 편' },
  }),
  effect('swap', { a: sq('자리를 바꿀 기물 하나의 칸'), b: sq('자리를 바꿀 다른 기물의 칸') }),
  effect('revive', {
    at: sq('되살린 기물을 놓을 빈 칸'),
    color: { type: 'string', enum: ['white', 'black'], description: '되살릴 잡힌 기물의 편' },
    piece: { type: 'string', enum: PIECES, description: '되살릴 잡힌 기물의 종류' },
  }),
  effect('terrain', {
    at: sq('지형을 만들 칸 (벽은 빈 칸만, 구덩이는 그 칸의 기물을 삼킴)'),
    kind: { type: 'string', enum: ['wall', 'pit'], description: 'wall(벽) 또는 pit(구덩이)' },
    turns: { type: 'integer', description: '지속 턴 수 (만든 쪽의 턴 기준). 0이면 영구' },
    prop,
  }),
  effect('clearTerrain', { at: sq('벽이나 구덩이를 없앨 칸') }),
  effect('cover', {
    at: sq('구덩이(다리) 또는 벽(사다리)이 있는 칸'),
    kind: { type: 'string', enum: ['bridge', 'ladder'], description: 'bridge(구덩이 위 다리: 지나가고 설 수 있음) 또는 ladder(벽의 사다리: 지나가기만)' },
    turns: { type: 'integer', description: '지속 턴 수 (만든 쪽의 턴 기준). 0이면 영구' },
    prop,
  }),
  effect('clearCover', { at: sq('다리를 끊거나 사다리를 치울 칸') }),
];

/** Mirrors GmChaosSchema. */
export const GM_CHAOS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '사건의 짧은 제목 (한국어, 15자 이내)' },
    narration: { type: 'string', description: '무슨 일이 일어났는지 해설 (한국어, 1~2문장)' },
    effects: { type: 'array', description: '순서대로 적용할 효과 (1~3개)', items: { anyOf: GM_EFFECT_JSON_SCHEMAS } },
    staging: { ...GM_STAGING_JSON_SCHEMA, description: '사건이 화면에서 어떻게 보일지 (보기용 연출)' },
  },
  required: ['title', 'narration', 'effects', 'staging'],
  additionalProperties: false,
} as const;

export const GM_RULING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    interpretation: { type: 'string', description: '플레이어의 선언을 GM이 어떻게 이해했는지 한 문장으로' },
    actor: { type: 'string', description: '행동하는 선언자 쪽 기물(주체)의 칸, 예: "e6". 주체가 없거나 불가능 판정이면 ""' },
    means: {
      type: 'string',
      enum: [...MEANS],
      description: '주체가 하는 방법: touch(근접, 1칸 이내만), ranged(쏘기·던지기), magic(주문), move(주체가 직접 이동)',
    },
    feasible: { type: 'boolean', description: '시도 자체가 가능한 행동인가. 행동이 아니거나 규칙을 바꾸려는 요청이면 false' },
    dc: { type: 'integer', description: '난이도. d20 결과가 이 값 이상이면 성공. 불가능하면 0' },
    cost: { type: 'integer', description: '시도할 때 드는 AP. 불가능하면 0' },
    effects: {
      type: 'array',
      description: '성공했을 때 순서대로 적용할 효과',
      items: { anyOf: GM_EFFECT_JSON_SCHEMAS },
    },
    critSuccessEffects: {
      type: 'array',
      description: '주사위 20(대성공)일 때 effects 대신 적용할 효과. 성공보다 조금 더 좋은 결과. 비우면 effects가 적용됨',
      items: { anyOf: GM_EFFECT_JSON_SCHEMAS },
    },
    critFailureEffects: {
      type: 'array',
      description: '주사위 1(대실패)일 때 적용할 역효과. 비우면 아무 일도 없음',
      items: { anyOf: GM_EFFECT_JSON_SCHEMAS },
    },
    narration: {
      type: 'object',
      properties: {
        success: { type: 'string', description: '성공했을 때의 서술 (한국어, 1~2문장)' },
        failure: { type: 'string', description: '실패했을 때의 서술 (한국어, 1~2문장)' },
        critSuccess: { type: 'string', description: '대성공(20)일 때의 서술 (한국어, 1~2문장)' },
        critFailure: { type: 'string', description: '대실패(1)일 때의 서술 (한국어, 1~2문장)' },
      },
      required: ['success', 'failure', 'critSuccess', 'critFailure'],
      additionalProperties: false,
    },
    staging: { ...GM_RULING_STAGING_JSON_SCHEMA, description: '결과 넷 각각이 화면에서 어떻게 보일지 (보기용 연출, 규칙에는 영향 없음)' },
  },
  required: ['interpretation', 'actor', 'means', 'feasible', 'dc', 'cost', 'effects', 'critSuccessEffects', 'critFailureEffects', 'narration', 'staging'],
  additionalProperties: false,
} as const;
