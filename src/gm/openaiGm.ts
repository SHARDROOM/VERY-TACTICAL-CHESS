import type { z } from 'zod';
import type { ChaosRequest, GameMaster, GmChaosJson, GmRequest, GmRulingJson } from './types';
import { buildChaosSystemPrompt, buildChaosUserMessage, buildSystemPrompt, buildUserMessage } from './prompt';
import { GM_CHAOS_JSON_SCHEMA, GM_RULING_JSON_SCHEMA } from './jsonSchema';
import { GmChaosSchema, GmRulingSchema } from './schema';
import { GmError, describeHttpError, describeNetworkError, fetchWithRetry } from './errors';
import { REFUSED, TRUNCATED, jsonFromText } from './llmReply';

/** Suggestions only: the settings field accepts any model id. */
export const OPENAI_MODEL_SUGGESTIONS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6-astra'];

export interface OpenAiGmOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Wait before the one retry of a busy server (tests use 0). */
  retryDelayMs?: number;
}

interface ChatCompletion {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  error?: { message?: string };
}

/** GM backed by OpenAI Chat Completions with strict JSON-schema structured output, called from the browser (BYOK). */
export class OpenAiGameMaster implements GameMaster {
  readonly name: string;

  constructor(private readonly options: OpenAiGmOptions) {
    this.name = `OpenAI GM (${options.model})`;
  }

  rule({ action, state }: GmRequest): Promise<GmRulingJson> {
    return this.ask(buildSystemPrompt(state.rules), buildUserMessage(action, state), 'gm_ruling', GM_RULING_JSON_SCHEMA, GmRulingSchema);
  }

  chaos({ state, inspiration, problem }: ChaosRequest): Promise<GmChaosJson> {
    return this.ask(buildChaosSystemPrompt(state.rules), buildChaosUserMessage(state, inspiration, problem), 'gm_chaos', GM_CHAOS_JSON_SCHEMA, GmChaosSchema);
  }

  private async ask<T extends z.ZodTypeAny>(system: string, user: string, name: string, jsonSchema: object, schema: T): Promise<z.infer<T>> {
    const doFetch = this.options.fetch ?? fetch;
    let res: Response;
    try {
      res = await fetchWithRetry(doFetch, `${this.options.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`, () => ({
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name, strict: true, schema: jsonSchema },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      }), this.options.retryDelayMs ?? 1500);
    } catch (err) {
      throw new GmError(describeNetworkError('OpenAI', err));
    }

    const body = (await res.json().catch(() => ({}))) as ChatCompletion;
    if (!res.ok) throw new GmError(describeHttpError('OpenAI', res.status, body.error?.message ?? ''));

    const choice = body.choices?.[0];
    if (choice?.message?.refusal) throw new GmError(REFUSED);
    if (choice?.finish_reason === 'length') throw new GmError(TRUNCATED);
    if (choice?.finish_reason === 'content_filter') throw new GmError(REFUSED);
    return jsonFromText(choice?.message?.content ?? '', schema);
  }
}
