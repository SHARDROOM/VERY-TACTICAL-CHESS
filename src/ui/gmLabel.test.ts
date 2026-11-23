import { describe, expect, it } from 'vitest';
import { sameModel } from './gmLabel';

describe('sameModel', () => {
  const groq = { provider: 'compatible' as const, model: 'llama-3.3-70b', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'A' };
  it('is the same service and model whatever the key', () => {
    expect(sameModel(groq, { ...groq, apiKey: 'B' })).toBe(true);
    expect(sameModel(groq, { ...groq, model: 'other' })).toBe(false);
    expect(sameModel(groq, { ...groq, baseUrl: 'https://openrouter.ai/api/v1' })).toBe(false);
  });
  it("tells providers and a Claude model's depth apart", () => {
    const claude = { provider: 'claude' as const, model: 'claude-opus-5-5', effort: 'low' as const, apiKey: 'k' };
    expect(sameModel(claude, { ...claude, effort: 'high' })).toBe(false);
    expect(sameModel({ provider: 'gemini', model: 'm', apiKey: 'k' }, { provider: 'openai', model: 'm', apiKey: 'k' })).toBe(false);
    expect(sameModel({ provider: 'fake' }, { provider: 'fake' })).toBe(true);
  });
});
