import type { GmConfig } from './GmSettings';
import { CLAUDE_MODELS } from '../gm/claudeGm';
import { missingKey, serviceOf } from '../gm/createGm';

/** A GM as named in lists: its service and model ("Groq · llama-…"), and whether its key is missing. */
export function gmLabel(config: GmConfig): string {
  if (config.provider === 'fake') return '가짜 GM';
  const model = config.provider === 'claude' ? (CLAUDE_MODELS.find((m) => m.id === config.model)?.label ?? config.model) : config.model;
  return `${serviceOf(config)} · ${model}${missingKey(config) ? ' (키 없음)' : ''}`;
}
