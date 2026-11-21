import { describe, expect, it } from 'vitest';
import { CloudSync, UPLOAD_DELAY_MS, type CloudDoc } from './sync';
import { readLocal, wipeLocal, writeLocal } from './local';
import { lockKey, newSalt, seal, unseal } from './crypto';
import { TokenExpired, type CloudDrive } from './drive';
import type { CloudAuth } from './google';
import { createInitialState as initialState } from '../engine/setup';
import { loadSavedGame, rememberBackups, rememberBrains, rememberGm, rememberedBackups, rememberedBrains, rememberedGm, saveGame, savedName, saveName } from '../session/storage';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

/** One player's Drive folder, shared by their devices. */
class Cloud {
  doc: CloudDoc | null = null;
  writes = 0;
  expired = false;
  drive(): CloudDrive {
    return {
      read: async () => {
        if (this.expired) throw new TokenExpired('expired');
        return this.doc ? structuredClone(this.doc) : null;
      },
      write: async (doc) => {
        if (this.expired) throw new TokenExpired('expired');
        this.writes++;
        this.doc = structuredClone(doc);
      },
    };
  }
}

let clock = 1_000_000;
const now = () => clock;

function device(cloud: Cloud, email = 'player@example.com') {
  const storage = new MemoryStorage();
  const auth: CloudAuth = {
    requestToken: async () => ({ token: 'token', expiresAt: clock + 3_600_000 }),
    email: async () => email,
    revoke: () => {},
  };
  const sync = new CloudSync({ storage, auth, drive: () => cloud.drive(), now });
  const applied: string[][] = [];
  sync.onApplied = (items) => applied.push(items);
  return { storage, sync, applied };
}

const gemini = (apiKey: string) => ({ provider: 'gemini' as const, model: 'gemini-2.5-flash', apiKey });
const groq = (apiKey: string) => ({ provider: 'compatible' as const, model: 'llama-3.3-70b', baseUrl: 'https://api.groq.com/openai/v1', apiKey });

/** Lets a change settle and be sent. */
async function settle(d: ReturnType<typeof device>) {
  d.sync.tick();
  clock += UPLOAD_DELAY_MS + 1;
  d.sync.tick();
  await d.sync.sync();
}

describe('this browser, in the parts the cloud keeps', () => {
  it('keeps every key apart from the settings and puts them back together', () => {
    const storage = new MemoryStorage();
    rememberGm(gemini('KEY-GM'), storage);
    rememberBackups([groq('KEY-B1')], storage);
    rememberBrains({ black: gemini('KEY-BLACK') }, storage);
    saveName('은빛', storage);
    const parts = readLocal(storage);
    expect(JSON.stringify(parts.settings)).not.toContain('KEY-');
    expect(parts.keys).toEqual({ gm: { gemini: 'KEY-GM' }, backups: ['KEY-B1'], brains: { black: 'KEY-BLACK' } });

    const other = new MemoryStorage();
    writeLocal(other, parts);
    expect(rememberedGm(other).current).toEqual(gemini('KEY-GM'));
    expect(rememberedBackups(other)).toEqual([groq('KEY-B1')]);
    expect(rememberedBrains(other)).toEqual({ black: gemini('KEY-BLACK') });
    expect(savedName(other)).toBe('은빛');

    wipeLocal(other);
    expect(readLocal(other)).toEqual({ settings: {}, keys: {}, game: null });
  });
});

describe('the lock on the keys', () => {
  it('opens with the same passphrase only', async () => {
    const salt = newSalt();
    const sealed = await seal(await lockKey('파란 고래 일곱', salt), salt, 'secret');
    expect(sealed.data).not.toContain('secret');
    expect(await unseal(await lockKey('파란 고래 일곱', salt), sealed)).toBe('secret');
    expect(await unseal(await lockKey('빨간 고래 일곱', salt), sealed)).toBeNull();
  });
});

