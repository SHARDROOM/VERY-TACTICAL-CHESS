import type { Board, Element } from '../engine';
import { PIECE_HEIGHT } from './pieceGeometry';

/** A piece wrapped in its tag's element until the tag ends (docs/SPEC.md, "GM 연출": 오라). */
export interface AuraSpec {
  pieceId: string;
  element: Element;
  /** 1..3 */
  strength: number;
  /** How tall the piece is (as shown), so the aura wraps all of it. */
  height: number;
  /** Narrower for a piece riding on another. */
  radius: number;
}

const RIDER_SCALE = 0.62;

/** Every aura on the board: a tag's element around its piece, a rider's too. Squares never get one. */
export function aurasOn(board: Board): AuraSpec[] {
  const out: AuraSpec[] = [];
  for (const piece of board) {
    if (!piece) continue;
    for (const t of piece.tags ?? []) {
      if (t.aura) out.push({ pieceId: piece.id, element: t.aura.element, strength: t.aura.strength, height: PIECE_HEIGHT[piece.type], radius: 0.3 });
    }
    const rider = piece.rider;
    for (const t of rider?.tags ?? []) {
      if (rider && t.aura) {
        out.push({ pieceId: rider.id, element: t.aura.element, strength: t.aura.strength, height: PIECE_HEIGHT[rider.type] * RIDER_SCALE, radius: 0.2 });
      }
    }
  }
  return out;
}
