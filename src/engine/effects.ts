import { RIDE, type Board, type Color, type Effect, type GameEvent, type Piece, type PieceType, type Ruling, type Square } from './types';
import type { RuleConfig } from './config';
import { rankOf, squareName } from './squares';
import { isShielded, isStunned, withTag, withoutTag } from './tags';
import { SHIELD } from './types';

export interface EffectContext {
  /** Turn on which the effects happen (tags record it). */
  turnNumber: number;
  /** Next id number for spawned pieces. */
  nextSpawnId: number;
}

export type EffectResult =
  | { ok: true; board: Board; events: GameEvent[]; touched: Square[]; nextSpawnId: number }
  | { ok: false; detail: string };

const PIECE_TYPES: readonly PieceType[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const onBoard = (sq: unknown): sq is Square => isInt(sq) && sq >= 0 && sq < 64;
const isColor = (c: unknown): c is Color => c === 'white' || c === 'black';
const isPieceType = (t: unknown): t is PieceType => PIECE_TYPES.includes(t as PieceType);
const MAX_TAG_LENGTH = 20;
/** The rank a pawn of this colour promotes on. */
const lastRank = (color: Color) => (color === 'white' ? 7 : 0);
const pawnStuckAt = (sq: Square, color: Color) => rankOf(sq) === lastRank(color);

/** Events for a piece leaving the board for good: it, and anything riding it. */
function goneEvents(piece: Piece, at: Square): GameEvent[] {
  const events: GameEvent[] = [];
  if (piece.rider) events.push({ type: 'removed', piece: piece.rider, at });
  return events;
}

/**
 * Applies effects in order. Fails (without partial changes) if any effect is
 * impossible on the board as it stands at that point, or would remove a king:
 * a king can only ever be taken by a normal chess move.
 */
export function applyEffects(start: Board, effects: readonly Effect[], ctx: EffectContext): EffectResult {
  const board: (Piece | null)[] = [...start];
  const events: GameEvent[] = [];
  const touched: Square[] = [];
  let nextSpawnId = ctx.nextSpawnId;

  for (const [i, e] of effects.entries()) {
    const where = `효과 ${i + 1}`;
    const fail = (why: string): EffectResult => ({ ok: false, detail: `${where}: ${why}` });
    const pieceAt = (sq: unknown): Piece | null => (onBoard(sq) ? board[sq] : null);

    switch (e.type) {
      case 'move': {
        if (!onBoard(e.from) || !onBoard(e.to)) return fail('보드 밖의 칸');
        const piece = board[e.from];
        if (!piece) return fail(`${squareName(e.from)}에 기물이 없음`);
        if (isStunned(piece)) return fail(`${squareName(e.from)}의 기물은 기절해서 움직일 수 없음`);
        if (e.from === e.to) return fail('같은 칸으로 이동');
        const occupant = board[e.to];
        if (occupant?.color === piece.color) return fail(`${squareName(e.to)}에 같은 편 기물이 있음`);
        if (occupant?.type === 'king') return fail('특수 행동으로는 킹을 잡을 수 없음');
        if (occupant && isShielded(occupant)) {
          board[e.to] = withoutTag(occupant, SHIELD);
          touched.push(e.to);
          events.push({ type: 'shieldBroken', pieceId: occupant.id, at: e.to, attackerId: piece.id });
          break;
        }
        board[e.to] = piece;
        board[e.from] = null;
        touched.push(e.from, e.to);
        events.push({ type: 'moved', pieceId: piece.id, from: e.from, to: e.to, captured: occupant });
        if (occupant) events.push(...goneEvents(occupant, e.to));
        break;
      }
      case 'remove': {
        if (!onBoard(e.at)) return fail('보드 밖의 칸');
        const piece = board[e.at];
        if (!piece) return fail(`${squareName(e.at)}에 기물이 없음`);
        if (piece.type === 'king') return fail('특수 행동으로는 킹을 제거할 수 없음');
        if (isShielded(piece)) {
          board[e.at] = withoutTag(piece, SHIELD);
          touched.push(e.at);
          events.push({ type: 'shieldBroken', pieceId: piece.id, at: e.at, attackerId: null });
          break;
        }
        board[e.at] = null;
        touched.push(e.at);
        events.push({ type: 'removed', piece, at: e.at }, ...goneEvents(piece, e.at));
        break;
      }
      case 'tag': {
        const piece = pieceAt(e.at);
        if (!piece) return fail(onBoard(e.at) ? `${squareName(e.at)}에 기물이 없음` : '보드 밖의 칸');
        const name = typeof e.tag === 'string' ? e.tag.trim() : '';
        if (!name || name.length > MAX_TAG_LENGTH) return fail(`태그 이름은 1~${MAX_TAG_LENGTH}자여야 함`);
        if (name === RIDE) return fail('탑승은 tag가 아니라 board 효과로 표현해야 함');
        if (!isInt(e.turns) || e.turns < 0) return fail('지속 턴은 0(영구) 이상의 정수여야 함');
        const turnsLeft = e.turns === 0 ? null : e.turns;
        board[e.at as Square] = withTag(piece, { name, turnsLeft, appliedOnTurn: ctx.turnNumber });
        events.push({ type: 'tagged', pieceId: piece.id, at: e.at as Square, tag: name, turns: turnsLeft });
        break;
      }
      case 'untag': {
        const piece = pieceAt(e.at);
        if (!piece) return fail(onBoard(e.at) ? `${squareName(e.at)}에 기물이 없음` : '보드 밖의 칸');
        const name = typeof e.tag === 'string' ? e.tag.trim() : '';
        if (name === RIDE) return fail('탑승은 untag가 아니라 unboard 효과로 풀어야 함');
        // Removing a tag the piece does not have is a harmless no-op.
        if (!piece.tags?.some((t) => t.name === name)) break;
        board[e.at as Square] = withoutTag(piece, name);
        events.push({ type: 'untagged', pieceId: piece.id, at: e.at as Square, tag: name });
        break;
      }
      case 'board': {
        if (!onBoard(e.rider) || !onBoard(e.carrier)) return fail('보드 밖의 칸');
        const rider = board[e.rider];
        const carrier = board[e.carrier];
        if (!rider) return fail(`${squareName(e.rider)}에 탈 기물이 없음`);
        if (!carrier) return fail(`${squareName(e.carrier)}에 태울 기물이 없음`);
        if (e.rider === e.carrier) return fail('기물이 자기 자신에게 탈 수 없음');
        if (rider.color !== carrier.color) return fail('같은 편 기물에만 탈 수 있음');
        if (rider.type === 'king') return fail('킹은 다른 기물에 탈 수 없음');
        if (isStunned(rider)) return fail('기절한 기물은 움직일 수 없음');
        if (carrier.rider) return fail(`${squareName(e.carrier)}의 기물에는 이미 누군가 타고 있음`);
        if (rider.rider) return fail('누군가를 태운 기물은 다른 기물에 탈 수 없음');
        board[e.rider] = null;
        board[e.carrier] = { ...carrier, rider: withTag(rider, { name: RIDE, turnsLeft: null, appliedOnTurn: ctx.turnNumber }) };
        touched.push(e.rider, e.carrier);
        events.push({ type: 'boarded', riderId: rider.id, carrierId: carrier.id, from: e.rider, at: e.carrier });
        break;
      }
      case 'unboard': {
        if (!onBoard(e.at) || !onBoard(e.to)) return fail('보드 밖의 칸');
        const carrier = board[e.at];
        if (!carrier?.rider) return fail(`${squareName(e.at)}의 기물에는 타고 있는 기물이 없음`);
        if (board[e.to]) return fail(`내릴 칸 ${squareName(e.to)}이(가) 비어 있지 않음`);
        const rider = withoutTag(carrier.rider, RIDE);
        board[e.at] = { ...carrier, rider: undefined };
        board[e.to] = rider;
        touched.push(e.at, e.to);
        events.push({ type: 'unboarded', riderId: rider.id, from: e.at, to: e.to, captured: null });
        break;
      }
      case 'transform': {
        const piece = pieceAt(e.at);
        if (!piece) return fail(onBoard(e.at) ? `${squareName(e.at)}에 기물이 없음` : '보드 밖의 칸');
        if (piece.type === 'king') return fail('킹은 변환할 수 없음');
        if (!isPieceType(e.into) || e.into === 'king') return fail('킹이 아닌 기물 종류로만 변환할 수 있음');
        if (e.into === 'pawn' && pawnStuckAt(e.at as Square, piece.color)) return fail('마지막 줄에 있는 기물은 폰으로 바꿀 수 없음');
        board[e.at as Square] = { ...piece, type: e.into };
        touched.push(e.at as Square);
        events.push({ type: 'transformed', pieceId: piece.id, at: e.at as Square, from: piece.type, to: e.into });
        break;
      }
      case 'spawn': {
        if (!onBoard(e.at)) return fail('보드 밖의 칸');
        if (board[e.at]) return fail(`${squareName(e.at)}이(가) 비어 있지 않음`);
        if (!isColor(e.color)) return fail('기물 색이 올바르지 않음');
        if (!isPieceType(e.piece) || e.piece === 'king') return fail('킹은 만들 수 없음');
        if (e.piece === 'pawn' && pawnStuckAt(e.at, e.color)) return fail('폰은 그 편의 마지막 줄에 만들 수 없음');
        const piece: Piece = { id: `spawn-${nextSpawnId++}`, color: e.color, type: e.piece };
        board[e.at] = piece;
        touched.push(e.at);
        events.push({ type: 'spawned', piece, at: e.at });
        break;
      }
      default:
        return fail('알 수 없는 효과 종류');
    }
  }
  // A pawn carried to its last rank by an effect promotes, like after a normal move (always to a queen).
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (piece?.type !== 'pawn' || !pawnStuckAt(sq, piece.color)) continue;
    board[sq] = { ...piece, type: 'queen' };
    if (!touched.includes(sq)) touched.push(sq);
    events.push({ type: 'transformed', pieceId: piece.id, at: sq, from: 'pawn', to: 'queen' });
  }
  return { ok: true, board, events, touched, nextSpawnId };
}

