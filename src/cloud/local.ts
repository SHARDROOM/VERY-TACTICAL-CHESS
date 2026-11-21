/*
 * What this browser keeps, in the three parts the cloud copy keeps them in (docs/SPEC.md, "Google
 * 로그인과 Drive 저장"): settings (the GM chosen, the backup GMs, the AI seats' models, the name, the
 * sound and staging looks, the folded watch bar), the API keys (all of them, locked before they
 * leave: crypto.ts), and the game saved to go on with. Read and written as the stores already
 * keep them (their own readers check what is there), so nothing else needs to know about the cloud.
 */

const GM = 'vtc.gm.v1';
const BACKUPS = 'vtc.gm.backups.v1';
const BRAINS = 'vtc.brains.v1';
const SAVE = 'vtc.save.v1';
/** Plain settings kept as they are (strings). */
const PLAIN = { name: 'vtc.name', sound: 'vtc.sound', stagingLook: 'vtc.stagingLook', watchFolded: 'vtc.watchFolded' } as const;

/** Everything this game keeps on a browser, for "wipe this device" (the device's own id stays). */
export const LOCAL_KEYS = [GM, BACKUPS, BRAINS, SAVE, ...Object.values(PLAIN)];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export interface SettingsPart {
  /** The GM chosen (no key). */
  gm?: unknown;
  /** The backup GMs, in order (no keys). */
  backups?: unknown[];
  /** The AI seats' own models (no keys). */
  brains?: Obj;
  name?: string;
  sound?: string;
  stagingLook?: string;
  watchFolded?: string;
}

export interface KeysPart {
  /** The GM keys, per service (and per address for other services). */
  gm?: Obj;
  /** Each backup GM's key, by its place. */
  backups?: string[];
  /** Each AI seat's key. */
  brains?: Record<string, string>;
}

export interface LocalParts {
  settings: SettingsPart;
  keys: KeysPart;
  game: unknown | null;
}

function readJson(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

const withoutKey = (c: unknown): unknown => {
  if (!isObj(c)) return c;
  const { apiKey: _key, ...rest } = c;
  void _key;
  return rest;
};

export function readLocal(storage: Storage): LocalParts {
  const settings: SettingsPart = {};
  const keys: KeysPart = {};
  const gm = readJson(storage, GM);
  if (isObj(gm)) {
    if (gm.current !== undefined) settings.gm = withoutKey(gm.current);
    if (isObj(gm.keys) && Object.keys(gm.keys).length) keys.gm = gm.keys;
  }
  const backups = readJson(storage, BACKUPS);
  if (Array.isArray(backups) && backups.length) {
    settings.backups = backups.map(withoutKey);
    keys.backups = backups.map((c) => (isObj(c) && typeof c.apiKey === 'string' ? c.apiKey : ''));
  }
  const brains = readJson(storage, BRAINS);
  if (isObj(brains) && Object.keys(brains).length) {
    settings.brains = Object.fromEntries(Object.entries(brains).map(([seat, c]) => [seat, withoutKey(c)]));
    const brainKeys = Object.entries(brains).flatMap(([seat, c]) => (isObj(c) && typeof c.apiKey === 'string' && c.apiKey ? [[seat, c.apiKey]] : []));
    if (brainKeys.length) keys.brains = Object.fromEntries(brainKeys);
  }
  for (const [field, key] of Object.entries(PLAIN)) {
    const v = storage.getItem(key);
    if (v !== null) settings[field as keyof typeof PLAIN] = v;
  }
  return { settings, keys, game: readJson(storage, SAVE) };
}

/** Puts these parts on this browser (the parts left out stay as they are). */
export function writeLocal(storage: Storage, parts: Partial<LocalParts>): void {
  const now = readLocal(storage);
  const settings = parts.settings ?? now.settings;
  const keys = parts.keys ?? now.keys;
  const set = (key: string, value: unknown) => (value === undefined ? storage.removeItem(key) : storage.setItem(key, JSON.stringify(value)));
  if (parts.settings || parts.keys) {
    if (settings.gm !== undefined || keys.gm) set(GM, { current: settings.gm ?? { provider: 'fake' }, keys: keys.gm ?? {} });
    else storage.removeItem(GM);
    // A model and its key were kept together: put them back together by place (or seat).
    set(BACKUPS, settings.backups?.length ? settings.backups.map((c, i) => (isObj(c) ? { ...c, apiKey: keys.backups?.[i] ?? '' } : c)) : undefined);
    set(BRAINS, settings.brains && Object.keys(settings.brains).length ? Object.fromEntries(Object.entries(settings.brains).map(([seat, c]) => [seat, isObj(c) ? { ...c, apiKey: keys.brains?.[seat] ?? '' } : c])) : undefined);
  }
  if (parts.settings) {
    for (const [field, key] of Object.entries(PLAIN)) {
      const v = settings[field as keyof typeof PLAIN];
      if (typeof v === 'string') storage.setItem(key, v);
      else storage.removeItem(key);
    }
  }
  if ('game' in parts) set(SAVE, parts.game ?? undefined);
}

/** Takes everything this game keeps off this browser (its device id stays). */
export function wipeLocal(storage: Storage): void {
  for (const key of LOCAL_KEYS) storage.removeItem(key);
}
