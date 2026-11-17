import { canResist, clashSkill } from './clash';
import { distance } from './squares';
import { hasTag, isShielded, isStunned, unseat, withoutTag } from './tags';
import { GUARD, HOSTAGE, SHIELD, type Board, type FallingPiece, type GameEvent, type Piece, type Square } from './types';
import type { Exit } from './staging';

/*
 * Going down in another's place (docs/SPEC.md, "원호와 인질"):
 * - 원호 (guard): a piece about to be taken by a capture (a normal move, a 행동대장's move, or a move
 *   effect onto it) is saved by a friend with this tag next to it, who throws itself at the attacker
 *   and is taken instead. Kings are not guarded.
 * - 인질 (hostage): a piece holding a hostage next to it hides behind it: the hostage dies instead.
 * Either way the attacker stays where it was. A saver that can stand its ground (clash gear, a
 * shield) fights the attacker in a clash instead. Ranged removals, burns and chaos are not stopped.
 */

/** Who goes down in the place of the piece on `victimSq`, if anyone: its hostage first, else a guard. */
export function saverFor(board: Board, victimSq: Square): { at: Square; kind: 'guard' | 'hostage' } | null {
  const victim = board[victimSq];
  if (!victim) return null;
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (p && sq !== victimSq && p.tags?.some((t) => t.name === HOSTAGE && t.holder === victim.id) && distance(sq, victimSq) <= 1) return { at: sq, kind: 'hostage' };
  }
  if (victim.type === 'king') return null;
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (p && sq !== victimSq && p.color === victim.color && hasTag(p, GUARD) && !isStunned(p) && distance(sq, victimSq) <= 1) return { at: sq, kind: 'guard' };
  }
  return null;
}

/**
 * The saver on `saver.at` goes down for the piece on `victimSq` attacked from `attackerSq` (the board
 * and events are changed in place). If it can stand its ground, `fight` plays the clash and says
 * who won (null: the dice are missing). Returns whether the attacker fell, and anyone thrown off.
 */
export function intercept(
  board: (Piece | null)[],
  attackerSq: Square,
  victimSq: Square,
  saver: { at: Square; kind: 'guard' | 'hostage' },
  events: GameEvent[],
  fight: (attacker: Piece, defender: Piece) => 'attacker' | 'defender' | null,
): { attackerFell: boolean; falls: FallingPiece[] } | 'needRolls' {
  const attacker = board[attackerSq]!;
  const victim = board[victimSq]!;
  const s = board[saver.at]!;
  events.push({ type: 'intercepted', kind: saver.kind, saverId: s.id, savedId: victim.id, attackerId: attacker.id, from: saver.at, at: victimSq, by: attackerSq });
  if (canResist(s)) {
    const winner = fight(attacker, s);
    if (winner === null) return 'needRolls';
    if (winner === 'defender') {
      // The attacker is cut down where it stood.
      board[attackerSq] = null;
      const exit: Exit | undefined = clashSkill(s) > 1 ? 'shatter' : undefined;
      events.push({ type: 'removed', piece: attacker, at: attackerSq, cause: 'clash', ...(exit && { exit }) });
      return { attackerFell: true, falls: unseat(attacker, attackerSq, events, saver.at) };
    }
    if (isShielded(s)) {
      board[saver.at] = withoutTag(s, SHIELD);
      events.push({ type: 'shieldBroken', pieceId: s.id, at: saver.at, attackerId: attacker.id });
      return { attackerFell: false, falls: [] };
    }
  }
  board[saver.at] = null;
  events.push({ type: 'removed', piece: s, at: saver.at, cause: saver.kind });
  return { attackerFell: false, falls: unseat(s, saver.at, events, attackerSq) };
}

/**
 * Hostages whose holder is gone or no longer next to them are let go (the tag comes off). Run after
 * every change to the board.
 */
export function releaseHostages(board: (Piece | null)[], events: GameEvent[]): void {
  const where = new Map<string, Square>();
  board.forEach((p, sq) => p && where.set(p.id, sq));
  board.forEach((p, sq) => {
    const held = p?.tags?.find((t) => t.name === HOSTAGE);
    if (!p || !held) return;
    const holderAt = held.holder ? where.get(held.holder) : undefined;
    if (holderAt !== undefined && distance(holderAt, sq) <= 1) return;
    board[sq] = withoutTag(p, HOSTAGE);
    events.push({ type: 'untagged', pieceId: p.id, at: sq, tag: HOSTAGE });
  });
}
