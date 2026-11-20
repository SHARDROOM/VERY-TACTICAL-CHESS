import { BUILDING_KINDS, COVER_NAME, type Board, type Building, type BuildingKind, type Color, type FallingPiece, type GameEvent, type Piece, type Square, type TerrainCell } from './types';
import { BUILDING_HUT_PARTS, cleanProp, type Prop, type PropPreset } from './props';
import { unseat } from './tags';
import { byDistance } from './squares';

/**
 * How terrain gets in the way. `noPass`: nothing enters or passes (a wall, a pit); `noLand`:
 * pieces may pass but not stop (a wall with a ladder). A bridged pit is plain ground.
 */
export interface TerrainBlocks {
  noPass: ReadonlySet<Square>;
  noLand: ReadonlySet<Square>;
}

export function terrainBlocks(terrain: readonly TerrainCell[] | undefined): TerrainBlocks {
  const noPass = new Set<Square>();
  const noLand = new Set<Square>();
  for (const c of terrain ?? []) {
    if (c.kind === 'wall') (c.cover?.kind === 'ladder' ? noLand : noPass).add(c.at);
    else if (c.cover?.kind !== 'bridge') noPass.add(c.at);
  }
  return { noPass, noLand };
}

/** The squares a piece may not stop on (walls, ladders included; unbridged pits). */
export function blockedSquares(terrain: readonly TerrainCell[] | undefined): ReadonlySet<Square> {
  const { noPass, noLand } = terrainBlocks(terrain);
  return new Set([...noPass, ...noLand]);
}

export const terrainAt = (terrain: readonly TerrainCell[] | undefined, sq: Square): TerrainCell | null =>
  terrain?.find((c) => c.at === sq) ?? null;

/** A building's look for a custom one, guessed from its name and what it helps with. */
const LOOK_BY_WORDS: [RegExp, PropPreset][] = [
  [/대장|무기|검|칼|창|도끼|갑옷|벼리|단조|병기/, 'forge'],
  [/교회|성당|예배|신전|사원|기도|소생|되살|부활|수도원/, 'chapel'],
  [/대포|포대|포격|사격|원거리|투석|화포|요새/, 'cannon'],
];

/**
 * How a building looks (사용자 요청: a forge came out as a plain wall): a ready-made one always its
 * own preset (the GM is told the system gives it); a custom one the GM's look, else one its name or
 * purpose suggests, else a little house. Never the plain stones of a wall.
 */
export function buildingLook(b: Building, given?: Prop | null): Prop {
  const preset = (p: PropPreset) => cleanProp({ preset: p, parts: [], attach: 'feet', scale: 1 })!;
  if (b.kind !== 'custom') return preset(BUILDING_INFO[b.kind].preset);
  if (given) return given;
  const guess = LOOK_BY_WORDS.find(([words]) => words.test(`${b.name} ${b.about}`));
  return guess ? preset(guess[1]) : { preset: null, parts: BUILDING_HUT_PARTS, attach: 'feet', scale: 1 };
}

/** The ready-made buildings: name, what they help with, and their look (a prop preset). */
export const BUILDING_INFO: Record<Exclude<BuildingKind, 'custom'>, { name: string; about: string; preset: PropPreset }> = {
  cannon: { name: '대포', about: '원거리 공격', preset: 'cannon' },
  church: { name: '교회', about: '기물 되살리기(소생)', preset: 'chapel' },
  forge: { name: '대장간', about: '칼이나 무기를 만들거나 얻기', preset: 'forge' },
};
/** A building's bonus: 1..3 (2 if the GM gives none). */
export const BUILDING_BONUS_MAX = 3;
export const BUILDING_BONUS = 2;
/** How near the actor must stand to use a building (king steps). */
export const BUILDING_REACH = 1;

