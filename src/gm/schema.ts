import { z } from 'zod';

const square = (what: string) => z.string().describe(`${what}, 예: "e4"`);
const pieceType = z.enum(['queen', 'rook', 'bishop', 'knight', 'pawn']);

/**
 * JSON shape every GM must return. Used as the structured-output schema for Claude;
 * GM_RULING_JSON_SCHEMA mirrors it for other providers. Every reply is re-checked here,
 * then parseGmRuling converts squares and the engine validates the rules.
 */
export const GmEffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), from: square('기물이 있는 칸'), to: square('도착 칸') }),
  z.object({ type: z.literal('remove'), at: square('제거할 기물이 있는 칸') }),
  z.object({
    type: z.literal('tag'),
    at: square('태그를 붙일 기물의 칸'),
    tag: z.string().describe('태그 이름. 핵심 태그: "기절", "보호막". 그 밖의 이름은 서사용 자유 태그'),
    turns: z.number().int().describe('지속 턴 수 (그 기물 주인의 턴 기준). 0이면 영구'),
  }),
  z.object({ type: z.literal('untag'), at: square('태그를 뗄 기물의 칸'), tag: z.string().describe('뗄 태그 이름') }),
  z.object({ type: z.literal('board'), rider: square('올라탈 기물의 칸'), carrier: square('태울 같은 편 기물의 칸') }),
  z.object({ type: z.literal('unboard'), at: square('누군가를 태운 기물의 칸'), to: square('내릴 빈 칸') }),
  z.object({ type: z.literal('transform'), at: square('변환할 기물의 칸'), into: pieceType.describe('새 기물 종류 (킹 불가)') }),
  z.object({
    type: z.literal('spawn'),
    at: square('기물을 만들 빈 칸'),
    color: z.enum(['white', 'black']).describe('만들 기물의 편'),
    piece: pieceType.describe('만들 기물 종류 (킹 불가)'),
  }),
]);

export const GmRulingSchema = z.object({
  interpretation: z.string().describe('플레이어의 선언을 GM이 어떻게 이해했는지 한 문장으로'),
  feasible: z.boolean().describe('시도 자체가 가능한 행동인가. 행동이 아니거나 규칙을 바꾸려는 요청이면 false'),
  dc: z.number().int().describe('난이도. d20 결과가 이 값 이상이면 성공. 불가능하면 0'),
  cost: z.number().int().describe('시도할 때 드는 AP. 불가능하면 0'),
  effects: z.array(GmEffectSchema).describe('성공했을 때 순서대로 적용할 효과'),
  critSuccessEffects: z
    .array(GmEffectSchema)
    .describe('주사위 20(대성공)일 때 effects 대신 적용할 효과. 성공보다 조금 더 좋은 결과. 비우면 effects가 적용됨'),
  critFailureEffects: z
    .array(GmEffectSchema)
    .describe('주사위 1(대실패)일 때 적용할 역효과. 비우면 아무 일도 없음'),
  narration: z.object({
    success: z.string().describe('성공했을 때의 서술 (한국어, 1~2문장)'),
    failure: z.string().describe('실패했을 때의 서술 (한국어, 1~2문장)'),
    critSuccess: z.string().describe('대성공(20)일 때의 서술 (한국어, 1~2문장)'),
    critFailure: z.string().describe('대실패(1)일 때의 서술 (한국어, 1~2문장)'),
  }),
});
