import { SACRIFICE_MOD_MAX, checkSacrifice, modifierTotal, pendingModifiers, sacrificeClashBonus, sacrificeModifiers } from './modifiers';
import { noteTakes } from './highlights';
import { SCENARIOS, scenarioEffects } from './scenario';
import {
  PROMOTION_TYPES,
  type Board,
  type Color,
  type Command,
  type ChaosEvent,
  type CommandResult,
  type GameEvent,
  type GameState,
  type MoveSpecial,
  type Outcome,
  type Piece,
  type Precedent,
  type Square,
  type TerrainCell,
} from './types';
import type { Exit, Staging } from './staging';
import { enPassantVictim, isInCheck, legalTargets, movesFrom } from './moves';
import { backRank, setBoardMap, isAir, isHex, pawnForward, pawnStart, playersOf, promotesOn, step } from './squares';
import { revokeCastling } from './castling';
import { DIE_SIDES, ROLL_MAX, ROLL_MIN } from './config';
import { applyEffects, checkBuildings, validateRuling, type EffectContext } from './effects';
import { extinguish, hasTag, isShielded, mapStack, moveTimesOf, ridersOf, stackOf, tickTags, unseat, withTag, withoutTag } from './tags';
import { GRAY, HOOD, HOSTAGE, SHIELD, type Ruling, type Tag } from './types';
import { checkActor } from './actor';
import { intercept, releaseHostages, saverFor } from './guard';
import { commandable, impulseKindOf, impulsesDue, impulseTargets } from './vanguard';
import { dropFromBridges, tickTerrain } from './terrain';
import { capturedAfter, remainsAfter, tickRemains } from './captured';
import { playFalls, startFalls } from './levitation';
import { canResist, clashMultiplier, clashSkill, resolveClash } from './clash';

/** What effects applied now start from: the turn, whose it is, the walls and pits, the side of the board. */
function effectContext(state: GameState, nextSpawnId = state.nextSpawnId): EffectContext {
  return { turnNumber: state.turnNumber, nextSpawnId, color: state.turn, terrain: state.terrain ?? [], captured: state.captured ?? [], remains: state.remains ?? [] };
}

/**
 * A ruling's effects: with a sacrifice they may hand out stronger buffs (see modifiers.ts); the
 * actor and how it acts (a hostage, an instant kill that becomes a clash). Also how a show replays them.
 */
export function rulingContext(state: GameState, ruling: Ruling, nextSpawnId = state.nextSpawnId): EffectContext {
  const offered = !!ruling.sacrifice?.length;
  // An offering for a clash multiplier raises it by what it is worth (the pieces may be gone already: a second try).
  const offering = state.pending?.ruling === ruling && state.pending.offered ? state.pending.offered : offered ? sacrificeModifiers(state.board, ruling, state.turn) : [];
  const clashBonus = sacrificeClashBonus(offering);
  return {
    ...effectContext(state, nextSpawnId),
    ...(offered && { modMax: SACRIFICE_MOD_MAX }),
    ...(clashBonus > 0 && { clashBonus }),
    ...(ruling.actor != null && { actor: ruling.actor }),
    ...(ruling.means && { means: ruling.means }),
  };
}

/** The board once the ruling's sacrifices are gone (the effects happen on it). */
function withoutSacrifices(board: Board, ruling: Ruling): Board {
  if (!ruling.sacrifice?.length) return board;
  const b = [...board];
  for (const at of ruling.sacrifice) b[at] = null;
  return b;
}

/** The single entry point for changing game state. Pure: no I/O, no randomness. */
export function applyCommand(state: GameState, cmd: Command): CommandResult {
  // The impulses due at a turn's end are played right after it; anything else ends that moment.
  if (state.impulseDue && cmd.type !== 'impulse') {
    const { impulseDue: _due, ...rest } = state;
    void _due;
    state = rest;
  }
  // Who took what is counted for the game's highlights (명장면).
  return noteTakes(state, withHostagesLetGo(promoteStranded(applyOne(state, cmd))));
}

/** A hostage whose holder is gone or moved away is let go, whatever moved it. */
function withHostagesLetGo(result: CommandResult): CommandResult {
  if (!result.ok || !result.state.board.some((p) => p?.tags?.some((t) => t.name === HOSTAGE))) return result;
  const board = [...result.state.board];
  const released: GameEvent[] = [];
  releaseHostages(board, released);
  return released.length ? { ...result, state: { ...result.state, board }, events: [...result.events, ...released] } : result;
}

/**
 * A pawn that has come to stand on its last rank promotes there, to a queen, whatever brought it:
 * a fall (off a toppled carrier, at the end of its levitation), ... (a normal move asks which piece,
 * and effects promote their own). A new queen may give check.
 */
function promoteStranded(result: CommandResult): CommandResult {
  if (!result.ok) return result;
  const { board, terrain } = result.state;
  let next: (Piece | null)[] | null = null;
  const events: GameEvent[] = [];
  board.forEach((p, sq) => {
    if (p?.type !== 'pawn' || isAir(sq) || !promotesOn(p.color, sq)) return;
    next ??= [...board];
    next[sq] = { ...p, type: 'queen' };
    events.push({ type: 'transformed', pieceId: p.id, at: sq, from: 'pawn', to: 'queen' });
  });
  if (!next) return result;
  const promoted: Board = next;
  for (const c of playersOf()) {
    if (!result.events.some((e) => e.type === 'check' && e.color === c) && isInCheck(promoted, c, terrain)) events.push({ type: 'check', color: c });
  }
  return { ...result, state: { ...result.state, board: promoted }, events: [...result.events, ...events] };
}

