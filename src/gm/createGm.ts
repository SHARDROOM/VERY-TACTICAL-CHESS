import type { GmConfig } from '../ui/GmSettings';
import type { GameMaster } from './types';
import { ClaudeGameMaster } from './claudeGm';
import { OpenAiGameMaster } from './openaiGm';
import { GeminiGameMaster } from './geminiGm';
import { FakeGameMaster } from './fakeGm';
import { MissingKeyGameMaster } from './missingKeyGm';
import { chatEndpoint, isLocalUrl, serviceName } from './compatible';
import { FailoverGameMaster, MAX_BACKUPS } from './failover';

/** A GM's service as named in notices ("Gemini", "Groq"). */
export function serviceOf(config: GmConfig): string {
  if (config.provider === 'compatible') return serviceName(config.baseUrl);
  return { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', fake: '가짜 GM' }[config.provider];
}

/**
 * The GM with its backups (예비 GM, failover.ts): blocked, the next is asked. `labels` name them in
 * the notices (by default: the main one's service, then "예비 1 · Groq"...). No backup: the GM itself.
 */
export function createGmChain(main: GmConfig, backups: readonly GmConfig[] = [], labels?: string[]): GameMaster {
  // (The settings keep at most MAX_BACKUPS; an AI's own model puts the GM before them.)
  const list = [main, ...backups.slice(0, MAX_BACKUPS + 1)];
  if (list.length === 1) return createGm(main);
  return new FailoverGameMaster(list.map((c, i) => ({ gm: createGm(c), label: labels?.[i] ?? (i === 0 ? serviceOf(c) : `예비 ${i} ${serviceOf(c)}`) })));
}

/** The config has no key where one is needed (another service on this computer needs none). */
export function missingKey(config: GmConfig): boolean {
  if (config.provider === 'fake') return false;
  if (config.provider === 'compatible' && isLocalUrl(config.baseUrl)) return false;
  return !config.apiKey;
}

export function createGm(config: GmConfig): GameMaster {
  if (missingKey(config)) return new MissingKeyGameMaster(config.provider === 'compatible' ? `${serviceName(config.baseUrl)} GM` : PROVIDER_LABEL[config.provider]);
  switch (config.provider) {
    case 'claude':
      return new ClaudeGameMaster({ apiKey: config.apiKey, model: config.model, effort: config.effort });
    case 'openai':
      return new OpenAiGameMaster({ apiKey: config.apiKey, model: config.model });
    case 'gemini':
      return new GeminiGameMaster({ apiKey: config.apiKey, model: config.model });
    case 'compatible':
      return new OpenAiGameMaster({ apiKey: config.apiKey, model: config.model, endpoint: chatEndpoint(config.baseUrl), label: serviceName(config.baseUrl), lenient: true });
    case 'fake':
      return new FakeGameMaster();
  }
}

export const PROVIDER_LABEL: Record<GmConfig['provider'], string> = {
  claude: 'Claude GM',
  openai: 'OpenAI GM',
  gemini: 'Gemini GM',
  compatible: '기타 GM',
  fake: '가짜 GM',
};