/** Checks a ruling against the rules and dry-runs its effects. Returns a problem description, or null if valid. */
export function validateRuling(board: Board, ruling: Ruling, rules: RuleConfig, ctx: EffectContext): string | null {
  if (typeof ruling.interpretation !== 'string' || !Array.isArray(ruling.effects)) return '판정 형식이 올바르지 않음';
  if (!ruling.feasible) return null;
  if (!isInt(ruling.dc) || ruling.dc < rules.dcMin || ruling.dc > rules.dcMax) {
    return `DC ${ruling.dc}이(가) 허용 범위(${rules.dcMin}~${rules.dcMax})를 벗어남`;
  }
  if (!isInt(ruling.cost) || ruling.cost < rules.costMin || ruling.cost > rules.costMax) {
    return `AP 비용 ${ruling.cost}이(가) 허용 범위(${rules.costMin}~${rules.costMax})를 벗어남`;
  }
  const lists: [string, Effect[] | undefined][] = [
    ['', ruling.effects],
    ['대성공 ', ruling.critSuccessEffects],
    ['대실패 ', ruling.critFailureEffects],
  ];
  for (const [label, list] of lists) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) return `${label}효과 목록 형식이 올바르지 않음`;
    if (list.length > rules.maxEffects) return `${label}효과가 너무 많음 (최대 ${rules.maxEffects}개)`;
    const dry = applyEffects(board, list, ctx);
    if (!dry.ok) return label + dry.detail;
  }
  return null;
}