function applyOne(state: GameState, cmd: Command): CommandResult {
  // Every square helper follows the board this game is played on.
  setBoardMap(state.map);
  if (state.status.kind !== 'playing') return { ok: false, reason: 'gameOver' };
  // A piece in mid-fall comes down before anything else happens.
  if (state.falling?.length && cmd.type !== 'land') return { ok: false, reason: 'landingPending' };
  if (cmd.type === 'land') return land(state, cmd);
  // A player whose king fell picks the piece it keeps before anything else happens.
  if (cmd.type === 'exile') return exile(state, cmd.at);
  if (state.surrender) return { ok: false, reason: 'surrenderPending' };
  // Giving up and an agreed draw may come at any moment (판 끝내기).
  if (cmd.type === 'resign') return resign(state, cmd.color);
  if (cmd.type === 'draw') return { ok: true, state: { ...state, pending: null, status: { kind: 'draw', reason: 'agreed' } }, events: [{ type: 'drawn', reason: 'agreed' }] };
  // Running out of time cancels whatever was pending, so it may come at any moment.
  if (cmd.type === 'timeout') return timeOut(state);
  const actionCommand = cmd.type === 'attemptSpecial' || cmd.type === 'cancelSpecial';
  if (state.pending && !actionCommand) return { ok: false, reason: 'actionPending' };
  if (!state.pending && actionCommand) return { ok: false, reason: 'noPendingAction' };

  // Moving several times in a row: only that piece moves, until the moves run out or the turn is ended.
  if (state.chain && (cmd.type === 'proposeSpecial' || cmd.type === 'chaos')) return { ok: false, reason: 'chainInProgress' };

  switch (cmd.type) {
    case 'move':
      return applyMove(state, cmd);
    case 'endTurn':
      // Stopping a run of moves early: the en passant chance its last move opened still stands.
      if (state.chain) return { ok: true, ...passTurn(state, state.board, state.enPassant, []) };
      // Passing is for a turn spent on special actions. Doing nothing at all is not a turn,
      // unless there is no normal move to make (e.g. every piece is stunned or blocked).
      if (!state.usedApThisTurn && hasAnyMove(state)) return { ok: false, reason: 'nothingDoneThisTurn' };
      return { ok: true, ...passTurn(state, state.board, null, []) };
    case 'proposeSpecial':
      return propose(state, cmd);
    case 'attemptSpecial':
      return attempt(state, cmd.roll, cmd.clashRolls, cmd.dice);
    case 'cancelSpecial': {
      const { color, action, retry } = state.pending!;
      return { ok: true, state: { ...state, pending: null }, events: [{ type: 'specialCancelled', color, action, ...(retry && { afterFailure: true }) }] };
    }
    case 'chaos':
      return chaos(state, cmd.chaos);
    case 'wander':
      return wander(state, cmd.moves);
    case 'impulse':
      return impulse(state, cmd);
  }
}

/**
 * A 혼란 or 행동대장 piece moves of its own accord at the end of its owner's turn (see vanguard.ts):
 * nobody's turn changes. A 행동대장 may capture (a clash, a guard or a hostage as for any capture).
 */
function impulse(state: GameState, cmd: Extract<Command, { type: 'impulse' }>): CommandResult {
  const piece = Number.isInteger(cmd.from) ? state.board[cmd.from] : null;
  // Ordered by a 행동대장 next to it (or by itself): one of the pieces that 행동대장 may order.
  const by = cmd.by ?? cmd.from;
  const ordered = by !== cmd.from;
  if (ordered && (!Number.isInteger(by) || !commandable(state, by).includes(cmd.from) || cmd.to === null)) return { ok: false, reason: 'illegalMove' };
  const kind = !piece ? null : ordered ? 'vanguard' : impulseKindOf(state, cmd.from);
  if (!piece || !kind) return { ok: false, reason: 'illegalMove' };
  if (cmd.to === null) {
    if (kind !== 'vanguard') return { ok: false, reason: 'illegalMove' };
    return { ok: true, state, events: [{ type: 'impulse', pieceId: piece.id, kind, from: cmd.from, to: null }] };
  }
  // The leader may order itself only where it may go of its own accord (a king never goes).
  if (!ordered && kind === 'vanguard' && !commandable(state, cmd.from).includes(cmd.from)) return { ok: false, reason: 'illegalMove' };
  if (!impulseTargets(state, cmd.from, kind).includes(cmd.to)) return { ok: false, reason: 'illegalMove' };
  const board: (Piece | null)[] = [...state.board];
  const events: GameEvent[] = [{ type: 'impulse', pieceId: piece.id, kind, from: cmd.from, to: cmd.to, ...(ordered && { by: state.board[by]!.id }) }];
  const victim = board[cmd.to];
  const done = (falls: GameState['falling'], touched: Square[]): CommandResult => {
    for (const c of playersOf()) if (isInCheck(board, c, state.terrain)) events.push({ type: 'check', color: c });
    return { ok: true, state: withCaptured({ ...state, board, castling: revokeCastling(state.castling, touched), ...withFalls(state, falls) }, events), events };
  };
  if (victim) {
    const saver = saverFor(board, cmd.to);
    if (saver) {
      const r = intercept(board, cmd.from, cmd.to, saver, events, (a, d) => {
        if (!cmd.clashRolls?.length) return null;
        const clash = clashEventFor(a, d, cmd.from, saver.at, cmd.clashRolls);
        events.push(clash);
        return clash.winner;
      });
      if (r === 'needRolls') return { ok: false, reason: 'clashRollsNeeded' };
      return done(r.falls, [cmd.from, saver.at]);
    }
    if (canResist(victim)) {
      if (!cmd.clashRolls?.length) return { ok: false, reason: 'clashRollsNeeded' };
      const clash = clashEventFor(piece, victim, cmd.from, cmd.to, cmd.clashRolls);
      events.push(clash);
      if (clash.winner === 'defender') {
        board[cmd.from] = null;
        const exit: Exit | undefined = clashSkill(victim) > 1 ? 'shatter' : undefined;
        events.push({ type: 'removed', piece, at: cmd.from, cause: 'clash', ...(exit && { exit }) });
        return done(unseat(piece, cmd.from, events, cmd.to), [cmd.from]);
      }
      if (isShielded(victim)) {
        board[cmd.to] = withoutTag(victim, SHIELD);
        events.push({ type: 'shieldBroken', pieceId: victim.id, at: cmd.to, attackerId: piece.id });
        return done([], []);
      }
    } else if (isShielded(victim)) {
      board[cmd.to] = withoutTag(victim, SHIELD);
      events.push({ type: 'shieldBroken', pieceId: victim.id, at: cmd.to, attackerId: piece.id });
      return done([], []);
    }
  }
  // A pawn that reaches the far side becomes a queen (no one is asked).
  const promotes = piece.type === 'pawn' && !isAir(cmd.to) && promotesOn(piece.color, cmd.to);
  const fireOut: GameEvent[] = [];
  board[cmd.to] = extinguish(promotes ? { ...piece, type: 'queen' } : piece, cmd.to, fireOut);
  board[cmd.from] = null;
  events.push({ type: 'moved', pieceId: piece.id, from: cmd.from, to: cmd.to, captured: victim, ...(promotes && { special: { kind: 'promotion' as const, to: 'queen' as const } }) });
  const falls = victim ? unseat(victim, cmd.to, events, cmd.from) : [];
  events.push(...fireOut);
  return done(falls, [cmd.from, cmd.to]);
}

