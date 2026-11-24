import { highlights, isAiOnly, type Color, type DrawReason, type GameState, type Highlights, type Precedent } from '../engine';
import { fingerprint } from '../cloud/fingerprint';

/*
 * 기록·전적 (사용자 요청): every finished game this screen played or watched in a room, from its
 * side, the last MAX_RECORDS. Kept on this browser (and, signed in, merged with the other
 * devices' through Drive: cloud/sync.ts). A game only AIs played (AI끼리 보기) is not kept.
 * docs/SPEC.md, "기록·전적".
 */

export const RECORDS_KEY = 'vtc.records.v1';
export const MAX_RECORDS = 100;
/** A record keeps this many of its game's special actions (the latest). */
const KEPT_PRECEDENTS = 40;

/** How it was played from this screen: two at one screen, against AIs, in a room, or watching a room. */
export type RecordMode = 'hotseat' | 'ai' | 'online' | 'watching';

export interface GameRecord {
  /** The finished game's fingerprint: the same game seen again (a reload, a reconnect) is kept once. */
  id: string;
  /** When it ended here (ms). */
  at: number;
  mode: RecordMode;
  map: 'classic' | 'hex3';
  /** The side played from this screen ('both': two people at one screen; null: watching). */
  me: Color | 'both' | null;
  /** Who won (null: a draw). */
  winner: Color | null;
  /** How it ended: a king taken, a resignation, a draw agreed, only kings left. */
  end: 'king' | 'resign' | DrawReason;
  /** This screen's result (null: two at one screen, or watching). */
  result: 'won' | 'lost' | 'draw' | null;
  turns: number;
  /** The GM that ruled, as the game named it. */
  gm: string;
  /** The AIs played against, by side (their level's name). */
  ai?: Partial<Record<Color, string>>;
  /** 명장면, as the end screen showed them. */
  highlights: Highlights;
  /** The special actions tried (the latest KEPT_PRECEDENTS). */
  precedents: Precedent[];
}

export interface RecordContext {
  mode: RecordMode;
  me: Color | 'both' | null;
  gm: string;
  ai?: Partial<Record<Color, string>>;
  at: number;
}

/** The same finished game gives the same id on every screen that saw it (its id, when it has one, and how it ended). */
function recordId(state: GameState): string {
  return fingerprint({
    game: state.gameId ?? null,
    map: state.map ?? 'classic',
    status: state.status,
    turn: state.turnNumber,
    board: state.board.map((p) => p?.id ?? null),
    captured: state.captured.map((p) => `${p.color}${p.type}`),
    precedents: state.precedents.map((p) => [p.turnNumber, p.action, p.outcome]),
  });
}

/** What a finished game leaves (null: not finished, or only AIs played it). */
export function recordOf(state: GameState, ctx: RecordContext): GameRecord | null {
  const status = state.status;
  if (status.kind === 'playing' || isAiOnly(state)) return null;
  const winner = status.kind === 'won' ? status.winner : null;
  const end: GameRecord['end'] = status.kind === 'draw' ? status.reason : status.by === 'resign' ? 'resign' : 'king';
  const mine = ctx.me !== null && ctx.me !== 'both' ? ctx.me : null;
  const result: GameRecord['result'] = !mine ? null : winner === null ? 'draw' : winner === mine ? 'won' : 'lost';
  return {
    id: recordId(state),
    at: ctx.at,
    mode: ctx.mode,
    map: state.map === 'hex3' ? 'hex3' : 'classic',
    me: ctx.me,
    winner,
    end,
    result,
    turns: state.turnNumber,
    gm: ctx.gm,
    ...(ctx.ai && Object.keys(ctx.ai).length && { ai: ctx.ai }),
    highlights: highlights(state),
    precedents: state.precedents.slice(-KEPT_PRECEDENTS),
  };
}

const isRecord = (r: unknown): r is GameRecord =>
  !!r && typeof r === 'object' && typeof (r as GameRecord).id === 'string' && typeof (r as GameRecord).at === 'number' && typeof (r as GameRecord).turns === 'number' && Array.isArray((r as GameRecord).precedents);

/** Every game once (the first copy met), newest first, the last MAX_RECORDS. */
function tidy(list: unknown[]): GameRecord[] {
  const seen = new Set<string>();
  const out: GameRecord[] = [];
  for (const r of list) {
    if (!isRecord(r) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  // Ties by id: every device puts the same records in the same order (or two would send theirs back and forth).
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, MAX_RECORDS);
}

/** Two lists of records (this browser's and the cloud's) as one. */
export function mergeRecords(a: unknown, b: unknown): GameRecord[] {
  return tidy([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
}

function store(storage?: Storage): Storage | null {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readRecords(storage?: Storage): GameRecord[] {
  try {
    const raw: unknown = JSON.parse(store(storage)?.getItem(RECORDS_KEY) ?? '[]');
    return Array.isArray(raw) ? tidy(raw) : [];
  } catch {
    return [];
  }
}

/** Keeps a finished game (once: the same game again changes nothing). */
export function addRecord(record: GameRecord, storage?: Storage): void {
  const s = store(storage);
  if (!s) return;
  const now = readRecords(s);
  if (now.some((r) => r.id === record.id)) return;
  try {
    s.setItem(RECORDS_KEY, JSON.stringify(tidy([record, ...now])));
  } catch {
    // full or blocked storage: the record is not kept
  }
}
