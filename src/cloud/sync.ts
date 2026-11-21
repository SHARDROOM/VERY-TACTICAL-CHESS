import { readLocal, wipeLocal, writeLocal, type KeysPart, type LocalParts, type SettingsPart } from './local';
import { lockKey, newSalt, seal, unseal, type Sealed } from './crypto';
import { TokenExpired, type CloudDrive } from './drive';
import type { CloudAuth, Token } from './google';

/*
 * Keeping this browser and the player's Google Drive in step (docs/SPEC.md, "Google 로그인과 Drive
 * 저장"). What is kept is split into items: the GM chosen, the backup GMs, the AI seats' models
 * (each with its keys), the name, the sound and staging looks, the folded watch bar, and the game
 * saved to go on with. Each item carries when it last changed; an item changed on one side only
 * goes to the other, one changed on both sides is settled by the newer (a different game on each
 * side is asked about instead). The keys are locked with the player's passphrase before they leave
 * (crypto.ts); a device that does not have it yet syncs everything else and waits for it.
 *
 * Signed in, this browser takes the cloud's copy at once and sends its own changes a few seconds
 * after they are made. When Google's sign-in runs out, sending stops until the player connects
 * again (a click).
 */

export const KEYED = ['gm', 'backups', 'brains'] as const;
const PLAIN = ['name', 'sound', 'stagingLook', 'watchFolded'] as const;
export const ITEMS = [...KEYED, ...PLAIN, 'game'] as const;
export type Item = (typeof ITEMS)[number];
type Keyed = (typeof KEYED)[number];
type Values = Record<Item, unknown>;
interface KeyedValue {
  setting: unknown;
  keys: unknown;
}

export interface CloudDoc {
  version: 1;
  /** When each item last changed (ms, by the clock of the device that changed it). */
  at: Partial<Record<Item, number>>;
  /** Every item without its keys (a keyed item keeps only its setting here). */
  items: Partial<Record<Item, unknown>>;
  /** The keys of the keyed items, locked with the player's passphrase. */
  keys?: Sealed;
}

/** Changes are sent this long after the last one (a game saves after every move). */
export const UPLOAD_DELAY_MS = 3000;
/** After a failed sync (network, Google's own trouble), the next try waits this long. */
export const RETRY_MS = 30_000;
const TICK_MS = 2000;

const META = 'vtc.sync.meta';
const LOCK = 'vtc.sync.lock';
const TOKEN = 'vtc.sync.token';

export type CloudStatus = 'signedOut' | 'connecting' | 'synced' | 'saving' | 'expired' | 'error';

export interface GameSummary {
  kind: 'hotseat' | 'host' | null;
  code: string | null;
  turn: number | null;
  savedAt: number | null;
}

export interface CloudState {
  status: CloudStatus;
  email: string | null;
  error: string | null;
  /** The passphrase is needed: to set one (the keys are not in the cloud yet, or start over) or to enter the one set elsewhere. */
  passphrase: 'set' | 'enter' | null;
  /** This browser and the cloud each hold a different game: which one to keep. */
  conflict: { local: GameSummary; cloud: GameSummary } | null;
  lastSynced: number | null;
}

interface Meta {
  signedIn: boolean;
  email: string | null;
  /** Each item as last seen here (a hash), to notice changes. */
  seen: Partial<Record<Item, string>>;
  /** When each item last changed here. */
  at: Partial<Record<Item, number>>;
  /** Items changed here and not yet in the cloud. */
  dirty: Item[];
  /** The cloud's change time of each item when last in step (another one there: it changed elsewhere). */
  cloudAt: Partial<Record<Item, number>>;
  /** The keys start over (키 초기화): this browser's keys replace the ones locked in the cloud. */
  resetKeys?: boolean;
  lastSynced?: number;
}

interface Lock {
  salt: string;
  /** The lock key made from the passphrase (never the passphrase itself). */
  key: string;
}