/** The falling pieces come down (see levitation.ts); a piece that lands may open or close a check. */
function land(state: GameState, cmd: Extract<Command, { type: 'land' }>): CommandResult {
  const falling = state.falling ?? [];
  if (!falling.length) return { ok: false, reason: 'nothingFalling' };
  const seed = Number.isInteger(cmd.seed) ? cmd.seed : 0;
  const played = playFalls(state.board, state.terrain, falling, Array.isArray(cmd.landings) ? cmd.landings : [], seed, state.turnNumber);
  const events = [...played.events];
  for (const c of playersOf()) if (isInCheck(played.board, c, state.terrain)) events.push({ type: 'check', color: c });
  const { falling: _done, ...rest } = state;
  void _done;
  return { ok: true, state: withCaptured({ ...rest, board: played.board }, events), events };
}

/** Pieces that started to fall join any already falling. */
const withFalls = (state: GameState, falls: GameState['falling']): Pick<GameState, 'falling'> =>
  state.falling?.length || falls?.length ? { falling: [...(state.falling ?? []), ...(falls ?? [])] } : {};

function timeOut(state: GameState): CommandResult {
  const color = state.turn;
  const apLost = Math.min(state.ap[color], Math.max(0, state.rules.timeoutPenalty));
  const events: GameEvent[] = [];
  if (state.pending) events.push({ type: 'specialCancelled', color: state.pending.color, action: state.pending.action });
  events.push({ type: 'timedOut', color, apLost });
  const after: GameState = { ...state, pending: null, ap: { ...state.ap, [color]: state.ap[color] - apLost } };
  return { ok: true, ...passTurn(after, after.board, null, events) };
}

/**
 * A chaos event: applied as it stands, with no AP and no dice. It may not leave either
 * king attacked, so chaos can never hand anyone a free king capture or a forced loss.
 */
function chaos(state: GameState, event: ChaosEvent): CommandResult {
  const bad = (detail: string): CommandResult => ({ ok: false, reason: 'invalidChaos', detail });
  if (typeof event?.title !== 'string' || typeof event.narration !== 'string' || !Array.isArray(event.effects)) return bad('형식이 올바르지 않음');
  if (event.effects.length > state.rules.maxEffects) return bad(`효과가 너무 많음 (최대 ${state.rules.maxEffects}개)`);
  const applied = applyEffects(state.board, event.effects, { ...effectContext(state), chaos: true });
  if (!applied.ok) return bad(applied.detail);
  if (playersOf().some((c) => isInCheck(applied.board, c, applied.terrain))) return bad('혼돈 뒤에 킹이 공격받는 상태가 됨');
  const title = event.title.trim().slice(0, 40);
  const narration = event.narration.trim().slice(0, 300);
  const events: GameEvent[] = [
    { type: 'chaos', title, narration, effects: event.effects, ...(event.staging && { staging: event.staging }) },
    ...applied.events,
  ];
  const after = withCaptured(
    {
      ...state,
      board: applied.board,
      terrain: applied.terrain,
      nextSpawnId: applied.nextSpawnId,
      castling: revokeCastling(state.castling, applied.touched),
      chaosLog: [...(state.chaosLog ?? []), { turnNumber: state.turnNumber, title, narration }],
      ...withFalls(state, applied.falling),
    },
    events,
    exitsOf(applied.events, applied.sources, event.staging),
  );
  return { ok: true, state: after, events };
}

/** True if the side to move has at least one normal move. */
export function hasAnyMove(state: GameState): boolean {
  return state.board.some((p, sq) => p?.color === state.turn && legalTargets(state, sq).length > 0);
}

/**
 * How each piece taken by these effect events left, as staged: the exit of the effect that
 * took it (a rider goes the way its carrier went). Knocked off (the plain way) is not recorded.
 */
export function exitsOf(events: GameEvent[], sources: number[], staging: Staging | undefined): Map<string, Exit> {
  const exits = new Map<string, Exit>();
  if (!staging) return exits;
  events.forEach((e, i) => {
    const piece = e.type === 'moved' ? e.captured : e.type === 'removed' ? e.piece : null;
    const exit = staging.beats.find((b) => b.effect === sources[i])?.exit;
    // A piece falls into a pit on the spot: only the exits played in place fit (otherwise it sinks).
    const inPit = e.type === 'removed' && e.cause === 'pit';
    if (inPit && exit && !['ash', 'shatter', 'vanish', 'sink'].includes(exit)) return;
    // An attacker that lost a clash goes the way the clash says, not the way its victim was staged to.
    if (e.type === 'removed' && e.cause === 'clash') return;
    if (piece && exit && exit !== 'default' && exit !== 'knock') exits.set(piece.id, exit);
  });
  return exits;
}

/** Records the pieces that left the board in these events (with how they left) and those that came back. */
function withCaptured(state: GameState, events: GameEvent[], exits?: Map<string, Exit>): GameState {
  return events.some((e) => e.type === 'moved' || e.type === 'removed' || e.type === 'revived')
    ? { ...state, captured: capturedAfter(state.captured, events, exits), remains: remainsAfter(state.remains, events, state.turnNumber) }
    : state;
}