describe('CloudSync', () => {
  it('sends the settings and the locked keys, and another device takes them', async () => {
    const cloud = new Cloud();
    const a = device(cloud);
    rememberGm(gemini('KEY-GM'), a.storage);
    rememberBackups([groq('KEY-B1')], a.storage);
    saveName('은빛', a.storage);
    a.sync.tick();
    await a.sync.connect();
    // Keys here and none in the cloud yet: a passphrase is set before they go.
    expect(a.sync.state.passphrase).toBe('set');
    expect(cloud.doc!.items.name).toBe('은빛');
    expect(cloud.doc!.items.gm).toBeUndefined();
    expect(await a.sync.setPassphrase('파란 고래 일곱')).toBe(true);
    await a.sync.sync();
    expect(a.sync.state.status).toBe('synced');
    expect(JSON.stringify(cloud.doc)).not.toContain('KEY-');
    expect(cloud.doc!.keys).toBeDefined();

    const b = device(cloud);
    await b.sync.connect();
    expect(savedName(b.storage)).toBe('은빛');
    // The keyed items wait for the passphrase set on the other device.
    expect(b.sync.state.passphrase).toBe('enter');
    expect(rememberedGm(b.storage).current).toEqual({ provider: 'fake' });
    expect(await b.sync.setPassphrase('틀린 암호')).toBe(false);
    expect(await b.sync.setPassphrase('파란 고래 일곱')).toBe(true);
    await b.sync.sync();
    expect(rememberedGm(b.storage).current).toEqual(gemini('KEY-GM'));
    expect(rememberedBackups(b.storage)).toEqual([groq('KEY-B1')]);
    expect(b.applied.flat()).toContain('gm');
  });

  it('sends a change a few seconds after it is made', async () => {
    const cloud = new Cloud();
    const a = device(cloud);
    await a.sync.connect();
    saveName('첫 이름', a.storage);
    a.sync.tick();
    expect(a.sync.state.status).toBe('saving');
    await Promise.resolve();
    expect(cloud.doc?.items.name).toBeUndefined();
    await settle(a);
    expect(cloud.doc!.items.name).toBe('첫 이름');
    expect(a.sync.state.status).toBe('synced');

    const b = device(cloud);
    await b.sync.connect();
    expect(savedName(b.storage)).toBe('첫 이름');
    saveName('둘째 이름', b.storage);
    await settle(b);
    await a.sync.sync();
    expect(savedName(a.storage)).toBe('둘째 이름');
  });

  it('settles a setting changed on both sides by the newer change', async () => {
    const cloud = new Cloud();
    const a = device(cloud);
    const b = device(cloud);
    await a.sync.connect();
    await b.sync.connect();
    saveName('A', a.storage);
    a.sync.tick();
    clock += 10_000;
    saveName('B', b.storage);
    b.sync.tick();
    await b.sync.sync();
    await a.sync.sync();
    expect(savedName(a.storage)).toBe('B');
    expect(cloud.doc!.items.name).toBe('B');
  });

  it('never loses a key only one device had', async () => {
    const cloud = new Cloud();
    const a = device(cloud);
    rememberGm(gemini('KEY-GEMINI'), a.storage);
    a.sync.tick();
    await a.sync.connect();
    await a.sync.setPassphrase('암호');
    await a.sync.sync();

    const b = device(cloud);
    b.sync.tick();
    clock += 1000;
    // Chosen on B after A's (a change made here, so its time is known).
    rememberGm({ provider: 'openai', model: 'gpt-5-mini', apiKey: 'KEY-OPENAI' }, b.storage);
    b.sync.tick();
    await b.sync.connect();
    await b.sync.setPassphrase('암호');
    await b.sync.sync();
    // B's choice of GM is newer, and both keys are kept on both.
    expect(rememberedGm(b.storage).keys).toEqual({ gemini: 'KEY-GEMINI', openai: 'KEY-OPENAI' });
    await a.sync.sync();
    expect(rememberedGm(a.storage).current.provider).toBe('openai');
    expect(rememberedGm(a.storage).keys).toEqual({ gemini: 'KEY-GEMINI', openai: 'KEY-OPENAI' });
  });

  it('takes the same game played further on, and asks when each side has a different game', async () => {
    const cloud = new Cloud();
    const gm = { provider: 'fake' as const };
    const a = device(cloud);
    saveGame({ id: 'game-1', kind: 'hotseat', state: initialState(), gm }, a.storage, clock);
    a.sync.tick();
    await a.sync.connect();

    const b = device(cloud);
    await b.sync.connect();
    expect(loadSavedGame(b.storage)?.id).toBe('game-1');
    clock += 60_000;
    saveGame({ id: 'game-1', kind: 'hotseat', state: { ...initialState(), turnNumber: 9 }, gm }, b.storage, clock);
    await settle(b);
    await a.sync.sync();
    expect(loadSavedGame(a.storage)?.state.turnNumber).toBe(9);
    expect(a.sync.state.conflict).toBeNull();

    // A different game started on each side.
    clock += 60_000;
    saveGame({ id: 'game-a', kind: 'hotseat', state: { ...initialState(), turnNumber: 3 }, gm }, a.storage, clock);
    await settle(a);
    clock += 60_000;
    saveGame({ id: 'game-b', kind: 'host', code: 'ABC234', state: { ...initialState(), turnNumber: 5 }, gm }, b.storage, clock);
    b.sync.tick();
    await b.sync.sync();
    expect(b.sync.state.conflict).toMatchObject({ local: { kind: 'host', turn: 5 }, cloud: { kind: 'hotseat', turn: 3 } });
    expect(cloud.doc!.items.game).toMatchObject({ id: 'game-a' });
    b.sync.resolveConflict('cloud');
    await b.sync.sync();
    expect(b.sync.state.conflict).toBeNull();
    expect(loadSavedGame(b.storage)?.id).toBe('game-a');
  });

  it('stops sending when the sign-in runs out, and goes on once connected again', async () => {
    const cloud = new Cloud();
    const a = device(cloud);
    await a.sync.connect();
    clock += 3_600_001;
    saveName('나중', a.storage);
    await settle(a);
    expect(a.sync.state.status).toBe('expired');
    expect(cloud.doc?.items.name).toBeUndefined();
    await a.sync.connect();
    expect(cloud.doc!.items.name).toBe('나중');

    cloud.expired = true;
    saveName('또 나중', a.storage);
    await settle(a);
    expect(a.sync.state.status).toBe('expired');
  });

  it('starts the keys over with a new passphrase, and the other device asks for it', async () => {
    const cloud = new Cloud();
    const a = device(cloud);
    rememberGm(gemini('KEY-OLD'), a.storage);
    a.sync.tick();
    await a.sync.connect();
    await a.sync.setPassphrase('잊은 암호');
    await a.sync.sync();

    const b = device(cloud);
    rememberGm(gemini('KEY-NEW'), b.storage);
    b.sync.tick();
    clock += 1000;
    await b.sync.connect();
    expect(b.sync.state.passphrase).toBe('enter');
    b.sync.resetKeys();
    expect(b.sync.state.passphrase).toBe('set');
    await b.sync.setPassphrase('새 암호');
    await b.sync.sync();
    expect(rememberedGm(b.storage).keys).toEqual({ gemini: 'KEY-NEW' });

    await a.sync.sync();
    expect(a.sync.state.passphrase).toBe('enter');
    expect(await a.sync.setPassphrase('잊은 암호')).toBe(false);
    expect(await a.sync.setPassphrase('새 암호')).toBe(true);
    await a.sync.sync();
    expect(rememberedGm(a.storage).keys).toEqual({ gemini: 'KEY-NEW' });
  });

  it('signs out keeping this browser, or wiping it once everything is in the cloud', async () => {
    const cloud = new Cloud();
    const a = device(cloud);
    await a.sync.connect();
    saveName('남김', a.storage);
    await a.sync.signOut();
    expect(a.sync.state.status).toBe('signedOut');
    expect(savedName(a.storage)).toBe('남김');
    expect(cloud.doc!.items.name).toBe('남김');

    await a.sync.connect();
    rememberGm(gemini('KEY-UNSENT'), a.storage);
    a.sync.tick();
    // The key waits for a passphrase, so wiping would lose it.
    expect(await a.sync.signOut(true)).toBe('unsynced');
    expect(rememberedGm(a.storage).keys).toEqual({ gemini: 'KEY-UNSENT' });
    expect(await a.sync.signOut(true, true)).toBe('done');
    expect(readLocal(a.storage)).toEqual({ settings: {}, keys: {}, game: null });
    expect(a.applied.at(-1)).toContain('gm');
  });
});
