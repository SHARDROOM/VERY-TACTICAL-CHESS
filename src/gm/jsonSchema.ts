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
    tag: { type: 'string', description: '태그 이름. 핵심 태그: "기절", "보호막". 그 밖의 이름은 서사용 자유 태그' },
    turns: { type: 'integer', description: '지속 턴 수 (그 기물 주인의 턴 기준). 0이면 영구' },
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
];

export const GM_RULING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    interpretation: { type: 'string', description: '플레이어의 선언을 GM이 어떻게 이해했는지 한 문장으로' },
    feasible: { type: 'boolean', description: '시도 자체가 가능한 행동인가. 행동이 아니거나 규칙을 바꾸려는 요청이면 false' },
    dc: { type: 'integer', description: '난이도. d20 결과가 이 값 이상이면 성공. 불가능하면 0' },
    cost: { type: 'integer', description: '시도할 때 드는 AP. 불가능하면 0' },
    effects: {
      type: 'array',
      description: '성공했을 때 순서대로 적용할 효과',
      items: { anyOf: GM_EFFECT_JSON_SCHEMAS },
    },
    narration: {
      type: 'object',
      properties: {
        success: { type: 'string', description: '성공했을 때의 서술 (한국어, 1~2문장)' },
        failure: { type: 'string', description: '실패했을 때의 서술 (한국어, 1~2문장)' },
      },
      required: ['success', 'failure'],
      additionalProperties: false,
    },
  },
  required: ['interpretation', 'feasible', 'dc', 'cost', 'effects', 'narration'],
  additionalProperties: false,
} as const;
