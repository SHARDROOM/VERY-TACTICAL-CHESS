import type { Exit } from './staging';
import {
  BURN,
  GRAY,
  GUARD,
  HOSTAGE,
  LEVITATE,
  RIDE,
  TERRAIN_KINDS,
  TERRAIN_NAME,
  type Board,
  type CapturedPiece,
  type RemainsMark,
  type Color,
  type Effect,
  type FallingPiece,
  type GameEvent,
  type Piece,
  type PieceType,
  type Ruling,
  type Square,
  type TerrainCell,
  type TerrainKind,
} from './types';
import type { RuleConfig } from './config';
import { SQUARES, airOf, distance, isAir, playersOf, promotesOn, sameLayer, squareName } from './squares';
import { MAX_MOVE_TIMES, extinguish, isShielded, isStunned, mapStack, unseat, withRiderOnTop, withTag, withoutTag, withoutTopRider } from './tags';
import { SHIELD } from './types';
import { MAX_TERRAIN, dropFromBridges } from './terrain';
import { capturedAfter, remainsAt } from './captured';
import { checkActor } from './actor';
import { CLASH_MAX, CLASH_MIN, canResist, clashMultiplier, clashSkill, resolveClash } from './clash';
import { cleanProp } from './props';
import { MOD_EACH_MAX } from './modifiers';
import { intercept, saverFor } from './guard';
import { fused, split } from './fusion';
import { startFalls } from './levitation';

const COLOR_NAME: Record<Color, string> = { white: '백', black: '흑', red: '적', gray: '회색' };
const PIECE_NAME: Record<PieceType, string> = { king: '킹', queen: '퀸', rook: '룩', bishop: '비숍', knight: '나이트', pawn: '폰' };

export interface EffectContext {
  /** Turn on which the effects happen (tags record it). */
  turnNumber: number;
  /** Next id number for spawned pieces. */
  nextSpawnId: number;
  /** Whose turn it is: terrain made now lasts that side's turns. */
  color?: Color;
  /** Walls and pits before the effects. */
  terrain?: readonly TerrainCell[];
  /** Pieces beside the board before the effects (oldest first), for revive. */
  captured?: readonly CapturedPiece[];
  /** Where pieces fell lately (유해): a revive there brings back that very piece. */
  remains?: readonly RemainsMark[];
  /**
   * Whether a move effect into a piece that can stand its ground is a clash (special actions;
   * not chaos): 'check' while a ruling is only being checked (the attacker is taken to win, the
   * outcome nobody can know yet), or the dice to play it out with.
   */
  clash?: { mode: 'check' } | { mode: 'play'; rolls: readonly number[] };
  /** A chaos event: only it may bring a gray wanderer onto the board (or make anything gray). */
  chaos?: boolean;
  /** Most a skill or will a tag gets may be worth (raised by a sacrifice, see modifiers.ts). */
  modMax?: number;
  /** Strongest clash multiplier a tag may get (raised by a sacrifice). */
  clashMax?: number;
  /** The ruling's actor (a 인질 is held by it). */
  actor?: Square;
}

export type EffectResult =
  /**
   * `sources[i]`: which effect (0-based) produced `events[i]`; -1 for the promotions at the end.
   * `cut`: the effect where an attacker lost a clash; the ones after it never happened.
   */
  | {
      ok: true;
      board: Board;
      terrain: TerrainCell[];
      events: GameEvent[];
      sources: number[];
      touched: Square[];
      nextSpawnId: number;
      cut?: number;
      /** Floating pieces whose levitation was taken away: they fall next (see levitation.ts). */
      falling: FallingPiece[];
    }
  | { ok: false; detail: string; code?: 'clashRollsNeeded' };

