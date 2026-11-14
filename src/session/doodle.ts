/**
 * Doodles: lines and short notes anyone in the room can put on the table (the 낙서 rule).
 * Coordinates are table-top positions (x, z) in board squares; the board is 8×8 around 0.
 * Everything that crosses the wire goes through cleanDoodle first.
 */

export const DOODLE_COLORS = ['#f5f1e6', '#ff5a4f', '#ffd23f', '#5ab0ff', '#5be08a', '#1d1b22'] as const;
export const MAX_DOODLES = 300;
export const MAX_LINE_POINTS = 400;
export const MAX_NOTE_LENGTH = 40;
/** The table top, a little inside its edges. */
const BOUNDS = { x: 12.8, z: 8.3 };

export type DoodleInput =
  | { kind: 'line'; color: string; width: number; points: number[] }
  | { kind: 'note'; color: string; x: number; z: number; text: string; angle: number };

/** A doodle on the table. `author` is the public key of the member who made it. */
export type Doodle = DoodleInput & { id: string; author: string };

export type DoodleOp = { op: 'add'; doodle: DoodleInput } | { op: 'remove'; id: string } | { op: 'clear'; all: boolean };

/** What changed, as sent to everyone. */
export type DoodleChange = { op: 'added'; doodle: Doodle } | { op: 'removed'; ids: string[] } | { op: 'reset'; doodles: Doodle[] };

const round = (n: number) => Math.round(n * 100) / 100;
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** A doodle as typed by a player, checked and rounded; null if it is junk. */
export function cleanDoodle(raw: unknown): DoodleInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const color = DOODLE_COLORS.includes(d.color as never) ? (d.color as string) : null;
  if (!color) return null;
  if (d.kind === 'line') {
    if (!Array.isArray(d.points) || d.points.length < 4 || d.points.length % 2 !== 0) return null;
    if (d.points.length > MAX_LINE_POINTS * 2) return null;
    const points: number[] = [];
    for (let i = 0; i < d.points.length; i += 2) {
      const x = d.points[i];
      const z = d.points[i + 1];
      if (!isNum(x) || !isNum(z) || Math.abs(x) > BOUNDS.x || Math.abs(z) > BOUNDS.z) return null;
      points.push(round(x), round(z));
    }
    const width = isNum(d.width) ? Math.min(0.3, Math.max(0.03, round(d.width))) : 0.08;
    return { kind: 'line', color, width, points };
  }
  if (d.kind === 'note') {
    if (!isNum(d.x) || !isNum(d.z) || Math.abs(d.x) > BOUNDS.x || Math.abs(d.z) > BOUNDS.z) return null;
    const text = typeof d.text === 'string' ? d.text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH) : '';
    if (!text) return null;
    const angle = isNum(d.angle) ? round(d.angle % (Math.PI * 2)) : 0;
    return { kind: 'note', color, x: round(d.x), z: round(d.z), text, angle };
  }
  return null;
}

/** The room's doodles, kept by whoever runs the room. */
export class DoodleStore {
  doodles: Doodle[] = [];
  private next = 1;

  /** Applies an op from `author`; `moderator` may remove anyone's. Returns what changed, or null. */
  apply(op: DoodleOp, author: string, moderator: boolean): DoodleChange | null {
    if (op.op === 'add') {
      const doodle: Doodle = { ...op.doodle, id: `d${this.next++}`, author };
      this.doodles.push(doodle);
      const dropped = this.doodles.length > MAX_DOODLES ? this.doodles.splice(0, this.doodles.length - MAX_DOODLES) : [];
      // Dropping the oldest is rare; resend everything then so everyone stays in step.
      return dropped.length ? { op: 'reset', doodles: [...this.doodles] } : { op: 'added', doodle };
    }
    if (op.op === 'remove') {
      const d = this.doodles.find((x) => x.id === op.id);
      if (!d || (d.author !== author && !moderator)) return null;
      this.doodles = this.doodles.filter((x) => x !== d);
      return { op: 'removed', ids: [d.id] };
    }
    const all = op.all && moderator;
    const gone = this.doodles.filter((d) => all || d.author === author).map((d) => d.id);
    if (!gone.length) return null;
    this.doodles = this.doodles.filter((d) => !gone.includes(d.id));
    return { op: 'removed', ids: gone };
  }

  clearAll(): DoodleChange {
    this.doodles = [];
    return { op: 'reset', doodles: [] };
  }
}

/** Applies a change to a local copy (guests). */
export function applyDoodleChange(list: Doodle[], change: DoodleChange): Doodle[] {
  if (change.op === 'added') return [...list.filter((d) => d.id !== change.doodle.id), change.doodle];
  if (change.op === 'removed') return list.filter((d) => !change.ids.includes(d.id));
  return change.doodles;
}

/** Parses a doodle op sent by a guest. */
export function parseDoodleOp(raw: unknown): DoodleOp | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.op === 'add') {
    const doodle = cleanDoodle(o.doodle);
    return doodle ? { op: 'add', doodle } : null;
  }
  if (o.op === 'remove') return typeof o.id === 'string' && o.id.length <= 20 ? { op: 'remove', id: o.id } : null;
  if (o.op === 'clear') return { op: 'clear', all: o.all === true };
  return null;
}

/** Parses a doodle change sent by the host (trusted, but junk is still dropped). */
export function parseDoodleChange(raw: unknown): DoodleChange | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const full = (d: unknown): Doodle | null => {
    const clean = cleanDoodle(d);
    const r = d as Record<string, unknown>;
    return clean && typeof r.id === 'string' && typeof r.author === 'string' ? { ...clean, id: r.id, author: r.author } : null;
  };
  if (o.op === 'added') {
    const d = full(o.doodle);
    return d ? { op: 'added', doodle: d } : null;
  }
  if (o.op === 'removed') return Array.isArray(o.ids) ? { op: 'removed', ids: o.ids.filter((x): x is string => typeof x === 'string') } : null;
  if (o.op === 'reset' && Array.isArray(o.doodles)) return { op: 'reset', doodles: o.doodles.map(full).filter((d): d is Doodle => !!d) };
  return null;
}
