/*
 * Other APIs (기타, 사용자 요청): any service that speaks OpenAI's Chat Completions (OpenRouter,
 * DeepSeek, Groq, xAI, Mistral, Together, a local Ollama...). The player gives its address, a key
 * and a model; the OpenAI GM talks to it, leniently about structured output (see openaiGm.ts).
 * Every preset below answers browsers' CORS preflight (checked 2026-11), so the page can call it.
 */

export interface CompatiblePreset {
  id: string;
  name: string;
  /** The API's base address: `/chat/completions` goes after it. */
  baseUrl: string;
  /** Model ids to suggest (the field takes any). */
  models: string[];
  /** Where the key comes from, shown under the fields. */
  where: string;
  /** A server on this computer: no key needed. */
  local?: boolean;
}

export const COMPATIBLE_PRESETS: CompatiblePreset[] = [
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['openrouter/auto'], where: 'openrouter.ai의 Keys에서 발급합니다. 키 하나로 여러 회사의 모델을 고를 수 있고, 무료 모델(이름 끝이 :free)도 있습니다.' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'], where: 'platform.deepseek.com에서 발급합니다.' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: [], where: 'console.groq.com에서 발급합니다(무료 등급이 있습니다). 모델 이름은 Groq 문서의 목록에서 고르세요.' },
  { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', models: [], where: 'console.x.ai에서 발급합니다. 모델 이름은 xAI 문서의 목록에서 고르세요.' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-small-latest'], where: 'console.mistral.ai에서 발급합니다(무료 등급이 있습니다).' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', models: [], where: 'api.together.ai에서 발급합니다. 모델 이름은 Together 문서의 목록에서 고르세요.' },
  {
    id: 'ollama',
    name: 'Ollama (내 컴퓨터)',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    local: true,
    where: '키가 필요 없습니다. 이 사이트에서 부를 수 있게 Ollama를 OLLAMA_ORIGINS에 이 사이트 주소를 넣고 실행하세요. 모델 이름은 ollama list에 나오는 이름입니다.',
  },
];

/** The address as typed, cleaned: an http(s) URL without a trailing slash (http only for this computer), or null. */
export function cleanBaseUrl(text: string): string | null {
  const trimmed = text.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return trimmed;
  if (url.protocol === 'http:' && isLocalHost(url.hostname)) return trimmed;
  return null;
}

const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/** A server on this computer (no key needed). */
export function isLocalUrl(baseUrl: string): boolean {
  try {
    return isLocalHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

/** Where to POST: the address with `/chat/completions` (kept if it is already there). */
export function chatEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

/** The preset at this address, if any. */
export function presetFor(baseUrl: string): CompatiblePreset | undefined {
  const base = baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return COMPATIBLE_PRESETS.find((p) => p.baseUrl === base);
}

/** What to call the service: its preset's name, or the address's host. */
export function serviceName(baseUrl: string): string {
  const preset = presetFor(baseUrl);
  if (preset) return preset.name.replace(/ \(.*\)$/, '');
  try {
    return new URL(baseUrl).host;
  } catch {
    return '기타';
  }
}
