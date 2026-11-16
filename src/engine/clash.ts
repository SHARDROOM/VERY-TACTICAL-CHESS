import { SHIELD, type Piece, type PieceType } from './types';
import { hasTag, stackOf } from './tags';
import { DIE_SIDES } from './config';

/*
 * 합 (clash): when a piece tries to capture one that can stand its ground (it has a clash
 * multiplier, e.g. 검술 ×1.5, or a shield), both roll a d6 and multiply by their multiplier:
 * the base of their kind times their best tag's, rounded half up (사용자 요청). The higher wins,
 * a tie rolls again.
 * docs/SPEC.md, "합과 조형물".
 */

/**
 * Every kind's base clash multiplier, from its usual chess value (pawn 1, knight and bishop 3,
 * rook 5, queen 9) as 0.7 + 0.1 × value; the king, worth no points, fights like a knight.
 */
export const BASE_CLASH: Record<PieceType, number> = { pawn: 0.8, knight: 1, bishop: 1, rook: 1.2, queen: 1.6, king: 1 };

export const CLASH_MIN = 1.2;
export const CLASH_MAX = 2.0;
/** Rolls the authority sends with each move or attempt: enough for nine ties and a decision. */
export const CLASH_ROLLS = 20;

/** The best multiplier among one piece's own tags (1 if none). */
const tagMultiplier = (p: Piece): number => Math.max(1, ...(p.tags ?? []).map((t) => t.clash ?? 1));

/**
 * Its fighting skill: the best tag multiplier in its stack (it and everyone riding it; 1 if none). A
 * piece with skill wears a weapon of some kind, stands its ground and cuts down whom it beats.
 */
export function clashSkill(piece: Piece): number {
  return Math.max(...stackOf(piece).map(tagMultiplier));
}

/**
 * What its die is multiplied by in a clash: its kind's base times its best tag's multiplier
 * (in hundredths). With riders, whichever of the stack fights best.
 */
export function clashMultiplier(piece: Piece): number {
  const own = (p: Piece) => Math.round(BASE_CLASH[p.type] * tagMultiplier(p) * 100) / 100;
  return Math.max(...stackOf(piece).map(own));
}

/** It (or someone riding it) wears clash gear: a tag with a multiplier, even ×1 (an exile's hood). */
export const hasClashGear = (piece: Piece): boolean => stackOf(piece).some((p) => (p.tags ?? []).some((t) => t.clash !== undefined));

/** A capture of this piece becomes a clash: it (or its rider) wears clash gear, or it has a shield. */
export function canResist(defender: Piece): boolean {
  return hasClashGear(defender) || hasTag(defender, SHIELD);
}

/** How many times the two meet on screen: closer scores, longer fights; each tie adds one. */
export function exchangesFor(diff: number, ties: number): number {
  const base = diff >= 4 ? 1 : diff >= 3 ? 2 : diff >= 2 ? 3 : 4;
  return Math.min(6, base + ties);
}

/**
 * A side's score: its roll times its multiplier, rounded half up to a whole number (2.5 → 3). Taken
 * through hundredths first so float noise (1.15 × 2 = 2.2999…) never decides.
 */
export function clashScore(roll: number, mult: number): number {
  return Math.round(Math.round(roll * mult * 100) / 100);
}

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
    const sa = clashScore(a, attack);
    const sd = clashScore(d, defense);
    if (sa === sd) continue;
    return { rounds, winner: sa > sd ? 'attacker' : 'defender', exchanges: exchangesFor(Math.abs(sa - sd), rounds.length - 1) };
  }
  return { rounds, winner: 'defender', exchanges: exchangesFor(0, rounds.length) };
}

/** The attacker's exact chance of winning (ties roll again, so they do not count). */
export function clashWinChance(attack: number, defense: number): number {
  let win = 0;
  let lose = 0;
  for (let a = 1; a <= DIE_SIDES; a++) {
    for (let d = 1; d <= DIE_SIDES; d++) {
      const sa = clashScore(a, attack);
      const sd = clashScore(d, defense);
      if (sa > sd) win++;
      else if (sa < sd) lose++;
    }
  }
  return win / (win + lose);
}

/** How long a clash's duel lasts on screen, in seconds: camera in, the approach, each exchange, the decisive blow, camera out. */
export const DUEL_TIMING = { camera: 0.9, approach: 0.6, exchange: 0.75, finale: 1.3 } as const;

export function duelSeconds(exchanges: number): number {
  const t = DUEL_TIMING;
  return t.camera * 2 + t.approach + Math.max(0, exchanges - 1) * t.exchange + t.finale;
}