/**
 * A king fell: `loser`'s, to `winner` (the piece on `killerAt` struck it). On the classic board the
 * game is over. On the hexagon an exile that takes a king becomes a king again; the game ends
 * when one king is left; otherwise the loser surrenders, and picks the one piece it keeps (if it
 * has any left). `board` is changed in place; the events are added to `events`.
 */
function kingFell(board: (Piece | null)[], loser: Color, winner: Color, killerAt: Square | null, events: GameEvent[]): Partial<Pick<GameState, 'status' | 'surrender'>> {
  if (!isHex()) {
    events.push({ type: 'kingCaptured', winner, loser });
    return { status: { kind: 'won', winner } };
  }
  const killer = killerAt === null ? null : board[killerAt];
  if (killer && killerAt !== null && killer.color === winner && hasTag(killer, HOOD)) {
    board[killerAt] = { ...withoutTag(killer, HOOD), type: 'king' };
    events.push({ type: 'crowned', pieceId: killer.id, at: killerAt, color: winner });
  }
  const kings = [...new Set(board.flatMap((p) => (p ? stackOf(p) : [])).filter((p) => p.type === 'king').map((p) => p.color))];
  if (kings.length <= 1) {
    const last = kings[0] ?? winner;
    events.push({ type: 'kingCaptured', winner: last, loser });
    return { status: { kind: 'won', winner: last } };
  }
  const keepsOne = board.some((p) => p && stackOf(p).some((q) => q.color === loser));
  events.push({ type: 'surrendered', loser, to: winner, keepsOne });
  return keepsOne ? { surrender: { loser, to: winner } } : {};
}

/** An exile's hood (see HOOD): ×1 clash gear, worn for good. */
export function hoodTag(turnNumber: number): Tag {
  return {
    name: HOOD,
    turnsLeft: null,
    appliedOnTurn: turnNumber,
    clash: 1,
    prop: {
      preset: null,
      attach: 'head',
      scale: 1,
      parts: [
        { shape: 'cone', material: 'cloth', position: [0, -0.06, -0.01], size: [0.4, 0.44, 0.4], rotation: [-8, 0, 0], color: '#6e5d47' },
        { shape: 'box', material: 'cloth', position: [0.09, -0.12, 0.13], size: [0.1, 0.09, 0.02], rotation: [0, 0, 18], color: '#8f7b5c' },
        { shape: 'torus', material: 'rope', position: [0, -0.24, 0], size: [0.38, 0.05, 0.38], rotation: [0, 0, 0] },
      ],
    },
  };
}

/** The surrendering player keeps the piece on `at` (in exile, under a hood); all its others now serve the winner. */
function exile(state: GameState, at: Square): CommandResult {
  const s = state.surrender;
  if (!s) return { ok: false, reason: 'noSurrender' };
  const kept = Number.isInteger(at) ? state.board[at] : null;
  if (!kept || kept.color !== s.loser) return { ok: false, reason: 'notExiledPiece' };
  const turned = (p: Piece) => (p.color === s.loser ? { ...p, color: s.to } : p);
  const board = state.board.map((p, sq) => (p && sq !== at ? mapStack(p, turned) : p));
  board[at] = withTag(kept, hoodTag(state.turnNumber));
  const events: GameEvent[] = [{ type: 'exiled', loser: s.loser, to: s.to, piece: kept, at }];
  for (const c of playersOf()) if (isInCheck(board, c, state.terrain)) events.push({ type: 'check', color: c });
  const { surrender: _done, ...rest } = state;
  void _done;
  return { ok: true, state: { ...rest, board }, events };
}

/** The moves a gray wanderer on `from` may make: its own moves, never onto a king or a piece that would stand its ground. */
export function wanderTargets(board: Board, from: Square, terrain?: readonly TerrainCell[]): Square[] {
  const piece = board[from];
  if (piece?.color !== GRAY) return [];
  return movesFrom(board, from, terrain).filter((to) => {
    const there = board[to];
    return !there || (there.type !== 'king' && !canResist(there));
  });
}

/**
 * Chaos's gray wanderers move of their own accord (docs/SPEC.md, "떠돌이"): each move in turn, as
 * given (picked at random by whoever runs the game), taking whatever it lands on. They never take
 * a king or a piece that would stand its ground, and nobody's turn changes.
 */
function wander(state: GameState, moves: { from: Square; to: Square }[]): CommandResult {
  if (!Array.isArray(moves)) return { ok: false, reason: 'illegalWander' };
  const board: (Piece | null)[] = [...state.board];
  const events: GameEvent[] = [];
  const touched: Square[] = [];
  let falls: GameState['falling'] = [];
  for (const m of moves) {
    if (!m || !Number.isInteger(m.from) || !Number.isInteger(m.to) || !wanderTargets(board, m.from, state.terrain).includes(m.to)) {
      return { ok: false, reason: 'illegalWander' };
    }
    const piece = board[m.from]!;
    const captured = board[m.to];
    const fireOut: GameEvent[] = [];
    board[m.to] = extinguish(piece, m.to, fireOut);
    board[m.from] = null;
    touched.push(m.from, m.to);
    events.push({ type: 'wandered', pieceId: piece.id, from: m.from, to: m.to });
    events.push({ type: 'moved', pieceId: piece.id, from: m.from, to: m.to, captured });
    // Whoever rode what it took tumbles off.
    if (captured) falls = [...(falls ?? []), ...unseat(captured, m.to, events, m.from)];
    events.push(...fireOut);
  }
  for (const c of playersOf()) if (isInCheck(board, c, state.terrain)) events.push({ type: 'check', color: c });
  const after = withCaptured({ ...state, board, castling: revokeCastling(state.castling, touched), ...withFalls(state, falls) }, events);
  return { ok: true, state: after, events };
}

/** Only kings left (gray wanderers aside) for this many turns: a draw (판 끝내기; specials may still call pieces back meanwhile). */
export const KINGS_ONLY_DRAW_TURNS = 10;

/** Every side has only its king left (riders too), gray wanderers aside. */
function kingsOnly(board: Board): boolean {
  return board.every((p) => !p || stackOf(p).every((q) => q.color === GRAY || q.type === 'king'));
}

