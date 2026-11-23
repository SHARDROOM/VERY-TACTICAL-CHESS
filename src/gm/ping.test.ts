import { describe, expect, it } from 'vitest';
import { pingGm } from './ping';

/** A fetch that answers every call with `status` and `body`, and records what was asked. */
function fakeFetch(status: number, body: unknown = {}) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url: String(input instanceof Request ? input.url : input), headers, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

let t = 0;
const clock = () => (t += 700);

describe('pingGm (응답 확인)', () => {
  it('asks the chosen model one short question and says how long the answer took', async () => {
    const { f, calls } = fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
    t = 0;
    const r = await pingGm({ provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'k' }, f, clock);
    expect(r).toEqual({ ok: true, ms: 700 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBe('k');
  });

  it('says what went wrong as the game would: a busy model, a wrong key, no such model', async () => {
    expect(await pingGm({ provider: 'gemini', model: 'm', apiKey: 'k' }, fakeFetch(503, { error: { message: 'high demand' } }).f, clock)).toMatchObject({ ok: false, kind: 'busy', message: expect.stringContaining('몰려') });
    expect(await pingGm({ provider: 'gemini', model: 'm', apiKey: 'k' }, fakeFetch(400, { error: { message: 'API key not valid' } }).f, clock)).toMatchObject({ ok: false, kind: 'auth', message: expect.stringContaining('키') });
    expect(await pingGm({ provider: 'openai', model: 'nope', apiKey: 'k' }, fakeFetch(404, { error: { message: 'model not found' } }).f, clock)).toMatchObject({ ok: false, kind: 'auth', message: expect.stringContaining('모델') });
    expect(await pingGm({ provider: 'openai', model: 'm', apiKey: 'k' }, fakeFetch(429).f, clock)).toMatchObject({ ok: false, kind: 'busy' });
  });

  it('asks nothing without a key, and a server on this computer needs none', async () => {
    const none = fakeFetch(200);
    expect(await pingGm({ provider: 'openai', model: 'm', apiKey: '' }, none.f, clock)).toMatchObject({ ok: false, kind: 'auth' });
    expect(none.calls).toHaveLength(0);
    const local = fakeFetch(200, { choices: [{ message: { content: 'OK' } }] });
    expect(await pingGm({ provider: 'compatible', model: 'llama3', baseUrl: 'http://localhost:11434/v1', apiKey: '' }, local.f, clock)).toMatchObject({ ok: true });
    expect(local.calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(local.calls[0].headers.authorization).toBeUndefined();
  });

  it('reaches another service and Claude the same way', async () => {
    const groq = fakeFetch(200, { choices: [{ message: { content: 'OK' } }] });
    expect(await pingGm({ provider: 'compatible', model: 'llama', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'g' }, groq.f, clock)).toMatchObject({ ok: true });
    expect(groq.calls[0].headers.authorization).toBe('Bearer g');
    const claude = fakeFetch(200, { id: 'm', type: 'message', role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 1 } });
    expect(await pingGm({ provider: 'claude', model: 'claude-x', effort: 'low', apiKey: 'c' }, claude.f, clock)).toMatchObject({ ok: true });
    expect(claude.calls[0].url).toContain('api.anthropic.com/v1/messages');
    const wrong = fakeFetch(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    expect(await pingGm({ provider: 'claude', model: 'claude-x', effort: 'low', apiKey: 'c' }, wrong.f, clock)).toMatchObject({ ok: false, kind: 'auth' });
  });

  it('cannot reach the service: unreachable', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await pingGm({ provider: 'gemini', model: 'm', apiKey: 'k' }, down, clock)).toMatchObject({ ok: false, kind: 'network' });
  });
});
