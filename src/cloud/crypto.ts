/*
 * The API keys leave this browser locked (사용자 결정): AES-GCM with a key made from the player's
 * own passphrase (PBKDF2, SHA-256). Only the lock key made from it is kept on a device, never the
 * passphrase; the cloud copy holds the salt and the locked keys, which say nothing without it.
 */

export interface Sealed {
  /** PBKDF2 salt, AES-GCM nonce and the locked text, base64. */
  salt: string;
  iv: string;
  data: string;
}

const ITERATIONS = 250_000;
const subtle = () => globalThis.crypto.subtle;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const newSalt = (): string => toB64(globalThis.crypto.getRandomValues(new Uint8Array(16)));

/** The lock key made from a passphrase and a salt (base64, 256 bits). */
export async function lockKey(passphrase: string, salt: string): Promise<string> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations: ITERATIONS }, base, 256);
  return toB64(new Uint8Array(bits));
}

const aes = (key: string, use: KeyUsage) => subtle().importKey('raw', fromB64(key), 'AES-GCM', false, [use]);

export async function seal(key: string, salt: string, text: string): Promise<Sealed> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, await aes(key, 'encrypt'), new TextEncoder().encode(text));
  return { salt, iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

/** The text, or null if this key does not open it (a wrong passphrase). */
export async function unseal(key: string, sealed: Sealed): Promise<string | null> {
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, await aes(key, 'decrypt'), fromB64(sealed.data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