const freshMeta = (): Meta => ({ signedIn: false, email: null, seen: {}, at: {}, dirty: [], cloudAt: {} });

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isKeyed = (i: Item): i is Keyed => (KEYED as readonly string[]).includes(i);

/** A short fingerprint of a value (to notice a change without keeping a copy of the keys). */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? 'null';
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function itemsOf(parts: LocalParts): Values {
  const v = {} as Values;
  for (const k of KEYED) v[k] = { setting: parts.settings[k] ?? null, keys: parts.keys[k] ?? null } satisfies KeyedValue;
  for (const k of PLAIN) v[k] = parts.settings[k] ?? null;
  v.game = parts.game ?? null;
  return v;
}

function partsOf(v: Values): LocalParts {
  const settings: SettingsPart = {};
  const keys: KeysPart = {};
  const kv = (k: Keyed): KeyedValue => (isObj(v[k]) ? (v[k] as unknown as KeyedValue) : { setting: null, keys: null });
  const gm = kv('gm');
  if (gm.setting !== null) settings.gm = gm.setting;
  if (isObj(gm.keys)) keys.gm = gm.keys;
  const backups = kv('backups');
  if (Array.isArray(backups.setting)) settings.backups = backups.setting;
  if (Array.isArray(backups.keys)) keys.backups = backups.keys as string[];
  const brains = kv('brains');
  if (isObj(brains.setting)) settings.brains = brains.setting;
  if (isObj(brains.keys)) keys.brains = brains.keys as Record<string, string>;
  for (const k of PLAIN) if (typeof v[k] === 'string') settings[k] = v[k] as string;
  return { settings, keys, game: v.game ?? null };
}

const isEmpty = (i: Item, v: unknown): boolean => (isKeyed(i) ? !isObj(v) || (v.setting === null && v.keys === null) : v === null || v === undefined);

/** Any key at all (the passphrase is only needed once there is one). */
export function hasKeys(keys: unknown): boolean {
  if (typeof keys === 'string') return keys.trim() !== '';
  if (Array.isArray(keys)) return keys.some(hasKeys);
  if (isObj(keys)) return Object.values(keys).some(hasKeys);
  return false;
}

/** The GM keys of both sides: each service's key from `over`, the ones only `base` has kept (a key is never lost to a sync). */
function unionKeys(base: unknown, over: unknown): unknown {
  if (!isObj(base)) return over;
  if (!isObj(over)) return base;
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === 'compatible') out.compatible = unionKeys(base.compatible, v);
    else if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

const gameId = (g: unknown): string | null => (isObj(g) && typeof g.id === 'string' ? g.id : null);

/** Two saved games that are not the same game (one is not the other, played on). */
function differentGames(a: unknown, b: unknown): boolean {
  if (!isObj(a) || !isObj(b)) return false;
  const ia = gameId(a);
  const ib = gameId(b);
  return ia && ib ? ia !== ib : fingerprint(a) !== fingerprint(b);
}

export function summarize(g: unknown): GameSummary {
  const o = isObj(g) ? g : {};
  const state = isObj(o.state) ? o.state : {};
  return {
    kind: o.kind === 'hotseat' || o.kind === 'host' ? o.kind : null,
    code: typeof o.code === 'string' ? o.code : null,
    turn: typeof state.turnNumber === 'number' ? state.turnNumber : null,
    savedAt: typeof o.savedAt === 'number' ? o.savedAt : null,
  };
}

function isDoc(v: unknown): v is CloudDoc {
  return isObj(v) && v.version === 1 && isObj(v.at) && isObj(v.items);
}