/** The building as the rules keep it, or why it cannot be (from a GM's effect). */
export function cleanBuilding(raw: unknown): Building | string {
  const b = (raw ?? {}) as Partial<Building>;
  if (!BUILDING_KINDS.includes(b.kind as BuildingKind)) return '건물 종류는 cannon, church, forge, custom 중 하나';
  const kind = b.kind as BuildingKind;
  const info = kind === 'custom' ? null : BUILDING_INFO[kind];
  const name = (typeof b.name === 'string' ? b.name.trim() : '').slice(0, 12) || info?.name || '';
  const about = (typeof b.about === 'string' ? b.about.trim() : '').slice(0, 30) || info?.about || '';
  if (!name || !about) return '자유 건물(custom)에는 이름(name)과 무엇에 보너스를 주는지(about)가 있어야 함';
  const bonus = typeof b.bonus === 'number' && Number.isFinite(b.bonus) && Math.round(b.bonus) !== 0 ? Math.round(b.bonus) : BUILDING_BONUS;
  if (bonus < 1 || bonus > BUILDING_BONUS_MAX) return `건물 보너스는 +1~+${BUILDING_BONUS_MAX}`;
  return { kind, name, about, bonus };
}

/** Most squares that may hold terrain at once, so the board never walls itself shut. */
export const MAX_TERRAIN = 12;

/**
 * Terrain counts down like a tag: one turn when its owner (the side whose turn it was made on)
 * finishes a turn, except the turn it was made. So do bridges and ladders, each on its own.
 * Called when `color`'s turn `turnNumber` ends. `fallen`: squares whose bridge is gone.
 */
export function tickTerrain(
  terrain: readonly TerrainCell[] | undefined,
  color: Color,
  turnNumber: number,
): { terrain: TerrainCell[]; events: GameEvent[]; fallen: Square[] } {
  const events: GameEvent[] = [];
  const kept: TerrainCell[] = [];
  const fallen: Square[] = [];
  const counts = (c: { owner: Color; turnsLeft: number | null; appliedOnTurn: number }) => c.owner === color && c.turnsLeft !== null && c.appliedOnTurn !== turnNumber;
  for (const cell of terrain ?? []) {
    let c = cell;
    if (c.cover && counts(c.cover)) {
      const left = c.cover.turnsLeft! - 1;
      if (left > 0) c = { ...c, cover: { ...c.cover, turnsLeft: left } };
      else {
        events.push({ type: 'coverGone', at: c.at, kind: c.cover.kind, expired: true });
        if (c.cover.kind === 'bridge') fallen.push(c.at);
        const { cover: _gone, ...bare } = c;
        void _gone;
        c = bare;
      }
    }
    if (!counts(c)) {
      kept.push(c);
      continue;
    }
    const left = c.turnsLeft! - 1;
    if (left > 0) kept.push({ ...c, turnsLeft: left });
    else events.push({ type: 'terrainCleared', at: c.at, kind: c.kind, expired: true });
  }
  return { terrain: kept, events, fallen };
}

/**
 * Whoever stands where a bridge was falls into the pit; a king (never taken but by a normal move)
 * is pushed to the nearest free square instead. Returns the new board and what happened.
 */
export function dropFromBridges(
  board: Board,
  squares: readonly Square[],
  terrain: readonly TerrainCell[],
): { board: (Piece | null)[]; events: GameEvent[]; falling: FallingPiece[] } {
  const next: (Piece | null)[] = [...board];
  const events: GameEvent[] = [];
  const falling: FallingPiece[] = [];
  const blocked = blockedSquares(terrain);
  for (const sq of squares) {
    const piece = next[sq];
    if (!piece) continue;
    // The pit may have gone in the same tick: then there is nothing to fall into.
    if (!terrain.some((c) => c.at === sq && c.kind === 'pit' && !c.cover)) continue;
    if (piece.type === 'king') {
      const to = nearestFree(next, sq, blocked);
      if (to === null) continue;
      next[to] = piece;
      next[sq] = null;
      events.push({ type: 'pushed', pieceId: piece.id, from: sq, to });
      continue;
    }
    next[sq] = null;
    events.push({ type: 'removed', piece, at: sq, cause: 'pit' });
    // Its rider is thrown off as it goes down (and may well follow it in).
    falling.push(...unseat(piece, sq, events));
  }
  return { board: next, events, falling };
}

/** The closest empty square a piece may stand on, nearest rings first, in board order. */
function nearestFree(board: Board, from: Square, blocked: ReadonlySet<Square>): Square | null {
  for (const sq of byDistance(from)) if (!board[sq] && !blocked.has(sq)) return sq;
  return null;
}

export const coverName = (kind: keyof typeof COVER_NAME) => COVER_NAME[kind];
