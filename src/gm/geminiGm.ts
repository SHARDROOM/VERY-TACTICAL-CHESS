import type { z } from 'zod';
import type { ChaosRequest, GameMaster, GmRequest } from './types';
import { GM_PLAYER_JSON_SCHEMA, GmPlayerSchema, buildPlayerSystemPrompt, buildPlayerUserMessage, type ActRequest } from './player';
import { buildChaosSystemPrompt, buildChaosUserMessage, buildSystemPrompt, buildUserMessage } from './prompt';
import { GM_CHAOS_JSON_SCHEMA, GM_RULING_JSON_SCHEMA } from './jsonSchema';
import { GmChaosReplySchema, GmRulingReplySchema } from './schema';
import { GmError, fetchWithRetry, httpError, networkError } from './errors';
import { REFUSED, TRUNCATED, jsonFromText } from './llmReply';

/** Suggestions only: the settings field accepts any model id. */
/** Flash-Lite first: it answered reliably in live tests while 3.8 Flash was often overloaded (503/502). */
export const GEMINI_MODEL_SUGGESTIONS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-4-argon'];

export interface GeminiGmOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Wait before the one retry of a busy server (tests use 0). */
  retryDelayMs?: number;
}

interface GenerateContentResponse {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

const BLOCKED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

/** GM backed by the Gemini API generateContent with JSON-schema structured output, called from the browser (BYOK). */
export class GeminiGameMaster implements GameMaster {
  readonly name: string;

  constructor(private readonly options: GeminiGmOptions) {
    this.name = `Gemini GM (${options.model})`;
  }

  rule({ action, state, problem }: GmRequest): Promise<unknown> {
    return this.ask(buildSystemPrompt(state.rules), buildUserMessage(action, state, problem), GM_RULING_JSON_SCHEMA, GmRulingReplySchema);
  }

  chaos({ state, inspiration, problem }: ChaosRequest): Promise<unknown> {
    return this.ask(buildChaosSystemPrompt(state.rules), buildChaosUserMessage(state, inspiration, problem), GM_CHAOS_JSON_SCHEMA, GmChaosReplySchema);
  }

  act(request: ActRequest): Promise<unknown> {
    return this.ask(buildPlayerSystemPrompt(), buildPlayerUserMessage(request), GM_PLAYER_JSON_SCHEMA, GmPlayerSchema);
  }

  private async ask<T extends z.ZodTypeAny>(system: string, user: string, jsonSchema: object, schema: T): Promise<z.infer<T>> {
    const doFetch = this.options.fetch ?? fetch;
    const base = this.options.baseUrl ?? 'https://generativelanguage.googleapis.com';
    let res: Response;
    try {
      res = await fetchWithRetry(doFetch, `${base}/v1beta/models/${encodeURIComponent(this.options.model)}:generateContent`, () => ({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: jsonSchema },
        }),
        signal: AbortSignal.timeout(90_000),
      }), this.options.retryDelayMs ?? 1500);
    } catch (err) {
      throw networkError('Gemini', err);
    }

    const body = (await res.json().catch(() => ({}))) as GenerateContentResponse;
    if (!res.ok) {
      const message = body.error?.message ?? '';
      // Gemini reports a bad key as 400 INVALID_ARGUMENT rather than 401.
      const status = res.status === 400 && /api key/i.test(message) ? 401 : res.status;
      throw httpError('Gemini', status, message);
    }

    if (body.promptFeedback?.blockReason) throw new GmError(REFUSED);
    const candidate = body.candidates?.[0];
    const reason = candidate?.finishReason ?? '';
    if (reason === 'MAX_TOKENS') throw new GmError(TRUNCATED, 'format');
    if (BLOCKED.has(reason)) throw new GmError(REFUSED);
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    return jsonFromText(text, schema);
  }
}