/**
 * `color` gives up (기권, 사용자 요청). On the classic board the other side wins. On the hexagon its
 * king leaves the board and every other piece of its turns into a gray wanderer; the last king left
 * wins, otherwise the others play on (the turn passing on if it was its own).
 */
function resign(state: GameState, color: Color): CommandResult {
  const inGame = playersOf().includes(color) && state.board.some((p) => p && stackOf(p).some((q) => q.color === color));
  if (!inGame) return { ok: false, reason: 'notInGame' };
  if (!isHex()) {
    const winner = playersOf().find((c) => c !== color)!;
    return { ok: true, state: { ...state, pending: null, status: { kind: 'won', winner, by: 'resign' } }, events: [{ type: 'resigned', color, winner }] };
  }
  const wander = (p: Piece): Piece => (p.color === color ? { ...p, color: GRAY } : p);
  const board = state.board.map((p) => (!p ? p : p.color === color && p.type === 'king' ? null : mapStack(p, wander)));
  const kings = [...new Set(board.flatMap((p) => (p ? stackOf(p) : [])).filter((p) => p.type === 'king').map((p) => p.color))];
  if (kings.length <= 1) {
    const winner = kings[0] ?? playersOf().find((c) => c !== color)!;
    return { ok: true, state: { ...state, board, pending: null, status: { kind: 'won', winner, by: 'resign' } }, events: [{ type: 'resigned', color, winner }] };
  }
  const events: GameEvent[] = [{ type: 'resigned', color, winner: null }];
  const after: GameState = { ...state, board, ...(state.turn === color && { pending: null, chain: undefined }) };
  if (state.turn !== color) return { ok: true, state: after, events };
  const passed = passTurn(after, board, null, events);
  return { ok: true, state: passed.state, events: passed.events };
}

/** Who moves after the player now to move: the next in turn order who still has pieces. */
function nextPlayer(state: GameState, board: Board): Color {
  const all = playersOf();
  const i = all.indexOf(state.turn);
  for (let k = 1; k <= all.length; k++) {
    const c = all[(i + k) % all.length];
    if (board.some((p) => p?.color === c)) return c;
  }
  return all[(i + 1) % all.length];
}

/** Ends the current player's turn: the opponent moves next and gains AP. */
function passTurn(
  state: GameState,
  board: Board,
  enPassant: Square | null,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  // Tags of the player whose turn is ending count down here.
  const next = nextPlayer(state, board);
  const { apMax, apPerTurn } = state.rules;
  const apNext = Math.min(apMax, state.ap[next] + apPerTurn);
  const turnNumber = state.turnNumber + 1;
  // Who moves of their own accord now: taken before the tags count down (a 1-turn 혼란 lasted through this turn).
  const due = impulsesDue(board, state.turn);
  const tagged = tickTags(board, state.turn, state.turnNumber);
  const remains = tickRemains(state.remains, state.turn, state.turnNumber);
  const land = tickTerrain(state.terrain, state.turn, state.turnNumber);
  // A bridge that ran out drops whoever stands on it.
  const dropped = dropFromBridges(tagged.board, land.fallen, land.terrain);
  // A levitation that ran out: the piece falls (played by the `land` command that follows).
  const fallEvents: GameEvent[] = [];
  // ...and so does whoever rode a piece that burnt up or went down with its bridge.
  const falls = [...tagged.falling, ...dropped.falling, ...startFalls(dropped.board, fallEvents)];
  const ticked = { board: dropped.board, events: [...tagged.events, ...dropped.events] };
  events = [...events, ...tagged.events, ...land.events, ...dropped.events, ...fallEvents];
  // A piece burnt up or a wall gone may open a line onto a king.
  if (ticked.events.some((e) => e.type === 'removed' || e.type === 'pushed') || land.events.length) {
    for (const c of playersOf()) if (isInCheck(ticked.board, c, land.terrain)) events.push({ type: 'check', color: c });
  }
  // Older remains fade first; pieces burnt up just now leave fresh ones.
  const { chain: _chain, ...rest } = withCaptured({ ...state, remains }, ticked.events);
  void _chain;
  return {
    state: {
      ...rest,
      board: ticked.board,
      terrain: land.terrain,
      turn: next,
      turnNumber,
      enPassant,
      ap: { ...state.ap, [next]: apNext },
      usedApThisTurn: false,
      pending: null,
      ...withFalls(state, falls),
      ...(due.length && { impulseDue: due }),
      ...kingsOnlyCount(state, ticked.board, turnNumber),
    },
    events: [
      ...events,
      { type: 'turnPassed', turn: next, turnNumber, apGained: apNext - state.ap[next], ended: state.turn },
      ...(kingsOnlyCount(state, ticked.board, turnNumber).status ? [{ type: 'drawn' as const, reason: 'kingsOnly' as const }] : []),
    ],
  };
}

/** After a turn: how long only kings have been left, and the draw once it has been KINGS_ONLY_DRAW_TURNS turns. */
function kingsOnlyCount(state: GameState, board: Board, turnNumber: number): Pick<GameState, 'kingsOnlySince'> & { status?: GameState['status'] } {
  if (!kingsOnly(board)) return { kingsOnlySince: undefined };
  // The turn just played counts as the first.
  const since = state.kingsOnlySince ?? state.turnNumber;
  return { kingsOnlySince: since, ...(turnNumber - since >= KINGS_ONLY_DRAW_TURNS && { status: { kind: 'draw', reason: 'kingsOnly' } }) };
}

function checkEvents(board: Board, mover: Color, terrain: readonly TerrainCell[] | undefined): GameEvent[] {
  const events: GameEvent[] = [];
  if (isInCheck(board, mover, terrain)) events.push({ type: 'ownKingExposed', color: mover });
  for (const c of playersOf()) if (c !== mover && isInCheck(board, c, terrain)) events.push({ type: 'check', color: c });
  return events;
}

