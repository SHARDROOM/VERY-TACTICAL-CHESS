import { SHIELD, type Piece } from './types';
import { hasTag } from './tags';

/*
 * 합 (clash): when a piece tries to capture one that can stand its ground (it has a clash
 * multiplier, e.g. 검술 ×1.5, or a shield), both roll a d20 and multiply by their best
 * multiplier; the higher wins, a tie rolls again. docs/SPEC.md, "합과 조형물".
 */

export const CLASH_MIN = 1.2;
export const CLASH_MAX = 2.0;
/** Rolls the authority sends with each move or attempt: enough for five ties and a decision. */
export const CLASH_ROLLS = 12;

/** The best multiplier among a piece's tags and its rider's (1 if none). */
export function clashMultiplier(piece: Piece): number {
  let best = 1;
  for (const p of [piece, piece.rider]) for (const t of p?.tags ?? []) if (t.clash && t.clash > best) best = t.clash;
  return best;
}

/** A capture of this piece becomes a clash: it (or its rider) has a multiplier, or it has a shield. */
export function canResist(defender: Piece): boolean {
  return clashMultiplier(defender) > 1 || hasTag(defender, SHIELD);
}

/** How many times the two meet on screen: closer scores, longer fights; each tie adds one. */
export function exchangesFor(diff: number, ties: number): number {
  const base = diff >= 10 ? 1 : diff >= 6 ? 2 : diff >= 3 ? 3 : 4;
  return Math.min(6, base + ties);
}

/** Scores compared in hundredths, so 1.5 × 9 and 13.5 are equal and float noise never decides. */
const score = (roll: number, mult: number) => Math.round(roll * mult * 100);

export interface ClashResult {
  rounds: { attack: number; defense: number }[];
  winner: 'attacker' | 'defender';
  exchanges: number;
}

/**
 * Plays out a clash from `rolls` (attacker, defender, attacker, defender, ...). If the rolls run
 * out on ties the defender holds (it never happens with CLASH_ROLLS but must end somewhere).
 */
export function resolveClash(attack: number, defense: number, rolls: readonly number[]): ClashResult {
  const rounds: ClashResult['rounds'] = [];
  for (let i = 0; i + 1 < rolls.length; i += 2) {
    const a = rolls[i];
    const d = rolls[i + 1];
    rounds.push({ attack: a, defense: d });
    const sa = score(a, attack);
    const sd = score(d, defense);
    if (sa === sd) continue;
    return { rounds, winner: sa > sd ? 'attacker' : 'defender', exchanges: exchangesFor(Math.abs(sa - sd) / 100, rounds.length - 1) };
  }
  return { rounds, winner: 'defender', exchanges: exchangesFor(0, rounds.length) };
}

/** The attacker's exact chance of winning (ties roll again, so they do not count). */
export function clashWinChance(attack: number, defense: number): number {
  let win = 0;
  let lose = 0;
  for (let a = 1; a <= 20; a++) {
    for (let d = 1; d <= 20; d++) {
      const sa = score(a, attack);
      const sd = score(d, defense);
      if (sa > sd) win++;
      else if (sa < sd) lose++;
    }
  }
  return win / (win + lose);
}