function readJson(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface CloudSyncOptions {
  storage: Storage;
  auth: CloudAuth;
  /** The cloud copy, reached with this access token. */
  drive: (token: string) => CloudDrive;
  now?: () => number;
}

export class CloudSync {
  /** Told when items from the cloud were put on this browser (the app takes them up). */
  onApplied?: (items: Item[]) => void;
  private readonly storage: Storage;
  private readonly auth: CloudAuth;
  private readonly makeDrive: (token: string) => CloudDrive;
  private readonly now: () => number;
  private meta: Meta;
  private lock: Lock | null;
  private token: Token | null;
  private drive: { token: string; drive: CloudDrive } | null = null;
  private snapshot: CloudState;
  private readonly listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private connecting = false;
  private error: string | null = null;
  private retryAt = 0;
  private passphrase: 'set' | 'enter' | null = null;
  private conflict: { local: GameSummary; cloud: GameSummary } | null = null;
  private choice: 'local' | 'cloud' | null = null;
  /** The cloud's locked keys as last read (a passphrase is tried on them). */
  private cloudKeys: Sealed | null = null;
  /** Items that could not be synced last time (the keys locked, a game to choose). */
  private blocked = new Set<Item>();

  constructor(options: CloudSyncOptions) {
    this.storage = options.storage;
    this.auth = options.auth;
    this.makeDrive = options.drive;
    this.now = options.now ?? Date.now;
    const meta = readJson(this.storage, META);
    this.meta = isObj(meta) && Array.isArray(meta.dirty) ? { ...freshMeta(), ...(meta as Partial<Meta>) } : freshMeta();
    const lock = readJson(this.storage, LOCK);
    this.lock = isObj(lock) && typeof lock.salt === 'string' && typeof lock.key === 'string' ? { salt: lock.salt, key: lock.key } : null;
    const token = readJson(this.storage, TOKEN);
    this.token = isObj(token) && typeof token.token === 'string' && typeof token.expiresAt === 'number' ? { token: token.token, expiresAt: token.expiresAt } : null;
    this.snapshot = this.compute();
  }

  get state(): CloudState {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Watches for changes from now on (and, signed in, takes the cloud's copy). Returns the way to stop. */
  start(): () => void {
    this.observe();
    if (this.meta.signedIn && this.tokenValid()) void this.sync();
    this.emit();
    const timer = setInterval(() => this.tick(), TICK_MS);
    return () => clearInterval(timer);
  }

  /** Sign in (or connect again): must be called from a click. */
  async connect(): Promise<void> {
    this.connecting = true;
    this.error = null;
    this.emit();
    try {
      const token = await this.auth.requestToken(this.meta.email ?? undefined);
      this.setToken(token);
      const email = await this.auth.email(token.token);
      // Another account than before: nothing here is in its cloud yet.
      if (this.meta.signedIn && email && this.meta.email && email !== this.meta.email) {
        this.meta.cloudAt = {};
        this.setLock(null);
      }
      this.meta.signedIn = true;
      this.meta.email = email ?? this.meta.email;
      this.saveMeta();
    } catch (e) {
      this.error = message(e);
      return;
    } finally {
      this.connecting = false;
      this.emit();
    }
    await this.sync();
  }

  /** Sends what changed here and takes what changed there, now. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = async () => {
      try {
        do {
          this.again = false;
          await this.syncOnce();
        } while (this.again);
        this.error = null;
        this.retryAt = 0;
      } catch (e) {
        if (e instanceof TokenExpired) this.setToken(null);
        else {
          this.error = `Drive에 저장하지 못했습니다: ${message(e)}`;
          this.retryAt = this.now() + RETRY_MS;
        }
      } finally {
        this.running = null;
        this.emit();
      }
    };
    this.running = run();
    this.emit();
    return this.running;
  }

  /** The passphrase typed in: a new one ('set'), or the one set elsewhere ('enter': false if it does not open the keys). */
  async setPassphrase(passphrase: string): Promise<boolean> {
    if (this.passphrase === 'enter') {
      const sealed = this.cloudKeys;
      if (!sealed) return false;
      const key = await lockKey(passphrase, sealed.salt);
      if ((await unseal(key, sealed)) === null) return false;
      this.setLock({ salt: sealed.salt, key });
    } else {
      const salt = newSalt();
      this.setLock({ salt, key: await lockKey(passphrase, salt) });
    }
    this.passphrase = null;
    this.emit();
    void this.sync();
    return true;
  }

  /** The passphrase is forgotten: the keys in the cloud are given up, and this browser's are locked with a new one. */
  resetKeys(): void {
    this.meta.resetKeys = true;
    this.saveMeta();
    this.setLock(null);
    this.passphrase = 'set';
    this.emit();
  }

  /** Which game to keep when this browser and the cloud each hold a different one. */
  resolveConflict(choice: 'local' | 'cloud'): void {
    this.choice = choice;
    this.conflict = null;
    this.emit();
    void this.sync();
  }

  /**
   * Sign out: what is not in the cloud yet is sent first. `wipe` also takes everything this game
   * keeps off this browser; it stops ('unsynced') if something could not be sent, unless `force`.
   */
  async signOut(wipe = false, force = false): Promise<'done' | 'unsynced'> {
    this.observe();
    if (this.meta.signedIn && this.tokenValid() && (this.meta.dirty.length || this.running)) await this.sync();
    if (wipe && !force && (this.meta.dirty.length > 0 || this.blocked.size > 0)) return 'unsynced';
    if (this.token) this.auth.revoke(this.token.token);
    this.setToken(null);
    this.setLock(null);
    this.passphrase = null;
    this.conflict = null;
    this.choice = null;
    this.error = null;
    this.cloudKeys = null;
    this.blocked.clear();
    // What changed here and when is still known (for the next sign-in); nothing is in step with a cloud now.
    this.meta = { ...freshMeta(), seen: this.meta.seen, at: this.meta.at, dirty: this.meta.dirty };
    if (wipe) {
      wipeLocal(this.storage);
      this.meta = freshMeta();
      this.observe();
      this.onApplied?.([...ITEMS]);
    }
    this.saveMeta();
    this.emit();
    return 'done';
  }

  /** Notices changes made here; sends them once they have settled. */
  tick(): void {
    this.observe();
    if (this.meta.signedIn && !this.running && !this.connecting && this.tokenValid() && this.now() >= this.retryAt) {
      const pending = this.pending();
      const last = Math.max(0, ...pending.map((i) => this.meta.at[i] ?? 0));
      if (pending.length && this.now() - last >= UPLOAD_DELAY_MS) void this.sync();
    }
    this.emit();
  }

  private pending(): Item[] {
    return this.meta.dirty.filter((i) => !this.blocked.has(i));
  }

  private tokenValid(): boolean {
    return !!this.token && this.now() < this.token.expiresAt;
  }

  /** Reads this browser's items, noting any change since last seen. */
  private observe(): Values {
    const values = itemsOf(readLocal(this.storage));
    let changed = false;
    for (const i of ITEMS) {
      const f = fingerprint(values[i]);
      if (this.meta.seen[i] === f) continue;
      // The first look: what is here is from before (its time unknown), not a change.
      if (this.meta.seen[i] !== undefined) {
        this.meta.at[i] = this.now();
        if (!this.meta.dirty.includes(i)) this.meta.dirty.push(i);
      }
      this.meta.seen[i] = f;
      changed = true;
    }
    if (changed) this.saveMeta();
    return values;
  }

  /** When an item here last changed: a saved game knows its own time. */
  private localAt(i: Item, v: unknown): number {
    if (i === 'game' && isObj(v) && typeof v.savedAt === 'number') return v.savedAt;
    return this.meta.at[i] ?? 0;
  }

  private async syncOnce(): Promise<void> {
    if (!this.token || !this.tokenValid()) throw new TokenExpired('토큰 만료');
    if (this.drive?.token !== this.token.token) this.drive = { token: this.token.token, drive: this.makeDrive(this.token.token) };
    const drive = this.drive.drive;
    const raw = await drive.read();
    const cloud: CloudDoc = isDoc(raw) ? raw : { version: 1, at: {}, items: {} };
    this.cloudKeys = cloud.keys ?? null;

    // The keys in the cloud, opened if this browser can (null: it cannot yet).
    let cloudKeys: KeysPart | null = null;
    if (this.meta.resetKeys) cloudKeys = this.lock ? {} : null;
    else if (cloud.keys) {
      if (this.lock?.salt === cloud.keys.salt) {
        const text = await unseal(this.lock.key, cloud.keys);
        if (text === null) this.setLock(null);
        else cloudKeys = parseKeys(text);
      } else if (this.lock) this.setLock(null); // locked again elsewhere with a new passphrase
    } else {
      // No keys in the cloud yet: a passphrase is only needed once this browser has a key.
      const local = itemsOf(readLocal(this.storage));
      cloudKeys = this.lock || !KEYED.some((k) => hasKeys((local[k] as KeyedValue).keys)) ? {} : null;
    }
    this.passphrase = cloudKeys ? null : cloud.keys && !this.meta.resetKeys ? 'enter' : 'set';

    // From here to the local writes nothing waits, so no change here can slip in between.
    const local = this.observe();
    const take: Partial<Values> = {};
    const send: Partial<Values> = {};
    const sendAt: Partial<Record<Item, number>> = {};
    const blocked = new Set<Item>();
    let conflict: { local: GameSummary; cloud: GameSummary } | null = null;
    for (const i of ITEMS) {
      if (isKeyed(i) && !cloudKeys) {
        blocked.add(i);
        continue;
      }
      const mine = local[i];
      const theirs: unknown = isKeyed(i) ? { setting: cloud.items[i] ?? null, keys: cloudKeys?.[i] ?? null } : (cloud.items[i] ?? null);
      const cAt = cloud.at[i];
      const cloudChanged = cAt !== undefined && cAt !== this.meta.cloudAt[i];
      const localChanged = this.meta.dirty.includes(i) || (this.meta.cloudAt[i] === undefined && !isEmpty(i, mine));
      if (cloudChanged && fingerprint(mine) === fingerprint(theirs)) {
        // Already the same on both sides.
        this.meta.cloudAt[i] = cAt;
        this.meta.dirty = this.meta.dirty.filter((d) => d !== i);
        continue;
      }
      let winner: 'local' | 'cloud' | null = null;
      if (cloudChanged && localChanged) {
        if (i === 'game' && differentGames(mine, theirs)) {
          if (!this.choice) {
            conflict = this.conflict ?? { local: summarize(mine), cloud: summarize(theirs) };
            blocked.add(i);
            continue;
          }
          winner = this.choice;
          this.choice = null;
        } else winner = this.localAt(i, mine) > cAt! ? 'local' : 'cloud';
      } else if (cloudChanged) winner = 'cloud';
      else if (localChanged) winner = 'local';
      if (winner === 'cloud') {
        const v = i === 'gm' ? { ...(theirs as KeyedValue), keys: unionKeys((mine as KeyedValue).keys, (theirs as KeyedValue).keys) } : theirs;
        take[i] = v;
        // The keys only this browser had go back up with it.
        if (fingerprint(v) !== fingerprint(theirs)) {
          send[i] = v;
          sendAt[i] = Math.max(this.now(), cAt! + 1);
        }
      } else if (winner === 'local') {
        const v = i === 'gm' ? { ...(mine as KeyedValue), keys: unionKeys((theirs as KeyedValue).keys, (mine as KeyedValue).keys) } : mine;
        if (fingerprint(v) !== fingerprint(mine)) take[i] = v;
        send[i] = v;
        sendAt[i] = Math.max(this.localAt(i, mine), cAt === undefined ? 0 : cAt + 1, 1);
      }
    }
    this.blocked = blocked;
    this.conflict = conflict;

    // What the cloud had newer, put on this browser.
    const taken = Object.keys(take) as Item[];
    if (taken.length) {
      const fresh = itemsOf(readLocal(this.storage));
      for (const i of taken) fresh[i] = take[i];
      const parts = partsOf(fresh);
      writeLocal(this.storage, taken.some((i) => i !== 'game') ? (taken.includes('game') ? parts : { settings: parts.settings, keys: parts.keys }) : { game: parts.game });
      const after = itemsOf(readLocal(this.storage));
      for (const i of taken) {
        this.meta.seen[i] = fingerprint(after[i]);
        if (send[i] === undefined) {
          this.meta.at[i] = cloud.at[i];
          this.meta.cloudAt[i] = cloud.at[i];
          this.meta.dirty = this.meta.dirty.filter((d) => d !== i);
        }
      }
      this.saveMeta();
      this.onApplied?.(taken);
    }

    const sent = Object.keys(send) as Item[];
    // The locked keys go up with any keyed item, and whenever the cloud does not hold them under this lock.
    const sentKeys = sent.some(isKeyed) || (!!cloudKeys && !!this.lock && (!!this.meta.resetKeys || cloud.keys?.salt !== this.lock.salt));
    if (sent.length || sentKeys) {
      const expect: Partial<Record<Item, string>> = {};
      for (const i of sent) expect[i] = this.meta.seen[i];
      const doc: CloudDoc = { version: 1, at: { ...cloud.at }, items: { ...cloud.items }, ...(cloud.keys ? { keys: cloud.keys } : {}) };
      for (const i of sent) {
        doc.at[i] = sendAt[i];
        doc.items[i] = isKeyed(i) ? (send[i] as KeyedValue).setting : send[i];
      }
      if (sentKeys) {
        // Every keyed item's keys as they now stand, locked together.
        const now = itemsOf(readLocal(this.storage));
        const keys: KeysPart = {};
        for (const k of KEYED) {
          const v = (send[k] ?? take[k] ?? now[k]) as KeyedValue;
          if (v.keys !== null) (keys as Obj)[k] = v.keys;
        }
        if (this.lock) doc.keys = await seal(this.lock.key, this.lock.salt, JSON.stringify(keys));
        else delete doc.keys;
      }
      await drive.write(doc);
      this.cloudKeys = doc.keys ?? null;
      this.observe();
      for (const i of sent) {
        this.meta.cloudAt[i] = doc.at[i];
        this.meta.at[i] = doc.at[i];
        if (this.meta.seen[i] === expect[i]) this.meta.dirty = this.meta.dirty.filter((d) => d !== i);
      }
      if (this.lock) this.meta.resetKeys = false;
    }
    this.meta.lastSynced = this.now();
    this.saveMeta();
  }

  private setToken(token: Token | null): void {
    this.token = token;
    if (!token) this.drive = null;
    try {
      if (token) this.storage.setItem(TOKEN, JSON.stringify(token));
      else this.storage.removeItem(TOKEN);
    } catch {
      // blocked storage: connect again next time
    }
  }

  private setLock(lock: Lock | null): void {
    this.lock = lock;
    try {
      if (lock) this.storage.setItem(LOCK, JSON.stringify(lock));
      else this.storage.removeItem(LOCK);
    } catch {
      // blocked storage: the passphrase is asked again next time
    }
  }

  private saveMeta(): void {
    try {
      this.storage.setItem(META, JSON.stringify(this.meta));
    } catch {
      // blocked storage: changes are noticed again next time
    }
  }

  private compute(): CloudState {
    let status: CloudStatus;
    if (this.connecting) status = 'connecting';
    else if (!this.meta.signedIn) status = 'signedOut';
    else if (!this.tokenValid()) status = 'expired';
    else if (this.running) status = 'saving';
    else if (this.error) status = 'error';
    else if (this.pending().length) status = 'saving';
    else status = 'synced';
    return { status, email: this.meta.email, error: this.error, passphrase: this.meta.signedIn ? this.passphrase : null, conflict: this.conflict, lastSynced: this.meta.lastSynced ?? null };
  }

  private emit(): void {
    const next = this.compute();
    const prev = this.snapshot;
    if ((Object.keys(next) as (keyof CloudState)[]).every((k) => next[k] === prev[k])) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }
}

function parseKeys(text: string): KeysPart {
  try {
    const v = JSON.parse(text);
    return isObj(v) ? (v as KeysPart) : {};
  } catch {
    return {};
  }
}