const PIECE_TYPES: readonly PieceType[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const onBoard = (sq: unknown): sq is Square => isInt(sq) && sq >= 0 && sq < SQUARES;
/** Things that only happen on the ground (walls, pits, bridges, new pieces). */
const onGround = (sq: unknown): sq is Square => onBoard(sq) && !isAir(sq);
const AIR_ONLY_LEVITATE = '공중 칸에는 공중부양 중인 기물만 있을 수 있음: 땅의 기물에 공중부양 태그를 붙여 띄우세요';
const isColor = (c: unknown): c is Color => playersOf().includes(c as Color) || c === GRAY;
const isPieceType = (t: unknown): t is PieceType => PIECE_TYPES.includes(t as PieceType);
const isTerrainKind = (k: unknown): k is TerrainKind => TERRAIN_KINDS.includes(k as TerrainKind);
const MAX_TAG_LENGTH = 20;
/** The rank a pawn of this colour promotes on. */
const pawnStuckAt = (sq: Square, color: Color) => promotesOn(color, sq);

/**
 * Applies effects in order. Fails (without partial changes) if any effect is
 * impossible on the board as it stands at that point, or would remove a king:
 * a king can only ever be taken by a normal chess move.
 */
export function applyEffects(start: Board, effects: readonly Effect[], ctx: EffectContext): EffectResult {
  const board: (Piece | null)[] = [...start];
  let terrain: TerrainCell[] = [...(ctx.terrain ?? [])];
  const events: GameEvent[] = [];
  const touched: Square[] = [];
  let nextSpawnId = ctx.nextSpawnId;
  const terrainOn = (sq: Square) => terrain.find((c) => c.at === sq) ?? null;
  /** Clash dice used so far (they are used in order across the effects). */
  let rollAt = 0;
  let cut: number | undefined;
  const falling: FallingPiece[] = [];
  /** A piece leaving the board for good throws off whoever rides it (`push`: where the blow came from). */
  const throwOff = (carrier: Piece, at: Square, push?: Square) => falling.push(...unseat(carrier, at, events, push));

  const sources: number[] = [];
  for (const [i, e] of effects.entries()) {
    if (cut !== undefined) break;
    // Everything this effect adds to `events` came from it.
    while (sources.length < events.length) sources.push(i - 1);
    const where = `효과 ${i + 1}`;
    const fail = (why: string): EffectResult => ({ ok: false, detail: `${where}: ${why}` });
    const pieceAt = (sq: unknown): Piece | null => (onBoard(sq) ? board[sq] : null);
    /** Why a piece cannot land on `sq` because of a wall or pit there (a bridged pit is ground), or null. */
    const blockedLanding = (sq: Square): string | null => {
      const c = terrainOn(sq);
      if (!c || (c.kind === 'pit' && c.cover?.kind === 'bridge')) return null;
      return `${squareName(sq)}에 ${TERRAIN_NAME[c.kind]}이(가) 있음`;
    };

    switch (e.type) {
      case 'move': {
        if (!onBoard(e.from) || !onBoard(e.to)) return fail('보드 밖의 칸');
        const piece = board[e.from];
        if (!piece) return fail(`${squareName(e.from)}에 기물이 없음`);
        if (isStunned(piece)) return fail(`${squareName(e.from)}의 기물은 기절해서 움직일 수 없음`);
        if (e.from === e.to) return fail('같은 칸으로 이동');
        if (!sameLayer(e.from, e.to)) return fail('땅과 공중 사이는 move로 오갈 수 없음 (띄우려면 공중부양 태그, 내리려면 그 태그를 떼세요)');
        const ground = terrainOn(e.to);
        if (ground?.kind === 'wall') return fail(`${squareName(e.to)}에 벽이 있음`);
        if (ground?.kind === 'pit' && ground.cover?.kind !== 'bridge') {
          // Thrown into a pit: it falls in and is gone (a shield saves it, and it stays put).
          if (piece.type === 'king') return fail('킹은 구덩이에 빠뜨릴 수 없음');
          if (isShielded(piece)) {
            board[e.from] = withoutTag(piece, SHIELD);
            touched.push(e.from);
            events.push({ type: 'shieldBroken', pieceId: piece.id, at: e.from, attackerId: null });
            break;
          }
          board[e.from] = null;
          touched.push(e.from, e.to);
          events.push({ type: 'moved', pieceId: piece.id, from: e.from, to: e.to, captured: null });
          events.push({ type: 'removed', piece, at: e.to, cause: 'pit' });
          throwOff(piece, e.to);
          break;
        }
        const occupant = board[e.to];
        if (occupant?.color === piece.color) return fail(`${squareName(e.to)}에 같은 편 기물이 있음`);
        if (occupant?.type === 'king') return fail('특수 행동으로는 킹을 잡을 수 없음');
        let capturedExit: Exit | undefined;
        // In a special action (not chaos) a hostage or a 원호 friend goes down in the target's place (guard.ts).
        const saver = occupant && ctx.clash ? saverFor(board, e.to) : null;
        if (saver && ctx.clash) {
          const clashMode = ctx.clash;
          let short = false;
          const done = intercept(board, e.from, e.to, saver, events, (a, d) => {
            if (clashMode.mode === 'check') return 'attacker';
            const rolls = clashMode.rolls.slice(rollAt);
            if (rolls.length < 2) {
              short = true;
              return null;
            }
            const result = resolveClash(clashMultiplier(a), clashMultiplier(d), rolls);
            rollAt += result.rounds.length * 2;
            events.push({ type: 'clash', attackerId: a.id, defenderId: d.id, attacker: a.color, from: e.from, at: saver.at, attack: clashMultiplier(a), defense: clashMultiplier(d), rounds: result.rounds, winner: result.winner, shield: isShielded(d), exchanges: result.exchanges });
            return result.winner;
          });
          if (done === 'needRolls' || short) return { ok: false, detail: `${where}: 합 주사위가 없음`, code: 'clashRollsNeeded' };
          touched.push(e.from, saver.at);
          falling.push(...done.falls);
          if (done.attackerFell) {
            if (piece.type === 'king') events.push({ type: 'kingCaptured', winner: board[saver.at]?.color ?? occupant!.color, loser: piece.color });
            cut = i;
          }
          break;
        }
        if (occupant && ctx.clash && canResist(occupant)) {
          // A clash (합). While only checking a ruling the attacker is taken to win.
          const attack = clashMultiplier(piece);
          const defense = clashMultiplier(occupant);
          let winner: 'attacker' | 'defender' = 'attacker';
          if (ctx.clash.mode === 'play') {
            const rolls = ctx.clash.rolls.slice(rollAt);
            if (rolls.length < 2) return { ok: false, detail: `${where}: 합 주사위가 없음`, code: 'clashRollsNeeded' };
            const result = resolveClash(attack, defense, rolls);
            rollAt += result.rounds.length * 2;
            winner = result.winner;
            events.push({
              type: 'clash',
              attackerId: piece.id,
              defenderId: occupant.id,
              attacker: piece.color,
              from: e.from,
              at: e.to,
              attack,
              defense,
              rounds: result.rounds,
              winner,
              shield: isShielded(occupant),
              exchanges: result.exchanges,
            });
          }
          if (winner === 'defender') {
            // The attacker falls where it stood, and the rest of the action never happens.
            const exit: Exit | undefined = clashSkill(occupant) > 1 ? 'shatter' : undefined;
            board[e.from] = null;
            touched.push(e.from);
            events.push({ type: 'removed', piece, at: e.from, cause: 'clash', ...(exit && { exit }) });
            throwOff(piece, e.from, e.to);
            if (piece.type === 'king') events.push({ type: 'kingCaptured', winner: occupant.color, loser: piece.color });
            cut = i;
            break;
          }
          if (!isShielded(occupant)) capturedExit = clashSkill(piece) > 1 ? 'shatter' : undefined;
        }
        if (occupant && isShielded(occupant)) {
          board[e.to] = withoutTag(occupant, SHIELD);
          touched.push(e.to);
          events.push({ type: 'shieldBroken', pieceId: occupant.id, at: e.to, attackerId: piece.id });
          break;
        }
        board[e.from] = null;
        touched.push(e.from, e.to);
        events.push({ type: 'moved', pieceId: piece.id, from: e.from, to: e.to, captured: occupant, ...(capturedExit && { capturedExit }) });
        if (occupant) throwOff(occupant, e.to, e.from);
        board[e.to] = extinguish(piece, e.to, events);
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
        events.push({ type: 'removed', piece, at: e.at });
        throwOff(piece, e.at);
        break;
      }
      case 'tag': {
        const piece = pieceAt(e.at);
        if (!piece) return fail(onBoard(e.at) ? `${squareName(e.at)}에 기물이 없음` : '보드 밖의 칸');
        const name = typeof e.tag === 'string' ? e.tag.trim() : '';
        if (!name || name.length > MAX_TAG_LENGTH) return fail(`태그 이름은 1~${MAX_TAG_LENGTH}자여야 함`);
        if (name === RIDE) return fail('탑승은 tag가 아니라 board 효과로 표현해야 함');
        if (!isInt(e.turns) || e.turns < 0) return fail('지속 턴은 0(영구) 이상의 정수여야 함');
        if (name === BURN && piece.type === 'king') return fail('킹에는 화상을 입힐 수 없음');
        if ((name === GUARD || name === HOSTAGE) && piece.type === 'king') return fail(`킹에는 ${name}을(를) 붙일 수 없음`);
        // A hostage is held by the actor, next to it, of another side, and not a king.
        let holder: string | undefined;
        if (name === HOSTAGE) {
          const by = ctx.actor !== undefined ? board[ctx.actor] : null;
          if (!by || ctx.actor === undefined) return fail('인질은 행동하는 기물(주체)이 잡음: 주체가 있어야 함');
          if (by.color === piece.color) return fail('인질은 다른 편 기물만 잡을 수 있음');
          if (by.type === 'king') return fail('킹은 인질을 잡을 수 없음');
          if (distance(ctx.actor, e.at) > 1) return fail(`인질은 주체(${squareName(ctx.actor)}) 바로 옆(1칸)에 있어야 함`);
          holder = by.id;
        }
        if (name === BURN && e.turns === 0) return fail('화상은 1턴 이상이어야 함 (턴이 다하면 기물이 탄다)');
        const turnsLeft = e.turns === 0 ? null : e.turns;
        const clashMax = ctx.clashMax ?? CLASH_MAX;
        if (e.clash !== undefined && (typeof e.clash !== 'number' || !(e.clash >= CLASH_MIN && e.clash <= clashMax))) {
          return fail(`합 배율은 ×${CLASH_MIN}~×${clashMax}${clashMax === CLASH_MAX ? ' (희생이 있으면 ×2.5까지)' : ''}`);
        }
        const MOVE_KINDS: readonly PieceType[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
        if (e.moveAs !== undefined && (!Array.isArray(e.moveAs) || !e.moveAs.every((k) => MOVE_KINDS.includes(k)))) {
          return fail('moveAs는 기물 종류(king, queen, rook, bishop, knight, pawn)의 목록이어야 함');
        }
        if (e.moveTimes !== undefined && (!isInt(e.moveTimes) || e.moveTimes < 1 || e.moveTimes > MAX_MOVE_TIMES)) {
          return fail(`연속 이동 횟수는 1~${MAX_MOVE_TIMES}`);
        }
        const eachMax = ctx.modMax ?? MOD_EACH_MAX;
        if (e.skill !== undefined) {
          const { about, bonus } = e.skill;
          if (typeof about !== 'string' || !about.trim() || about.length > 30) return fail('특기(skill)의 about은 30자 이내의 설명이어야 함');
          if (!isInt(bonus) || bonus === 0 || Math.abs(bonus) > eachMax) return fail(`특기 보정은 ±1~${eachMax}의 정수`);
        }
        if (e.mind !== undefined && (!isInt(e.mind) || e.mind === 0 || Math.abs(e.mind) > eachMax)) return fail(`정신력은 ±1~${eachMax}의 정수`);
        // The kinds it moves like instead of itself (its own kind among them keeps its own moves too).
        const moveAs = [...new Set(e.moveAs ?? [])];
        const prop = e.prop ? cleanProp(e.prop) : null;
        // 공중부양 lifts a piece on the ground into the air above it (already floating: it lasts longer).
        let at = e.at as Square;
        if (name === LEVITATE && !isAir(at)) {
          const up = airOf(at);
          if (board[up]) return fail(`${squareName(up)}(${squareName(at)} 위 공중)에 이미 기물이 있음`);
          board[at] = null;
          board[up] = piece;
          touched.push(at);
          events.push({ type: 'lifted', pieceId: piece.id, from: at, to: up });
          at = up;
        }
        board[at] = withTag(piece, {
          name,
          turnsLeft,
          appliedOnTurn: ctx.turnNumber,
          ...(e.aura && { aura: e.aura }),
          ...(e.clash !== undefined && { clash: Math.round(e.clash * 10) / 10 }),
          ...(prop && { prop }),
          ...(moveAs.length > 0 && { moveAs }),
          ...(e.moveTimes !== undefined && e.moveTimes > 1 && { moveTimes: e.moveTimes }),
          ...(e.skill && { skill: { about: e.skill.about.trim(), bonus: e.skill.bonus } }),
          ...(e.mind && { mind: e.mind }),
          ...(holder && { holder }),
        });
        const moveTimes = e.moveTimes !== undefined && e.moveTimes > 1 ? e.moveTimes : undefined;
        events.push({ type: 'tagged', pieceId: piece.id, at, tag: name, turns: turnsLeft, ...(moveAs.length > 0 && { moveAs }), ...(moveTimes && { moveTimes }) });
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
        // Its levitation taken away, a floating piece falls (where it lands is played out later).
        if (name === LEVITATE) falling.push(...startFalls(board, events));
        break;
      }
      case 'board': {
        if (!onBoard(e.rider) || !onBoard(e.carrier)) return fail('보드 밖의 칸');
        const rider = board[e.rider];
        const carrier = board[e.carrier];
        if (!rider) return fail(`${squareName(e.rider)}에 탈 기물이 없음`);
        if (!carrier) return fail(`${squareName(e.carrier)}에 태울 기물이 없음`);
        if (e.rider === e.carrier) return fail('기물이 자기 자신에게 탈 수 없음');
        if (!sameLayer(e.rider, e.carrier)) return fail('땅과 공중의 기물끼리는 탈 수 없음');
        if (rider.color !== carrier.color) return fail('같은 편 기물에만 탈 수 있음');
        if (rider.type === 'king') return fail('킹은 다른 기물에 탈 수 없음');
        if (isStunned(rider)) return fail('기절한 기물은 움직일 수 없음');
        // No limit: it climbs on top of whoever rides the carrier already (with whoever rides it).
        board[e.rider] = null;
        touched.push(e.rider, e.carrier);
        events.push({ type: 'boarded', riderId: rider.id, carrierId: carrier.id, from: e.rider, at: e.carrier });
        const climbed = extinguish(rider, e.carrier, events);
        board[e.carrier] = withRiderOnTop(carrier, withTag(climbed, { name: RIDE, turnsLeft: null, appliedOnTurn: ctx.turnNumber }));
        break;
      }
      case 'unboard': {
        if (!onBoard(e.at) || !onBoard(e.to)) return fail('보드 밖의 칸');
        const carrier = board[e.at];
        if (!carrier?.rider) return fail(`${squareName(e.at)}의 기물에는 타고 있는 기물이 없음`);
        if (isAir(e.at) || isAir(e.to)) return fail('공중에서는 내릴 수 없음 (태운 기물이 땅에 있을 때만)');
        if (board[e.to]) return fail(`내릴 칸 ${squareName(e.to)}이(가) 비어 있지 않음`);
        const wall = blockedLanding(e.to);
        if (wall) return fail(wall);
        // The one on top gets off.
        const off = withoutTopRider(carrier)!;
        const rider = withoutTag(off.rider, RIDE);
        board[e.at] = off.carrier;
        touched.push(e.at, e.to);
        events.push({ type: 'unboarded', riderId: rider.id, from: e.at, to: e.to, captured: null });
        board[e.to] = extinguish(rider, e.to, events);
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
        if (onBoard(e.at) && isAir(e.at)) return fail(AIR_ONLY_LEVITATE);
        if (!onBoard(e.at)) return fail('보드 밖의 칸');
        if (board[e.at]) return fail(`${squareName(e.at)}이(가) 비어 있지 않음`);
        const blocked = blockedLanding(e.at);
        if (blocked) return fail(blocked);
        if (!isColor(e.color)) return fail('기물 색이 올바르지 않음');
        if (e.color === GRAY && !ctx.chaos) return fail('회색(떠돌이) 기물은 혼돈 사건만 데려올 수 있음');
        if (!isPieceType(e.piece) || e.piece === 'king') return fail('킹은 만들 수 없음');
        if (e.piece === 'pawn' && pawnStuckAt(e.at, e.color)) return fail('폰은 그 편의 마지막 줄에 만들 수 없음');
        const piece: Piece = { id: `spawn-${nextSpawnId++}`, color: e.color, type: e.piece };
        board[e.at] = piece;
        touched.push(e.at);
        events.push({ type: 'spawned', piece, at: e.at });
        break;
      }
      case 'convert': {
        const piece = pieceAt(e.at);
        if (!piece) return fail(onBoard(e.at) ? `${squareName(e.at)}에 기물이 없음` : '보드 밖의 칸');
        if (piece.type === 'king') return fail('킹은 편을 바꿀 수 없음');
        if (!isColor(e.color)) return fail('기물 색이 올바르지 않음');
        if (e.color === GRAY && !ctx.chaos) return fail('회색(떠돌이)으로 바꾸는 것은 혼돈 사건만 할 수 있음');
        if (piece.color === e.color) return fail(`${squareName(e.at)}의 기물은 이미 그 편임`);
        // Everyone riding it goes over too.
        board[e.at as Square] = mapStack(piece, (p) => ({ ...p, color: e.color }));
        touched.push(e.at as Square);
        events.push({ type: 'converted', pieceId: piece.id, at: e.at as Square, to: e.color });
        break;
      }
      case 'fuse': {
        // 융합: the body (the actor, if the ruling names one) takes in a piece next to it.
        if (!onBoard(e.body) || !onBoard(e.material)) return fail('보드 밖의 칸');
        const body = board[e.body];
        const material = board[e.material];
        if (!body) return fail(`${squareName(e.body)}에 기물이 없음`);
        if (!material) return fail(`${squareName(e.material)}에 기물이 없음`);
        if (e.body === e.material) return fail('자기 자신은 흡수할 수 없음');
        if (ctx.actor !== undefined && e.body !== ctx.actor) return fail(`몸이 되는 기물은 행동하는 기물(주체 ${squareName(ctx.actor)})이어야 함`);
        if (ctx.color && body.color !== ctx.color) return fail('몸이 되는 기물은 선언자 쪽 기물이어야 함');
        if (material.type === 'king') return fail('킹은 흡수할 수 없음');
        if (material.rider) return fail(`${squareName(e.material)}의 기물은 누군가를 태우고 있어 흡수할 수 없음`);
        if (distance(e.body, e.material) > 1) return fail('흡수할 기물은 몸이 되는 기물 바로 옆(1칸)에 있어야 함');
        const merged = fused(body, material);
        board[e.material] = null;
        board[e.body] = merged;
        touched.push(e.body, e.material);
        events.push({ type: 'fused', bodyId: body.id, materialId: material.id, body: e.body, material: e.material, base: merged.fuse!.base });
        break;
      }
      case 'split': {
        if (!onBoard(e.at) || !onBoard(e.to)) return fail('보드 밖의 칸');
        const body = board[e.at];
        if (!body?.fuse?.crowns.length) return fail(`${squareName(e.at)}의 기물은 융합한 기물이 아님`);
        if (board[e.to]) return fail(`${squareName(e.to)}이(가) 비어 있지 않음`);
        if (!sameLayer(e.at, e.to) || distance(e.at, e.to) > 1) return fail('떨어져 나온 기물은 바로 옆(1칸)의 빈 칸에 서야 함');
        const blocked = blockedLanding(e.to);
        if (blocked) return fail(blocked);
        const parted = split(body)!;
        if (parted.freed.type === 'pawn' && pawnStuckAt(e.to, parted.freed.color)) return fail('폰은 그 편의 마지막 줄에 설 수 없음');
        board[e.at] = parted.body;
        board[e.to] = parted.freed;
        touched.push(e.at, e.to);
        events.push({ type: 'split', bodyId: body.id, pieceId: parted.freed.id, from: e.at, to: e.to });
        break;
      }
      case 'swap': {
        if (!onBoard(e.a) || !onBoard(e.b)) return fail('보드 밖의 칸');
        const a = board[e.a];
        const b = board[e.b];
        if (!a) return fail(`${squareName(e.a)}에 기물이 없음`);
        if (!b) return fail(`${squareName(e.b)}에 기물이 없음`);
        if (e.a === e.b) return fail('같은 칸끼리는 맞바꿀 수 없음');
        if (!sameLayer(e.a, e.b)) return fail('땅과 공중의 기물끼리는 맞바꿀 수 없음');
        if (isStunned(a)) return fail(`${squareName(e.a)}의 기물은 기절해서 움직일 수 없음`);
        if (isStunned(b)) return fail(`${squareName(e.b)}의 기물은 기절해서 움직일 수 없음`);
        touched.push(e.a, e.b);
        events.push({ type: 'swapped', aId: a.id, bId: b.id, a: e.a, b: e.b });
        board[e.a] = extinguish(b, e.a, events);
        board[e.b] = extinguish(a, e.b, events);
        break;
      }
      case 'revive': {
        if (onBoard(e.at) && isAir(e.at)) return fail(AIR_ONLY_LEVITATE);
        if (!onBoard(e.at)) return fail('보드 밖의 칸');
        if (board[e.at]) return fail(`${squareName(e.at)}이(가) 비어 있지 않음`);
        const blocked = blockedLanding(e.at);
        if (blocked) return fail(blocked);
        if (!isColor(e.color)) return fail('기물 색이 올바르지 않음');
        if (!isPieceType(e.piece) || e.piece === 'king') return fail('킹은 되살릴 수 없음');
        if (e.piece === 'pawn' && pawnStuckAt(e.at, e.color)) return fail('폰은 그 편의 마지막 줄에 되살릴 수 없음');
        // Whoever lies beside the board right now: before the effects, plus anything taken by the earlier ones.
        const graveyard = capturedAfter(ctx.captured, events);
        // On its remains: that very piece, if it still lies beside the board. Otherwise the latest of its kind.
        const mark = remainsAt(ctx.remains, e.at);
        const kin = graveyard.filter((p) => p.color === e.color && p.type === e.piece);
        const found = (mark && kin.find((p) => p.id === mark.pieceId)) || kin.pop();
        if (!found) return fail(`잡힌 ${COLOR_NAME[e.color]} ${PIECE_NAME[e.piece]}이(가) 없음`);
        const piece: Piece = { id: found.id, color: found.color, type: found.type };
        board[e.at] = piece;
        touched.push(e.at);
        events.push({ type: 'revived', piece, at: e.at });
        break;
      }
      case 'terrain': {
        if (!onGround(e.at)) return fail(onBoard(e.at) ? '지형은 땅에만 만들 수 있음' : '보드 밖의 칸');
        if (!isTerrainKind(e.kind)) return fail('지형은 wall(벽)이나 pit(구덩이)만 됨');
        if (!isInt(e.turns) || e.turns < 0) return fail('지속 턴은 0(영구) 이상의 정수여야 함');
        const piece = board[e.at];
        if (piece && e.kind === 'wall') return fail(`벽은 빈 칸에만 세울 수 있음 (${squareName(e.at)}에 기물이 있음)`);
        if (!terrainOn(e.at) && terrain.length >= MAX_TERRAIN) return fail(`지형은 한꺼번에 최대 ${MAX_TERRAIN}칸`);
        if (piece) {
          // A pit opens under a piece: it falls in, unless a shield holds it up (then no pit).
          if (piece.type === 'king') return fail('킹 밑에는 구덩이를 팔 수 없음');
          if (isShielded(piece)) {
            board[e.at] = withoutTag(piece, SHIELD);
            touched.push(e.at);
            events.push({ type: 'shieldBroken', pieceId: piece.id, at: e.at, attackerId: null });
            break;
          }
          board[e.at] = null;
          touched.push(e.at);
          events.push({ type: 'removed', piece, at: e.at, cause: 'pit' });
          throwOff(piece, e.at);
        }
        const turnsLeft = e.turns === 0 ? null : e.turns;
        const look = e.prop ? cleanProp(e.prop) : null;
        terrain = [
          ...terrain.filter((c) => c.at !== e.at),
          { at: e.at, kind: e.kind, turnsLeft, owner: ctx.color ?? 'white', appliedOnTurn: ctx.turnNumber, ...(look && { prop: look }) },
        ];
        events.push({ type: 'terrainMade', at: e.at, kind: e.kind, turns: turnsLeft });
        break;
      }
      case 'cover': {
        if (!onGround(e.at)) return fail(onBoard(e.at) ? '다리와 사다리는 땅에만 놓을 수 있음' : '보드 밖의 칸');
        if (e.kind !== 'bridge' && e.kind !== 'ladder') return fail('덮개는 bridge(다리)나 ladder(사다리)만 됨');
        if (!isInt(e.turns) || e.turns < 0) return fail('지속 턴은 0(영구) 이상의 정수여야 함');
        const cell = terrainOn(e.at);
        const needs = e.kind === 'bridge' ? 'pit' : 'wall';
        if (cell?.kind !== needs) return fail(`${e.kind === 'bridge' ? '다리는 구덩이' : '사다리는 벽'} 위에만 놓을 수 있음 (${squareName(e.at)})`);
        const turnsLeft = e.turns === 0 ? null : e.turns;
        const look = e.prop ? cleanProp(e.prop) : null;
        const cover = { kind: e.kind, turnsLeft, owner: ctx.color ?? 'white', appliedOnTurn: ctx.turnNumber, ...(look && { prop: look }) };
        terrain = terrain.map((c) => (c.at === e.at ? { ...c, cover } : c));
        events.push({ type: 'coverMade', at: e.at, kind: e.kind, turns: turnsLeft });
        break;
      }
      case 'clearCover': {
        if (!onGround(e.at)) return fail(onBoard(e.at) ? '공중에는 다리나 사다리가 없음' : '보드 밖의 칸');
        const cell = terrainOn(e.at);
        // No bridge or ladder there: a harmless no-op.
        if (!cell?.cover) break;
        const { cover, ...bare } = cell;
        terrain = terrain.map((c) => (c.at === e.at ? bare : c));
        events.push({ type: 'coverGone', at: e.at, kind: cover.kind, expired: false });
        if (cover.kind === 'bridge') {
          // Whoever stood on the bridge falls in (a king is pushed aside).
          const dropped = dropFromBridges(board, [e.at], terrain);
          for (let sq = 0; sq < 64; sq++) board[sq] = dropped.board[sq];
          events.push(...dropped.events);
          falling.push(...dropped.falling);
          if (dropped.events.length) touched.push(e.at);
        }
        break;
      }
      case 'clearTerrain': {
        if (!onGround(e.at)) return fail(onBoard(e.at) ? '공중에는 지형이 없음' : '보드 밖의 칸');
        const cell = terrainOn(e.at);
        // Clearing a square with nothing on it is a harmless no-op.
        if (!cell) break;
        terrain = terrain.filter((c) => c.at !== e.at);
        events.push({ type: 'terrainCleared', at: e.at, kind: cell.kind, expired: false });
        break;
      }
      default:
        return fail('알 수 없는 효과 종류');
    }
  }
  while (sources.length < events.length) sources.push(cut ?? effects.length - 1);
  // A pawn carried to its last rank by an effect promotes, like after a normal move (always to a queen).
  for (let sq = 0; sq < SQUARES; sq++) {
    const piece = board[sq];
    if (piece?.type !== 'pawn' || !pawnStuckAt(sq, piece.color)) continue;
    board[sq] = { ...piece, type: 'queen' };
    if (!touched.includes(sq)) touched.push(sq);
    events.push({ type: 'transformed', pieceId: piece.id, at: sq, from: 'pawn', to: 'queen' });
    sources.push(-1);
  }
  return { ok: true, board, terrain, events, sources, touched, nextSpawnId, falling, ...(cut !== undefined && { cut }) };
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
    ['대실패 ', ruling.critFailureEffects],
  ];
  for (const [label, list] of lists) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) return `${label}효과 목록 형식이 올바르지 않음`;
    if (list.length > rules.maxEffects) return `${label}효과가 너무 많음 (최대 ${rules.maxEffects}개)`;
    const dry = applyEffects(board, list, ctx);
    if (!dry.ok) return label + dry.detail;
  }
  // Someone of the declarer's must do it, and a touch only reaches the next square.
  return checkActor(board, ruling, ctx.color ?? 'white', ctx);
}
