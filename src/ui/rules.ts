import type { RuleConfig } from '../engine';
import { CHAOS_CHANCES } from '../session/types';

export function secondsLabel(s: number): string {
  if (!s) return '없음';
  return s % 60 === 0 ? `${s / 60}분` : `${s}초`;
}

export function chaosLabel(chance: number): string {
  return CHAOS_CHANCES.find((c) => c.value === chance)?.label ?? `${Math.round(chance * 100)}%`;
}

/** The room's rules in a few short lines, for anyone who cannot change them. */
export function rulesSummary(rules: RuleConfig): string[] {
  return [
    `수 제한시간: ${secondsLabel(rules.turnSeconds)}${rules.turnSeconds ? ` (초과 시 AP ${rules.timeoutPenalty} 차감, 턴 넘어감)` : ''}`,
    `턴마다 받는 AP: ${rules.apPerTurn} (최대 ${rules.apMax})`,
    `혼돈: ${chaosLabel(rules.chaosChance)}`,
    `낙서 모드: ${rules.doodle ? '켬' : '끔'}`,
  ];
}

/** "1:05", "0:09". */
export function clockText(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