function applyMove(state: GameState, cmd: Extract<Command, { type: 'move' }>): CommandResult {
  const piece = state.board[cmd.from];
  if (!piece) return { ok: false, reason: 'noPiece' };
  if (piece.color !== state.turn) return { ok: false, reason: 'notYourPiece' };
  if (state.chain && cmd.from !== state.chain.at) return { ok: false, reason: 'notChainedPiece' };
  const target = legalTargets(state, cmd.from).find((t) => t.to === cmd.to);
  if (!target) return { ok: false, reason: 'illegalMove' };
  // One-turn-kill guard: after any special-action attempt this turn, kings are off limits.
  if (state.usedApThisTurn && state.board[cmd.to]?.type === 'king') return { ok: false, reason: 'kingProtectedThisTurn' };

  const promotes = piece.type === 'pawn' && !isAir(cmd.to) && promotesOn(piece.color, cmd.to);
  if (promotes && !cmd.promotion) return { ok: false, reason: 'promotionRequired' };
  if (cmd.promotion && (!promotes || !PROMOTION_TYPES.includes(cmd.promotion))) {
    return { ok: false, reason: 'invalidPromotion' };
  }

  const board: (Piece | null)[] = [...state.board];
  const victimSquare =
    target.special?.kind === 'enPassant' ? enPassantVictim(cmd.from, cmd.to) : cmd.to;
  const victim = board[victimSquare];

  // Capturing a piece that can stand its ground (a clash multiplier or a shield) is a clash (합).
  const opening: GameEvent[] = [];
  // Someone goes down in its place: its hostage, or a 원호 friend next to it (see guard.ts).
  const saver = victim && victim.color !== piece.color ? saverFor(board, victimSquare) : null;
  if (victim && saver) {
    const done = intercept(board, cmd.from, victimSquare, saver, opening, (a, d) => {
      if (!cmd.clashRolls?.length) return null;
      const clash = clashEventFor(a, d, cmd.from, saver.at, cmd.clashRolls);
      opening.push(clash);
      return clash.winner;
    });
    if (done === 'needRolls') return { ok: false, reason: 'clashRollsNeeded' };
    const events = [...opening];
    const after = withCaptured({ ...state, castling: revokeCastling(state.castling, [cmd.from, saver.at]), ...withFalls(state, done.falls) }, events);
    if (done.attackerFell && piece.type === 'king') {
      const fell = kingFell(board, piece.color, victim.color, saver.at, events);
      if (fell.status) return { ok: true, state: { ...after, board, ...fell }, events };
      events.push(...checkEvents(board, piece.color, state.terrain));
      return { ok: true, ...passTurn({ ...after, ...fell }, board, null, events) };
    }
    events.push(...checkEvents(board, piece.color, state.terrain));
    return { ok: true, ...passTurn(after, board, null, events) };
  }
  let capturedExit: Exit | undefined;
  if (victim && canResist(victim)) {
    if (!cmd.clashRolls?.length) return { ok: false, reason: 'clashRollsNeeded' };
    const clash = clashEventFor(piece, victim, cmd.from, victimSquare, cmd.clashRolls);
    opening.push(clash);
    if (clash.winner === 'defender') {
      // The attacker falls on its own square (with whoever rides it); cut down by a fighter, knocked off otherwise.
      board[cmd.from] = null;
      const exit: Exit | undefined = clashSkill(victim) > 1 ? 'shatter' : undefined;
      const events: GameEvent[] = [...opening, { type: 'removed', piece, at: cmd.from, cause: 'clash', ...(exit && { exit }) }];
      // Its rider is thrown off, away from the blow.
      const falls = unseat(piece, cmd.from, events, cmd.to);
      const after = withCaptured({ ...state, castling: revokeCastling(state.castling, [cmd.from]), ...withFalls(state, falls) }, events);
      if (piece.type === 'king') {
        const fell = kingFell(board, piece.color, victim.color, victimSquare, events);
        if (fell.status) return { ok: true, state: { ...after, board, ...fell }, events };
        events.push(...checkEvents(board, piece.color, state.terrain));
        return { ok: true, ...passTurn({ ...after, ...fell }, board, null, events) };
      }
      events.push(...checkEvents(board, piece.color, state.terrain));
      return { ok: true, ...passTurn(after, board, null, events) };
    }
    // Lost by the defender: a shield breaks instead (the attacker goes back to its square), or it is cut down.
    if (!isShielded(victim)) capturedExit = clashSkill(piece) > 1 ? 'shatter' : undefined;
  }

  // A shield absorbs the capture: it breaks, the target stays, the attacker does not move,
  // and the move still uses up the turn.
  if (victim && isShielded(victim)) {
    board[victimSquare] = withoutTag(victim, SHIELD);
    const events: GameEvent[] = [...opening, { type: 'shieldBroken', pieceId: victim.id, at: victimSquare, attackerId: piece.id }];
    events.push(...checkEvents(board, piece.color, state.terrain));
    return { ok: true, ...passTurn(state, board, null, events) };
  }

  const captured = victim;
  let special: MoveSpecial | undefined = target.special;
  const touched = [cmd.from, cmd.to];

  // Moving off its square puts out a 화상 (the events go after the move's own).
  const fireOut: GameEvent[] = [];
  board[cmd.to] = extinguish(promotes ? { ...piece, type: cmd.promotion! } : piece, cmd.to, fireOut);
  board[cmd.from] = null;
  if (promotes) special = { kind: 'promotion', to: cmd.promotion! };

  if (target.special?.kind === 'enPassant') {
    board[victimSquare] = null;
    touched.push(victimSquare);
  }

  if (target.special?.kind === 'castle') {
    const c = piece.color;
    const [rookFrom, rookTo] = target.special.side === 'king' ? [backRank(c, 7), backRank(c, 5)] : [backRank(c, 0), backRank(c, 3)];
    board[rookTo] = extinguish(board[rookFrom]!, rookTo, fireOut);
    board[rookFrom] = null;
    touched.push(rookFrom, rookTo);
  }

  const events: GameEvent[] = [
    ...opening,
    { type: 'moved', pieceId: piece.id, from: cmd.from, to: cmd.to, captured, ...(special && { special }), ...(capturedExit && { capturedExit }) },
  ];
  // Whoever rode the captured piece is thrown off it, away from the attacker (a king's fall ends the game anyway).
  // On the hexagon the game goes on after a king falls, so its riders tumble off like anyone's.
  const falls = captured && (captured.type !== 'king' || isHex()) ? unseat(captured, victimSquare, events, cmd.from) : [];
  if (captured?.type === 'king' && !isHex()) for (const r of ridersOf(captured)) events.push({ type: 'removed', piece: r, at: victimSquare });
  events.push(...fireOut);

  let surrender: Pick<GameState, 'surrender'> = {};
  if (captured?.type === 'king') {
    const fell = kingFell(board, captured.color, piece.color, cmd.to, events);
    if (fell.status) return { ok: true, state: withCaptured({ ...state, board, ...fell }, events), events };
    surrender = fell;
  }

  // A pawn's double step from its first rank (not a pawn that slid two squares like a rook elsewhere).
  const skipped = piece.type === 'pawn' && pawnStart(piece.color, cmd.from) ? step(cmd.from, { df: 0, dr: pawnForward(piece.color, cmd.from) })[0] : undefined;
  const doubleStep = skipped !== undefined && step(skipped.sq, skipped.dir)[0]?.sq === cmd.to;
  const enPassant = doubleStep ? skipped.sq : null;

  events.push(...checkEvents(board, piece.color, state.terrain));
  const withRights = withCaptured({ ...state, castling: revokeCastling(state.castling, touched), ...withFalls(state, falls), ...surrender }, events);

  // A piece that moves several times in a row (moveTimes) goes again, unless it gave check
  // (the opponent always gets to answer a check) or has nowhere left to go.
  const left = (state.chain ? state.chain.left : moveTimesOf(board[cmd.to]!)) - 1;
  if (left > 0 && !events.some((e) => e.type === 'check' || e.type === 'surrendered')) {
    const chain = { pieceId: piece.id, at: cmd.to, left };
    const next: GameState = { ...withRights, board, enPassant, chain };
    if (legalTargets(next, cmd.to).length) {
      return { ok: true, state: next, events: [...events, { type: 'moveAgain', pieceId: piece.id, at: cmd.to, left }] };
    }
  }
  return { ok: true, ...passTurn(withRights, board, enPassant, events) };
}

