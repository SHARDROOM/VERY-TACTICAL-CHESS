import Anthropic from '@anthropic-ai/sdk';
import type { GmConfig } from '../ui/GmSettings';
import { chatEndpoint, serviceName } from './compatible';
import { missingKey } from './createGm';
import { claudeErrorKind, describeApiError } from './claudeGm';
import { GmError, httpError, networkError, type GmErrorKind } from './errors';

/*
 * 응답 확인 (사용자 요청): one short question to the chosen model, to see whether its API answers
 * with this key at all, and how quickly. Not a ruling (that is a long request): just "reply OK".
 * A failure is told as the game would tell it during play (busy, key, no such model, ...).
 */

export type PingResult = { ok: true; ms: number } | { ok: false; ms: number; kind: GmErrorKind; message: string };

const QUESTION = 'Reply with the single word OK.';
/** A check waits this long at most (a ruling may take longer; a check should not). */
const PING_TIMEOUT_MS = 30_000;

export async function pingGm(config: GmConfig, doFetch: typeof fetch = (...a) => fetch(...a), now: () => number = () => performance.now()): Promise<PingResult> {
  const start = now();
  const failed = (err: GmError): PingResult => ({ ok: false, ms: Math.round(now() - start), kind: err.kind, message: err.message });
  if (config.provider === 'fake') return { ok: true, ms: 0 };
  if (missingKey(config)) return failed(new GmError('API 키가 없습니다. 키를 넣은 뒤 확인해 주세요.', 'auth'));
  try {
    if (config.provider === 'claude') {
      const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: PING_TIMEOUT_MS, fetch: doFetch });
      try {
        await client.messages.create({ model: config.model, max_tokens: 16, messages: [{ role: 'user', content: QUESTION }] });
      } catch (err) {
        throw new GmError(describeApiError(err), claudeErrorKind(err));
      }
    } else if (config.provider === 'gemini') {
      await post(doFetch, 'Gemini', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, { 'x-goog-api-key': config.apiKey }, {
        contents: [{ role: 'user', parts: [{ text: QUESTION }] }],
      });
    } else {
      const compatible = config.provider === 'compatible';
      const url = compatible ? chatEndpoint(config.baseUrl) : 'https://api.openai.com/v1/chat/completions';
      await post(doFetch, compatible ? serviceName(config.baseUrl) : 'OpenAI', url, config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}, {
        model: config.model,
        messages: [{ role: 'user', content: QUESTION }],
      });
    }
  } catch (err) {
    return failed(err instanceof GmError ? err : new GmError(err instanceof Error ? err.message : String(err)));
  }
  return { ok: true, ms: Math.round(now() - start) };
}

/** POSTs once; any answer but 2xx is a GmError of the kind the game uses. */
async function post(doFetch: typeof fetch, provider: string, url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  let res: Response;
  try {
    res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
  } catch (err) {
    throw networkError(provider, err);
  }
  if (res.ok) return;
  const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? '';
  // Gemini reports a bad key as 400 rather than 401.
  const status = res.status === 400 && /api key/i.test(detail) ? 401 : res.status;
  throw httpError(provider, status, detail);
}
