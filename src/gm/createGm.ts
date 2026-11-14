import type { GmConfig } from '../ui/GmSettings';
import type { GameMaster } from './types';
import { ClaudeGameMaster } from './claudeGm';
import { OpenAiGameMaster } from './openaiGm';
import { GeminiGameMaster } from './geminiGm';
import { FakeGameMaster } from './fakeGm';

export function createGm(config: GmConfig): GameMaster {
  switch (config.provider) {
    case 'claude':
      return new ClaudeGameMaster({ apiKey: config.apiKey, model: config.model, effort: config.effort });
    case 'openai':
      return new OpenAiGameMaster({ apiKey: config.apiKey, model: config.model });
    case 'gemini':
      return new GeminiGameMaster({ apiKey: config.apiKey, model: config.model });
    case 'fake':
      return new FakeGameMaster();
  }
}

export const PROVIDER_LABEL: Record<GmConfig['provider'], string> = {
  claude: 'Claude GM',
  openai: 'OpenAI GM',
  gemini: 'Gemini GM',
  fake: '가짜 GM',
};
