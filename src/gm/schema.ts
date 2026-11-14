import { z } from 'zod';

/**
 * JSON shape every GM must return. Used as the structured-output schema for LLM
 * providers; parseGmRuling re-checks it and the engine validates the rules.
 */
export const GmRulingSchema = z.object({
  interpretation: z.string().describe('플레이어의 선언을 GM이 어떻게 이해했는지 한 문장으로'),
  feasible: z.boolean().describe('시도 자체가 가능한 행동인가. 행동이 아니거나 규칙을 바꾸려는 요청이면 false'),
  dc: z.number().int().describe('난이도. d20 결과가 이 값 이상이면 성공. 불가능하면 0'),
  cost: z.number().int().describe('시도할 때 드는 AP. 불가능하면 0'),
  effects: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('move'),
          from: z.string().describe('기물이 있는 칸, 예: "b1"'),
          to: z.string().describe('도착 칸, 예: "e5"'),
        }),
        z.object({
          type: z.literal('remove'),
          at: z.string().describe('제거할 기물이 있는 칸, 예: "d7"'),
        }),
      ]),
    )
    .describe('성공했을 때 순서대로 적용할 효과'),
  narration: z.object({
    success: z.string().describe('성공했을 때의 서술 (한국어, 1~2문장)'),
    failure: z.string().describe('실패했을 때의 서술 (한국어, 1~2문장)'),
  }),
});