/** The clash between `attacker` (from `from`) and `defender` (on `at`), played out with these rolls. */
export function clashEventFor(attacker: Piece, defender: Piece, from: Square, at: Square, rolls: readonly number[]): Extract<GameEvent, { type: 'clash' }> {
  const attack = clashMultiplier(attacker);
  const defense = clashMultiplier(defender);
  const result = resolveClash(attack, defense, rolls);
  return {
    type: 'clash',
    attackerId: attacker.id,
    defenderId: defender.id,
    attacker: attacker.color,
    defender: defender.color,
    from,
    at,
    attack,
    defense,
    rounds: result.rounds,
    winner: result.winner,
    shield: isShielded(defender),
    exchanges: result.exchanges,
  };
}

function propose(state: GameState, cmd: Extract<Command, { type: 'proposeSpecial' }>): CommandResult {
  const action = cmd.action.trim();
  if (!action) return { ok: false, reason: 'emptyAction' };
  if (action.length > state.rules.actionMaxLength) return { ok: false, reason: 'actionTooLong' };
  const offering = cmd.ruling.feasible ? checkSacrifice(state.board, cmd.ruling, state.turn) : null;
  if (offering) return { ok: false, reason: 'invalidRuling', detail: offering };
  // The effects happen after the sacrifice, on the board without the pieces given up. The actor is checked on the board as it is.
  const problem =
    validateRuling(withoutSacrifices(state.board, cmd.ruling), { ...cmd.ruling, actor: undefined }, state.rules, { ...rulingContext(state, cmd.ruling), clash: { mode: 'check' } }) ??
    checkActor(state.board, cmd.ruling, state.turn, effectContext(state)) ??
    checkBuildings(cmd.ruling, state.terrain);
  if (problem) return { ok: false, reason: 'invalidRuling', detail: problem };

  const pending = { color: state.turn, action, ruling: cmd.ruling };
  return {
    ok: true,
    state: { ...state, pending },
    events: [{ type: 'specialProposed', ...pending }],
  };
}

