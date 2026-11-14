import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine';
import { OpenAiGameMaster } from './openaiGm';
import { GeminiGameMaster } from './geminiGm';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import { GM_RULING_JSON_SCHEMA } from './jsonSchema';
import { GmRulingSchema } from './schema';
import { parseGmRuling } from './parse';
import { failingFetch, fakeFetch, type Captured } from './fakeHttp';

const ruling = {
  interpretation: '룩이 성벽을 타고 미끄러진다',
  feasible: true,
  dc: 11,
  cost: 1,
  effects: [{ type: 'move', from: 'a1', to: 'a5' }, { type: 'remove', at: 'd7' }],
  critSuccessEffects: [],
  critFailureEffects: [],
  narration: { success: '성공!', failure: '실패!', critSuccess: '대성공!', critFailure: '대실패!' },
};
const state = createInitialState();
const req = { action: 'a1 룩이 성벽을 타고 미끄러진다', state };

const openaiReply = (content: string | null, extra: Record<string, unknown> = {}) => ({
  id: 'x',
  object: 'chat.completion',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, refusal: null }, ...extra }],
});
const geminiReply = (text: string, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { role: 'model', parts: [{ text }] } }],
});

describe('shared JSON schema', () => {
  it('requires every property and forbids extras at every object level (strict-mode friendly)', () => {
    const objects: any[] = [GM_RULING_JSON_SCHEMA, GM_RULING_JSON_SCHEMA.properties.narration, ...GM_RULING_JSON_SCHEMA.properties.effects.items.anyOf];
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort());
    }
  });

  it('describes the same shape as the zod schema', () => {
    expect(GmRulingSchema.safeParse(ruling).success).toBe(true);
    expect(Object.keys(GM_RULING_JSON_SCHEMA.properties).sort()).toEqual(Object.keys(GmRulingSchema.shape).sort());
    expect(Object.keys(GM_RULING_JSON_SCHEMA.properties.narration.properties).sort()).toEqual(
      Object.keys(GmRulingSchema.shape.narration.shape).sort(),
    );
    const effectTypes = GM_RULING_JSON_SCHEMA.properties.effects.items.anyOf.map((e) => e.properties.type.enum[0]).sort();
    expect(effectTypes).toEqual(GmRulingSchema.shape.effects.element.options.map((o) => o.shape.type.value).sort());
  });
});

describe('OpenAI GM', () => {
  const gm = (f: typeof fetch) => new OpenAiGameMaster({ apiKey: 'sk-openai', model: 'gpt-test', fetch: f });

  it('sends chat completions with strict JSON-schema output and the shared prompts', async () => {
    const captured: Captured[] = [];
    const out = await gm(fakeFetch({ body: openaiReply(JSON.stringify(ruling)) }, captured)).rule(req);
    const [r] = captured;
    expect(r.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(r.headers.get('authorization')).toBe('Bearer sk-openai');
    expect(r.body.model).toBe('gpt-test');
    expect(r.body.messages).toEqual([
      { role: 'system', content: buildSystemPrompt(state.rules) },
      { role: 'user', content: buildUserMessage(req.action, state) },
    ]);
    expect(r.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'gm_ruling', strict: true, schema: GM_RULING_JSON_SCHEMA },
    });
    expect(out).toEqual(ruling);
    expect(parseGmRuling(out).ok).toBe(true);
  });

  it('maps refusals, truncation and HTTP errors to player-facing messages', async () => {
    await expect(gm(fakeFetch({ body: openaiReply(null, { message: { content: null, refusal: 'no' } }) })).rule(req)).rejects.toThrow(/거절/);
    await expect(gm(fakeFetch({ body: openaiReply('{"inter', { finish_reason: 'length' }) })).rule(req)).rejects.toThrow(/끊겼습니다/);
    await expect(gm(fakeFetch({ status: 401, body: { error: { message: 'Incorrect API key' } } })).rule(req)).rejects.toThrow(/API 키가 올바르지 않습니다/);
    await expect(gm(fakeFetch({ status: 429, body: { error: { message: 'quota' } } })).rule(req)).rejects.toThrow(/한도나 크레딧/);
    await expect(gm(fakeFetch({ status: 404, body: { error: { message: 'model not found' } } })).rule(req)).rejects.toThrow(/모델을 찾을 수 없습니다/);
    await expect(gm(failingFetch).rule(req)).rejects.toThrow(/연결하지 못했습니다/);
    await expect(gm(fakeFetch({ body: openaiReply('nope') })).rule(req)).rejects.toThrow(/해석하지 못했습니다/);
  });
});

describe('Gemini GM', () => {
  const gm = (f: typeof fetch) => new GeminiGameMaster({ apiKey: 'AIza-test', model: 'gemini-test', fetch: f });

  it('sends generateContent with a JSON response schema and the shared prompts', async () => {
    const captured: Captured[] = [];
    const out = await gm(fakeFetch({ body: geminiReply(JSON.stringify(ruling)) }, captured)).rule(req);
    const [r] = captured;
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(r.headers.get('x-goog-api-key')).toBe('AIza-test');
    expect(r.url).not.toContain('AIza-test');
    expect(r.body.systemInstruction).toEqual({ parts: [{ text: buildSystemPrompt(state.rules) }] });
    expect(r.body.contents).toEqual([{ role: 'user', parts: [{ text: buildUserMessage(req.action, state) }] }]);
    expect(r.body.generationConfig).toEqual({ responseMimeType: 'application/json', responseJsonSchema: GM_RULING_JSON_SCHEMA });
    expect(out).toEqual(ruling);
  });

  it('ignores thought parts and joins text parts', async () => {
    const json = JSON.stringify(ruling);
    const body = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking…', thought: true }, { text: json.slice(0, 10) }, { text: json.slice(10) }] } }] };
    expect(await gm(fakeFetch({ body })).rule(req)).toEqual(ruling);
  });

  it('maps blocks, truncation and HTTP errors to player-facing messages', async () => {
    await expect(gm(fakeFetch({ body: { promptFeedback: { blockReason: 'SAFETY' } } })).rule(req)).rejects.toThrow(/거절/);
    await expect(gm(fakeFetch({ body: geminiReply('', 'SAFETY') })).rule(req)).rejects.toThrow(/거절/);
    await expect(gm(fakeFetch({ body: geminiReply('{"a', 'MAX_TOKENS') })).rule(req)).rejects.toThrow(/끊겼습니다/);
    await expect(
      gm(fakeFetch({ status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } } })).rule(req),
    ).rejects.toThrow(/API 키가 올바르지 않습니다/);
    await expect(gm(fakeFetch({ status: 429, body: { error: { code: 429, message: 'quota', status: 'RESOURCE_EXHAUSTED' } } })).rule(req)).rejects.toThrow(/한도나 크레딧/);
    await expect(gm(failingFetch).rule(req)).rejects.toThrow(/연결하지 못했습니다/);
  });
});
