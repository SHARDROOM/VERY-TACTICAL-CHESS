/**
 * Hand-written JSON Schema for the GM ruling, for providers whose structured
 * output takes plain JSON Schema (OpenAI strict mode, Gemini responseJsonSchema).
 * Kept to the conservative common subset: every property required,
 * additionalProperties false, anyOf (not oneOf), enum (not const), no numeric bounds.
 * Mirrors GmRulingSchema (zod), which still validates every reply.
 */
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
      items: {
        anyOf: [
          {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['move'] },
              from: { type: 'string', description: '기물이 있는 칸, 예: "b1"' },
              to: { type: 'string', description: '도착 칸, 예: "e5"' },
            },
            required: ['type', 'from', 'to'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['remove'] },
              at: { type: 'string', description: '제거할 기물이 있는 칸, 예: "d7"' },
            },
            required: ['type', 'at'],
            additionalProperties: false,
          },
        ],
      },
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