function attempt(state: GameState, roll: number, clashRolls: readonly number[] = [], dice?: [number, number]): CommandResult {
  const { color, action, ruling, retry, offered } = state.pending!;
  if (!ruling.feasible) return { ok: false, reason: 'notFeasible' };
  // A second try after a failure costs the reroll price, not the action's.
  const cost = retry ? state.rules.rerollCost : ruling.cost;
  const reroll = retry ? retry.rerolls + 1 : 0;
  if (state.ap[color] < cost) return { ok: false, reason: 'notEnoughAp' };
  if (!Number.isInteger(roll) || roll < ROLL_MIN || roll > ROLL_MAX) return { ok: false, reason: 'invalidRoll' };
  const face = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= DIE_SIDES;
  if (dice && (!Array.isArray(dice) || dice.length !== 2 || !dice.every(face) || dice[0] + dice[1] !== roll)) return { ok: false, reason: 'invalidRoll' };

  // Two dice added up, plus what the actor's skills and the target's will add (modifiers.ts).
  // Snake eyes (1 and 1) always fails, and backfires, whatever the DC and the modifiers;
  // otherwise the DC decides (there is no critical success).
  const mods = pendingModifiers(state.board, state.pending!, state.remains, state.terrain);
  const bonus = modifierTotal(mods);
  const outcome: Outcome = roll === ROLL_MIN ? 'critFailure' : roll + bonus >= ruling.dc ? 'success' : 'failure';
  const success = outcome === 'success';
  let toApply = outcome === 'success' ? ruling.effects : outcome === 'critFailure' ? ruling.critFailureEffects ?? [] : [];

  let board = state.board;
  let terrain = state.terrain;
  let castling = state.castling;
  let nextSpawnId = state.nextSpawnId;
  const effectEvents: GameEvent[] = [];
  let exits = new Map<string, Exit>();
  // The sacrifice is made the moment the dice are thrown, whatever they show (only once: a second try keeps it).
  const sacrificed: GameEvent[] = [];
  if (!offered && ruling.sacrifice?.length) {
    for (const at of ruling.sacrifice) {
      const piece = board[at];
      if (piece) sacrificed.push({ type: 'removed', piece, at, cause: 'sacrifice', exit: 'vanish' });
    }
    board = withoutSacrifices(board, ruling);
    castling = revokeCastling(castling, ruling.sacrifice);
  }
  const offering = offered ?? mods.filter((m) => m.kind === 'sacrifice');
  let falls: GameState['falling'] = [];
  if (toApply.length) {
    const applied = applyEffects(board, toApply, { ...rulingContext(state, ruling, nextSpawnId), clash: { mode: 'play', rolls: clashRolls } });
    // Validated on proposal and nothing can change the board while pending, so this is an invariant
    // (except for a clash, which needs its dice).
    if (!applied.ok) return { ok: false, reason: applied.code ?? 'invalidRuling', detail: applied.detail };
    // An attacker lost a clash: the rest of the action never happened.
    if (applied.cut !== undefined) toApply = toApply.slice(0, applied.cut + 1);
    board = applied.board;
    terrain = applied.terrain;
    nextSpawnId = applied.nextSpawnId;
    falls = applied.falling;
    castling = revokeCastling(castling, applied.touched);
    exits = exitsOf(applied.events, applied.sources, ruling.staging?.[outcome]);
    effectEvents.push(...applied.events, ...checkEvents(board, color, terrain));
  } else if (sacrificed.length) {
    // Only the sacrifice changed the board.
    effectEvents.push(...checkEvents(board, color, terrain));
  } else {
    // Nothing changed, but another king was already attacked (e.g. since the turn began).
    for (const c of playersOf()) if (c !== color && isInCheck(board, c, terrain)) effectEvents.push({ type: 'check', color: c });
  }

  const narration =
    outcome === 'critFailure' ? ruling.narration.critFailure || ruling.narration.failure : success ? ruling.narration.success : ruling.narration.failure;

  const staging = ruling.staging?.[outcome];
  const events: GameEvent[] = [
    { type: 'specialResolved', color, action, roll, ...(dice && { dice }), ...(mods.length && { mods, bonus }), dc: ruling.dc, cost, success, outcome, narration, ...(reroll && { reroll }), effects: toApply, ...(staging && { staging }) },
    ...sacrificed,
    ...effectEvents,
  ];
  const precedent: Precedent = {
    turnNumber: state.turnNumber,
    color,
    action,
    interpretation: ruling.interpretation,
    dc: ruling.dc,
    cost: ruling.cost,
    roll,
    outcome,
    ...(reroll && { rerolls: reroll }),
    ...(bonus && { bonus }),
  };
  const apLeft = state.ap[color] - cost;
  // A plain failure may be rolled again (same ruling) while the AP lasts; a natural 1 stands.
  const rerollCost = state.rules.rerollCost;
  const again = outcome === 'failure' && rerollCost > 0 && apLeft >= rerollCost;
  const after: GameState = withCaptured({
    ...state,
    board,
    terrain,
    castling,
    nextSpawnId,
    ap: { ...state.ap, [color]: apLeft },
    usedApThisTurn: true,
    pending: again ? { color, action, ruling, retry: { roll, narration, rerolls: reroll }, ...(offering.length && { offered: offering }) } : null,
    ...withFalls(state, falls),
    // A second try replaces the precedent of the failure it follows (one action, one precedent).
    precedents: [...(retry ? state.precedents.slice(0, -1) : state.precedents), precedent],
  }, events, exits);

  // A king that charged into a clash and lost.
  const fallen = events.find((e) => e.type === 'kingCaptured');
  if (fallen && !isHex()) return { ok: true, state: { ...after, status: { kind: 'won', winner: fallen.winner } }, events };
  if (fallen?.type === 'kingCaptured') {
    // The hexagon: it surrenders to whoever cut it down (or the game ends, if it was the last but one).
    const rest = events.filter((e) => e !== fallen);
    const lost = events.find((e): e is Extract<GameEvent, { type: 'clash' }> => e.type === 'clash' && e.winner === 'defender' && e.attacker === color);
    const killerAt = lost ? lost.at : null;
    const b = [...board];
    const fell = kingFell(b, fallen.loser ?? color, fallen.winner, killerAt, rest);
    if (fell.status) return { ok: true, state: { ...after, board: b, ...fell }, events: rest };
    return { ok: true, ...passTurn({ ...after, board: b, ...fell }, b, null, rest) };
  }

  // One-turn-kill guard: if the opponent's king is attacked after a special action, the
  // turn ends at once (remaining AP carries over), so the opponent always gets to respond.
  if (events.some((e) => e.type === 'check')) {
    return { ok: true, ...passTurn(after, board, null, [...events, { type: 'autoTurnEnd', color, reason: 'check' }]) };
  }
  return { ok: true, state: after, events };
}

/**
 * A new game in a random scenario (랜덤 시나리오, scenario.ts): its effects for every side, put on
 * the board before the first move. A scenario that cannot be set up here (or would leave a king
 * attacked) gives way to another. `id` picks one (tests).
 */
export function withScenario(state: GameState, random: () => number, id?: string): GameState {
  setBoardMap(state.map);
  const order = id ? SCENARIOS.filter((d) => d.id === id) : [...SCENARIOS].sort(() => random() - 0.5);
  // Each scenario gets a few tries with other squares (a pawn gone may open a line onto a king).
  for (const def of order.flatMap((d) => [d, d, d, d, d])) {
    const effects = scenarioEffects(def, state, random);
    if (!effects.length) continue;
    const applied = applyEffects(state.board, effects, effectContext(state));
    if (!applied.ok || playersOf().some((c) => isInCheck(applied.board, c, applied.terrain))) continue;
    return {
      ...state,
      board: applied.board,
      terrain: applied.terrain,
      nextSpawnId: applied.nextSpawnId,
      castling: revokeCastling(state.castling, applied.touched),
      scenario: { id: def.id, title: def.title, text: def.text },
    };
  }
  return state;
}
