import type { GameMaster, GmRequest, GmRulingJson } from './types';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import { GM_RULING_JSON_SCHEMA } from './jsonSchema';
import { GmError, describeHttpError, describeNetworkError } from './errors';
import { REFUSED, TRUNCATED, rulingFromText } from './llmReply';

/** Suggestions only: the settings field accepts any model id. */
export const OPENAI_MODEL_SUGGESTIONS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6-astra'];

export interface OpenAiGmOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  baseUrl?: string;
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

  async rule({ action, state }: GmRequest): Promise<GmRulingJson> {
    const doFetch = this.options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.options.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: 'system', content: buildSystemPrompt(state.rules) },
            { role: 'user', content: buildUserMessage(action, state) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'gm_ruling', strict: true, schema: GM_RULING_JSON_SCHEMA },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      throw new GmError(describeNetworkError('OpenAI', err));
    }

    const body = (await res.json().catch(() => ({}))) as ChatCompletion;
    if (!res.ok) throw new GmError(describeHttpError('OpenAI', res.status, body.error?.message ?? ''));

    const choice = body.choices?.[0];
    if (choice?.message?.refusal) throw new GmError(REFUSED);
    if (choice?.finish_reason === 'length') throw new GmError(TRUNCATED);
    if (choice?.finish_reason === 'content_filter') throw new GmError(REFUSED);
    return rulingFromText(choice?.message?.content ?? '');
  }
}
