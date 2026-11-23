import type { GmConfig } from './GmSettings';
import { CLAUDE_MODELS } from '../gm/claudeGm';
import { missingKey, serviceOf } from '../gm/createGm';

/** A GM as named in lists: its service and model ("Groq · llama-…"), and whether its key is missing. */
export function gmLabel(config: GmConfig): string {
  if (config.provider === 'fake') return '가짜 GM';
  const model = config.provider === 'claude' ? (CLAUDE_MODELS.find((m) => m.id === config.model)?.label ?? config.model) : config.model;
  return `${serviceOf(config)} · ${model}${missingKey(config) ? ' (키 없음)' : ''}`;
}

/** The same service and model (its key aside): a saved backup GM picked again is this one. */
export function sameModel(a: GmConfig, b: GmConfig): boolean {
  if (a.provider !== b.provider) return false;
  if (a.provider === 'fake' || b.provider === 'fake') return true;
  if (a.model !== b.model) return false;
  if (a.provider === 'compatible' && b.provider === 'compatible') return a.baseUrl === b.baseUrl;
  if (a.provider === 'claude' && b.provider === 'claude') return a.effort === b.effort;
  return true;
}
